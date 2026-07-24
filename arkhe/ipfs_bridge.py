#!/usr/bin/env python3
"""
ARKHE OS Substrate 602+603 — IPFS Bridge with Nostr Fallback
Arquiteto: ORCID 0009-0005-2697-4668
Data: 2026-05-23
STRICT MODE

Extends Substrate 602 (IPFS) with Substrate 603 (Hashtree/Nostr) fallback.
When a CID is not found on IPFS, queries Nostr relays for nhash references.
"""

import asyncio
import json
import hashlib
import base64
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from enum import Enum

# Optional imports — graceful degradation
try:
    import aiohttp
    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

try:
    import ipfshttpclient
    HAS_IPFS = True
except ImportError:
    HAS_IPFS = False

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False


class ResolutionStatus(Enum):
    FOUND_IPFS = "found_ipfs"
    FOUND_NOSTR = "found_nostr"
    FOUND_HASHTREE = "found_hashtree"
    NOT_FOUND = "not_found"
    TIMEOUT = "timeout"


@dataclass
class ResolutionResult:
    cid: str
    status: ResolutionStatus
    data: Optional[bytes]
    source: str
    latency_ms: float
    seal: Optional[str] = None


class NostrRelayClient:
    """Minimal Nostr relay client for CID resolution."""

    DEFAULT_RELAYS = [
        "wss://relay.damus.io",
        "wss://relay.nostr.band",
        "wss://nos.lol",
        "wss://relay.snort.social",
    ]

    def __init__(self, relays: Optional[List[str]] = None):
        self.relays = relays or self.DEFAULT_RELAYS
        self._connections: Dict[str, Any] = {}

    async def query_cid(self, cid: str, timeout: float = 5.0) -> Optional[Dict]:
        """Query Nostr relays for a CID reference."""
        if not HAS_WEBSOCKETS:
            return None

        # Build filter for kind 1063 (NIP-94 file metadata) or custom ARKHE kind
        filter_msg = [
            "REQ",
            f"arkhe-cid-{cid[:8]}",
            {
                "kinds": [1063, 38001],  # 38001 = ARKHE custom kind
                "#cid": [cid],
                "limit": 10
            }
        ]

        for relay_url in self.relays:
            try:
                async with websockets.connect(relay_url, timeout=timeout) as ws:
                    await ws.send(json.dumps(filter_msg))
                    response = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    data = json.loads(response)

                    if isinstance(data, list) and len(data) > 2:
                        event = data[2]
                        tags = {t[0]: t[1] for t in event.get("tags", [])}

                        return {
                            "nhash": tags.get("nhash"),
                            "url": tags.get("url"),
                            "relay": relay_url,
                            "pubkey": event.get("pubkey"),
                            "created_at": event.get("created_at"),
                        }
            except Exception as e:
                continue

        return None

    async def publish_reference(self, cid: str, nhash: str,
                                 private_key: str, relays: Optional[List[str]] = None) -> bool:
        """Publish a CID→nhash reference to Nostr relays."""
        if not HAS_WEBSOCKETS:
            return False

        # Build event (kind 38001 = ARKHE content reference)
        event = {
            "kind": 38001,
            "created_at": int(asyncio.get_event_loop().time()),
            "tags": [
                ["cid", cid],
                ["nhash", nhash],
                ["client", "arkhe-os-603"],
            ],
            "content": f"ARKHE OS content reference: {cid} -> {nhash}",
        }

        # Sign event (simplified — real impl needs secp256k1)
        event_json = json.dumps([0, event["pubkey"], event["created_at"],
                                  event["kind"], event["tags"], event["content"]])
        event["id"] = hashlib.sha256(event_json.encode()).hexdigest()
        event["sig"] = "signed"  # Placeholder — real sig needed

        target_relays = relays or self.relays
        success = False

        for relay_url in target_relays:
            try:
                async with websockets.connect(relay_url, timeout=5.0) as ws:
                    await ws.send(json.dumps(["EVENT", event]))
                    response = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    if "OK" in response:
                        success = True
            except Exception:
                continue

        return success


class HashtreeResolver:
    """Resolve content via Hashtree (htree CLI or HTTP API)."""

    HASHTREE_API = "https://hashtree.cc/api/v0"

    async def resolve_nhash(self, nhash: str, timeout: float = 10.0) -> Optional[bytes]:
        """Resolve an nhash to content bytes."""
        if not HAS_AIOHTTP:
            return None

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
            # Try Blossom servers first
            urls = [
                f"{self.HASHTREE_API}/content/{nhash}",
                f"https://upload.iris.to/{nhash}",
            ]

            for url in urls:
                try:
                    async with session.get(url) as resp:
                        if resp.status == 200:
                            return await resp.read()
                except Exception:
                    continue

        return None

    async def resolve_htree_url(self, url: str, timeout: float = 10.0) -> Optional[bytes]:
        """Resolve htree://npub.../path URL."""
        if not HAS_AIOHTTP:
            return None

        # Convert htree:// to API call
        if url.startswith("htree://"):
            url = url.replace("htree://", "")

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
            api_url = f"{self.HASHTREE_API}/resolve/{url}"
            try:
                async with session.get(api_url) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        nhash = data.get("nhash")
                        if nhash:
                            return await self.resolve_nhash(nhash, timeout)
            except Exception:
                pass

        return None


class IPFSBridgeExtended:
    """Extended IPFS bridge with Nostr/Hashtree fallback."""

    def __init__(self,
                 ipfs_host: str = "localhost",
                 ipfs_port: int = 5001,
                 nostr_relays: Optional[List[str]] = None,
                 enable_hashtree: bool = True,
                 enable_nostr: bool = True):
        self.ipfs_host = ipfs_host
        self.ipfs_port = ipfs_port
        self.enable_hashtree = enable_hashtree
        self.enable_nostr = enable_nostr

        self._ipfs_client = None
        self._nostr_client = NostrRelayClient(nostr_relays) if enable_nostr else None
        self._hashtree_resolver = HashtreeResolver() if enable_hashtree else None

        if HAS_IPFS:
            try:
                self._ipfs_client = ipfshttpclient.connect(
                    f"/dns/{ipfs_host}/tcp/{ipfs_port}/http"
                )
            except Exception:
                pass

    async def resolve(self, cid: str, timeout: float = 15.0) -> ResolutionResult:
        """
        Resolve a CID through cascading fallback:
        1. IPFS (local + DHT)
        2. Nostr relays (CID → nhash mapping)
        3. Hashtree direct (nhash resolution)
        """
        import time
        start_time = time.time()

        # Stage 1: IPFS
        if self._ipfs_client:
            try:
                data = self._ipfs_client.cat(cid, timeout=timeout)
                latency = (time.time() - start_time) * 1000
                return ResolutionResult(
                    cid=cid,
                    status=ResolutionStatus.FOUND_IPFS,
                    data=data,
                    source="ipfs",
                    latency_ms=latency,
                    seal=hashlib.sha256(data).hexdigest()
                )
            except Exception:
                pass

        # Stage 2: Nostr fallback
        if self._nostr_client:
            nostr_result = await self._nostr_client.query_cid(cid, timeout=timeout/3)
            if nostr_result:
                nhash = nostr_result.get("nhash")
                if nhash and self._hashtree_resolver:
                    data = await self._hashtree_resolver.resolve_nhash(nhash, timeout=timeout/3)
                    if data:
                        latency = (time.time() - start_time) * 1000
                        return ResolutionResult(
                            cid=cid,
                            status=ResolutionStatus.FOUND_NOSTR,
                            data=data,
                            source=f"nostr:{nostr_result.get('relay')}",
                            latency_ms=latency,
                            seal=hashlib.sha256(data).hexdigest()
                        )

        # Stage 3: Hashtree direct (if CID is actually an nhash)
        if self._hashtree_resolver and cid.startswith("nhash"):
            data = await self._hashtree_resolver.resolve_nhash(cid, timeout=timeout/2)
            if data:
                latency = (time.time() - start_time) * 1000
                return ResolutionResult(
                    cid=cid,
                    status=ResolutionStatus.FOUND_HASHTREE,
                    data=data,
                    source="hashtree",
                    latency_ms=latency,
                    seal=hashlib.sha256(data).hexdigest()
                )

        latency = (time.time() - start_time) * 1000
        return ResolutionResult(
            cid=cid,
            status=ResolutionStatus.NOT_FOUND,
            data=None,
            source="none",
            latency_ms=latency
        )

    async def publish_to_nostr(self, cid: str, nhash: str, private_key: str) -> bool:
        """Publish a CID→nhash bridge reference to Nostr."""
        if not self._nostr_client:
            return False
        return await self._nostr_client.publish_reference(cid, nhash, private_key)

    def close(self):
        """Clean up resources."""
        if self._ipfs_client:
            self._ipfs_client.close()


# ── CLI Interface ─────────────────────────────────────────

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="ARKHE IPFS+Nostr Bridge")
    parser.add_argument("cid", help="CID to resolve")
    parser.add_argument("--ipfs-host", default="localhost")
    parser.add_argument("--ipfs-port", type=int, default=5001)
    parser.add_argument("--no-nostr", action="store_true", help="Disable Nostr fallback")
    parser.add_argument("--no-hashtree", action="store_true", help="Disable Hashtree fallback")
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()

    bridge = IPFSBridgeExtended(
        ipfs_host=args.ipfs_host,
        ipfs_port=args.ipfs_port,
        enable_nostr=not args.no_nostr,
        enable_hashtree=not args.no_hashtree
    )

    print(f"[ARKHE-602+603] Resolving CID: {args.cid}")
    result = await bridge.resolve(args.cid, timeout=args.timeout)

    print(f"Status: {result.status.value}")
    print(f"Source: {result.source}")
    print(f"Latency: {result.latency_ms:.2f}ms")
    if result.seal:
        print(f"Seal (SHA-256): {result.seal}")
    if result.data:
        print(f"Size: {len(result.data)} bytes")

    bridge.close()

if __name__ == "__main__":
    asyncio.run(main())
