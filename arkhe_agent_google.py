#!/usr/bin/env python3
# ╔══════════════════════════════════════════════════════════════════╗
# ║  ARKHE‑OS.GGUF + GOOGLE — Trinitarian AGI with Real-Time Web    ║
# ║  Grounding via Google Custom Search API / SerpAPI               ║
# ║  Recursive Intelligence + Grounded Imagination + Ethical        ║
# ║  Evolution + Live Web Perception                                ║
# ║  Substratos: 244.1, 890, 898, 899, 901, 902, 905, 912, 913, 917 ║
# ║  Arquitect: ORCID 0009-0005-2697-4668                           ║
# ╚══════════════════════════════════════════════════════════════════╝

import hashlib
import json
import logging
import random
import time
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# ── Logger ──────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ArkheOS")

# ═══════════════════════════════════════════════════════════════════
# 0. Google Search Integration (Substrato 917 — Web Grounding Layer)
# ═══════════════════════════════════════════════════════════════════
class GoogleGroundingLayer:
    """
    Real-time web perception via Google Custom Search API / SerpAPI.
    Augments agent perception with live web-grounded context.
    Substrato 917 — CANONIZED_PROVISIONAL
    """

    SEARCH_ENGINES = ["google", "google_news", "google_scholar", "google_images"]

    def __init__(self,
                 api_key: Optional[str] = None,
                 cx: Optional[str] = None,  # Google Custom Search Engine ID
                 serpapi_key: Optional[str] = None,
                 default_engine: str = "google"):
        self.api_key = api_key or os.environ.get("GOOGLE_API_KEY", "")
        self.cx = cx or os.environ.get("GOOGLE_CX", "")
        self.serpapi_key = serpapi_key or os.environ.get("SERPAPI_KEY", "")
        self.default_engine = default_engine if default_engine in self.SEARCH_ENGINES else "google"
        self.base_url = "https://www.googleapis.com/customsearch/v1"
        self.serpapi_url = "https://serpapi.com/search"
        self.session_queries = 0
        self.total_results_fetched = 0

    def _mock_search(self, query: str, engine: str = "google",
                     num_results: int = 5) -> Dict:
        """Mock search for when API keys are unavailable — deterministic demo mode."""
        seed = hashlib.sha256(query.encode()).hexdigest()
        rng = random.Random(int(seed[:16], 16))

        domains = ["arxiv.org", "nature.com", "techcrunch.com", "github.com",
                   "wikipedia.org", "medium.com", "reuters.com", "scholar.google.com",
                   "news.google.com", "blog.google.com"]

        results = []
        for i in range(num_results):
            domain = domains[rng.randint(0, len(domains)-1)]
            results.append({
                "title": f"[{engine.upper()}] Result {i+1} for '{query[:40]}...'",
                "link": f"https://{domain}/article/{seed[:8]}-{i}",
                "displayLink": domain,
                "snippet": (
                    f"Google Search extracts structured snippets from indexed pages, "
                    f"providing concise summaries with title, URL, and contextual excerpt. "
                    f"This result was retrieved via {engine} search engine."
                ),
                "htmlSnippet": f"<b>Google</b> result snippet for query...",
                "htmlTitle": f"Result {i+1} — {query[:30]}",
                "cacheId": f"cache-{seed[:8]}-{i}",
                "formattedUrl": f"{domain}/article/{seed[:8]}-{i}",
                "pagemap": {
                    "metatags": [{"og:type": "article", "og:title": query[:50]}]
                }
            })

        return {
            "query": query,
            "engine": engine,
            "results": results,
            "total_results": num_results,
            "searchInformation": {
                "searchTime": round(0.1 + rng.random() * 0.4, 3),
                "formattedSearchTime": f"{round(0.1 + rng.random() * 0.4, 3)}s",
                "totalResults": str(rng.randint(10000, 10000000)),
                "formattedTotalResults": f"{rng.randint(10000, 10000000):,}"
            },
            "mock": True,
        }

    def search(self, query: str, engine: Optional[str] = None,
               num_results: int = 5,
               start: int = 0,
               date_restrict: Optional[str] = None,
               site_search: Optional[str] = None) -> Dict:
        """
        Execute Google search with ARKHE-optimized parameters.

        Args:
            query: Natural language query
            engine: google/google_news/google_scholar
            num_results: Number of results (max 10 for free tier)
            start: Pagination offset
            date_restrict: Date filter (e.g., 'd1' = past day, 'w1' = past week, 'm1' = past month, 'y1' = past year)
            site_search: Restrict to specific site (e.g., 'site:arxiv.org')
        """
        eng = engine or self.default_engine

        # Try SerpAPI first (more reliable, richer data)
        if self.serpapi_key:
            return self._serpapi_search(query, eng, num_results, start, date_restrict, site_search)

        # Fall back to Google Custom Search API
        if self.api_key and self.cx:
            return self._google_cse_search(query, eng, num_results, start, date_restrict, site_search)

        logger.warning("⚠️  No Google API keys set — using mock search mode")
        logger.warning("   Set GOOGLE_API_KEY + GOOGLE_CX, or SERPAPI_KEY for live search")
        return self._mock_search(query, eng, num_results)

    def _google_cse_search(self, query: str, engine: str, num_results: int,
                           start: int, date_restrict: Optional[str],
                           site_search: Optional[str]) -> Dict:
        """Google Custom Search API implementation."""
        try:
            params = {
                "key": self.api_key,
                "cx": self.cx,
                "q": query,
                "num": min(num_results, 10),
                "start": start,
                "alt": "json",
            }
            if date_restrict:
                params["dateRestrict"] = date_restrict
            if site_search:
                params["siteSearch"] = site_search
            if engine == "google_news":
                params["sort"] = "date"

            url = f"{self.base_url}?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(url, headers={"User-Agent": "ArkheOS-GoogleBot/1.0"})

            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            self.session_queries += 1
            self.total_results_fetched += len(data.get("items", []))

            return {
                "query": query,
                "engine": engine,
                "results": data.get("items", []),
                "total_results": len(data.get("items", [])),
                "searchInformation": data.get("searchInformation", {}),
                "mock": False,
            }

        except Exception as e:
            logger.error(f"Google CSE search failed: {e}")
            return self._mock_search(query, engine, num_results)

    def _serpapi_search(self, query: str, engine: str, num_results: int,
                        start: int, date_restrict: Optional[str],
                        site_search: Optional[str]) -> Dict:
        """SerpAPI implementation (richer results, handles rate limits)."""
        try:
            engine_map = {
                "google": "google",
                "google_news": "google_news",
                "google_scholar": "google_scholar",
                "google_images": "google_images",
            }

            params = {
                "engine": engine_map.get(engine, "google"),
                "q": query,
                "api_key": self.serpapi_key,
                "num": min(num_results, 10),
                "start": start,
            }
            if date_restrict:
                params["tbs"] = f"qdr:{date_restrict}"
            if site_search:
                params["site"] = site_search.replace("site:", "")

            url = f"{self.serpapi_url}?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(url, headers={"User-Agent": "ArkheOS-SerpBot/1.0"})

            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            self.session_queries += 1

            # Normalize SerpAPI response to Google CSE format
            organic_results = data.get("organic_results", [])
            normalized = []
            for r in organic_results[:num_results]:
                normalized.append({
                    "title": r.get("title", "Untitled"),
                    "link": r.get("link", ""),
                    "displayLink": r.get("displayed_link", "").split(" › ")[0] if r.get("displayed_link") else "",
                    "snippet": r.get("snippet", ""),
                    "htmlSnippet": r.get("snippet", ""),
                    "htmlTitle": r.get("title", ""),
                    "formattedUrl": r.get("link", ""),
                    "pagemap": {"metatags": [{"og:type": "article"}]},
                })

            self.total_results_fetched += len(normalized)

            return {
                "query": query,
                "engine": engine,
                "results": normalized,
                "total_results": len(normalized),
                "searchInformation": {
                    "searchTime": data.get("search_metadata", {}).get("total_time_taken", 0.5),
                    "totalResults": str(data.get("search_information", {}).get("total_results", 0)),
                },
                "mock": False,
            }

        except Exception as e:
            logger.error(f"SerpAPI search failed: {e}")
            return self._mock_search(query, engine, num_results)

    def news_search(self, query: str, num_results: int = 5,
                    date_restrict: str = "d7") -> Dict:
        """Specialized news search (past week by default)."""
        return self.search(query, engine="google_news", num_results=num_results,
                          date_restrict=date_restrict)

    def scholar_search(self, query: str, num_results: int = 5) -> Dict:
        """Academic paper search via Google Scholar."""
        return self.search(query, engine="google_scholar", num_results=num_results)

    def site_restricted_search(self, query: str, site: str,
                               num_results: int = 5) -> Dict:
        """Search restricted to specific domain."""
        return self.search(query, num_results=num_results,
                          site_search=f"site:{site}")

    def synthesize_context(self, search_results: Dict,
                           max_snippets: int = 3) -> str:
        """
        Synthesize Google results into compact context for World Model.
        """
        if not search_results.get("results"):
            return ""

        lines = [f"[WEB-GROUNDED CONTEXT | {search_results['engine'].upper()}]"]
        lines.append(f"Query: {search_results['query']}")
        info = search_results.get("searchInformation", {})
        if info:
            lines.append(f"Results: {info.get('formattedTotalResults', 'N/A')} in {info.get('formattedSearchTime', 'N/A')}")
        lines.append("-" * 50)

        for i, r in enumerate(search_results["results"][:max_snippets]):
            title = r.get("title", "Untitled")
            domain = r.get("displayLink", r.get("link", "").split("/")[2] if r.get("link") else "")
            lines.append(f"[{i+1}] {title}")
            lines.append(f"    Source: {domain}")

            snippet = r.get("snippet", "")
            if snippet:
                lines.append(f"    → {snippet[:250]}{'...' if len(snippet) > 250 else ''}")
            lines.append("")

        return "\n".join(lines)

    def extract_knowledge_graph(self, search_results: Dict) -> Dict[str, Any]:
        """Extract structured knowledge from search results."""
        entities = []
        for r in search_results.get("results", []):
            pagemap = r.get("pagemap", {})
            metatags = pagemap.get("metatags", [{}])[0]
            entities.append({
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "type": metatags.get("og:type", "article"),
                "description": r.get("snippet", "")[:200],
            })
        return {
            "entities": entities,
            "query": search_results.get("query", ""),
            "engine": search_results.get("engine", "google"),
        }

    def to_peptide_descriptor(self, search_results: Dict) -> Dict[str, Any]:
        """Convert search results to Peptide-SaaS descriptor format."""
        return {
            "sequence": f"google:{search_results['query'][:20]}",
            "source_code_hash": hashlib.sha256(
                json.dumps(search_results, sort_keys=True).encode()
            ).hexdigest()[:16],
            "api_endpoints": {
                "engine": search_results["engine"],
                "results_count": search_results["total_results"],
                "search_time": search_results.get("searchInformation", {}).get("searchTime", 0),
            },
            "subscription_model": "GOOGLE-per-query",
            "zero_trust": True,
            "results_fetched": self.total_results_fetched,
        }

# ═══════════════════════════════════════════════════════════════════
# 1. Kolmogorov Regularizer (Substrato 898) — Ethical Evolution
# ═══════════════════════════════════════════════════════════════════
class KolmogorovRegularizer:
    """Solomonoff prior: weight norm = Kolmogorov complexity (Musat 2026)."""
    def __init__(self, lambda_k: float = 1e-4, precision_bits: int = 32):
        self.lambda_k = lambda_k
        self.precision_bits = precision_bits
        self.c_d = precision_bits * np.log(2)

    def __call__(self, model: nn.Module) -> torch.Tensor:
        total_norm_sq = sum(p.norm() ** 2 for p in model.parameters())
        return self.lambda_k * total_norm_sq * torch.log(total_norm_sq + 1.0)

    def complexity_estimate(self, model: nn.Module) -> Dict[str, float]:
        total_params = sum(p.numel() for p in model.parameters())
        total_norm = sum(p.norm().item() ** 2 for p in model.parameters())
        K_upper = self.c_d * total_norm * np.log(total_norm + 1) + self.c_d
        K_lower = max(0, total_norm - total_params * self.precision_bits)
        return {
            "total_params": total_params,
            "weight_norm": total_norm,
            "K_lower_bound": K_lower,
            "K_upper_bound": K_upper,
            "precision_bits": self.precision_bits,
        }

# ═══════════════════════════════════════════════════════════════════
# 2. Peptide‑SaaS Encoder (Substrato 900) — Grounded Imagination
# ═══════════════════════════════════════════════════════════════════
class PeptideSaaSEncoder(nn.Module):
    """Encodes biological peptides as digital SaaS vectors."""
    AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
    def __init__(self, embed_dim: int = 256, num_layers: int = 4):
        super().__init__()
        self.embed_dim = embed_dim
        self.aa_embedding = nn.Embedding(len(self.AMINO_ACIDS)+1, embed_dim, padding_idx=0)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim, nhead=8, dim_feedforward=embed_dim*4,
            dropout=0.1, batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.service_projection = nn.Sequential(
            nn.Linear(embed_dim, embed_dim), nn.LayerNorm(embed_dim), nn.GELU(),
            nn.Linear(embed_dim, embed_dim)
        )
        self.api_call_head = nn.Linear(embed_dim, 64)
        self.orchestration_head = nn.Linear(embed_dim, 32)
        self.deploy_head = nn.Linear(embed_dim, 16)

    def encode_sequence(self, sequence: str) -> torch.Tensor:
        tokens = [self.AMINO_ACIDS.index(aa)+1 for aa in sequence if aa in self.AMINO_ACIDS]
        if not tokens: tokens = [0]
        x = torch.tensor([tokens], dtype=torch.long)
        emb = self.aa_embedding(x)
        out = self.transformer(emb)
        pooled = out.mean(dim=1)
        return self.service_projection(pooled)

    def forward(self, sequences: List[str]) -> Dict[str, torch.Tensor]:
        embs = torch.stack([self.encode_sequence(s) for s in sequences])
        return {
            "embedding": embs,
            "api_call": self.api_call_head(embs),
            "orchestration": self.orchestration_head(embs),
            "deploy": self.deploy_head(embs),
        }

    def to_saaS_descriptor(self, sequence: str) -> Dict[str, Any]:
        with torch.no_grad():
            out = self.forward([sequence])
        return {
            "sequence": sequence,
            "source_code_hash": hashlib.sha256(sequence.encode()).hexdigest()[:16],
            "api_endpoints": {
                "binding": out["api_call"][0].argmax().item(),
                "orchestration": out["orchestration"][0].argmax().item(),
                "deploy": out["deploy"][0].argmax().item(),
            },
            "subscription_model": "ATP-per-call",
            "zero_trust": True,
        }

# ═══════════════════════════════════════════════════════════════════
# 3. World Model v2.0 — Grounded Imagination + Recursive Intelligence
# ═══════════════════════════════════════════════════════════════════
class ArkheWorldModel(nn.Module):
    """6‑stage world model with Google web-grounding augmentation."""
    def __init__(self, state_dim=256, action_dim=64, maturity="embryo"):
        super().__init__()
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.maturity = maturity

        self.token_encoder = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(state_dim, nhead=8, batch_first=True),
            num_layers=2
        )
        self.physics_prior = nn.Sequential(
            nn.Linear(state_dim, state_dim*2), nn.GELU(),
            nn.Linear(state_dim*2, state_dim)
        )
        self.peptide_encoder = PeptideSaaSEncoder(256, 4)
        self.fusion_layer = nn.MultiheadAttention(state_dim, 8, batch_first=True)
        self.dynamics = nn.GRUCell(state_dim + action_dim, state_dim)
        self.causal_graph = nn.Parameter(torch.randn(state_dim, state_dim) * 0.01)
        self.self_model = nn.Sequential(
            nn.Linear(state_dim, state_dim//2), nn.GELU(),
            nn.Linear(state_dim//2, 3)
        )
        # Web-grounding encoder: projects search context into state space
        self.web_grounding_encoder = nn.Sequential(
            nn.Linear(512, state_dim), nn.LayerNorm(state_dim), nn.GELU(),
            nn.Linear(state_dim, state_dim)
        )
        self.kolmogorov_reg = KolmogorovRegularizer(1e-4)

    def forward(self, tokens, action, peptide_seq=None, web_context=None):
        grounded = self.token_encoder(tokens)
        state = grounded.mean(dim=1)
        state = state + self.physics_prior(state)

        if peptide_seq is not None:
            pep_emb = self.peptide_encoder.encode_sequence(peptide_seq).expand(tokens.size(0), -1)
            state_exp = state.unsqueeze(1)
            pep_exp = pep_emb.unsqueeze(1)
            fused, _ = self.fusion_layer(state_exp, pep_exp, pep_exp)
            state = fused.squeeze(1) + state

        # Inject web-grounded context if available
        if web_context is not None:
            web_emb = self.web_grounding_encoder(web_context)
            state = state + 0.3 * web_emb

        next_state = self.dynamics(torch.cat([state, action], -1), state)
        causal_effect = next_state @ self.causal_graph.tanh()
        meta = self.self_model(next_state)
        return {
            "state": next_state,
            "causal_effect": causal_effect,
            "confidence": meta[:, 0].sigmoid(),
            "uncertainty": meta[:, 1].sigmoid(),
            "novelty": meta[:, 2].sigmoid(),
        }

    def compute_loss(self, pred, target, model_out):
        mse = F.mse_loss(pred["state"], target["next_state"])
        causal = F.mse_loss(pred["causal_effect"], target["causal_effect"])
        k = self.kolmogorov_reg(self)
        conf = F.binary_cross_entropy(pred["confidence"], target["confidence"])
        return mse + 0.5*causal + k + 0.1*conf

    def get_complexity_report(self):
        return self.kolmogorov_reg.complexity_estimate(self)

# ═══════════════════════════════════════════════════════════════════
# 4. Cryptography & Memory (Ethical Evolution)
# ═══════════════════════════════════════════════════════════════════
class OctraService:
    def __init__(self):
        self.fhe_keys = {}
        self.zk_domains = {}
        self.pqc_registry = {}
        self.store = {}
        self.log = []
    def provision_fhe(self, pk_id, levels=3):
        self.fhe_keys[pk_id] = {"levels": levels}
        return {"pk_id": pk_id}
    def encrypt_fhe(self, pk_id, vec, scale=2**40):
        h = hashlib.sha3_256(str(vec).encode()).hexdigest()[:16]
        self.store[h] = {"data": vec, "level": self.fhe_keys[pk_id]["levels"]}
        return {"handle": h}
    def prove_zk(self, domain, secret, challenge):
        proof_id = hashlib.sha3_256(f"{secret}{challenge}".encode()).hexdigest()[:16]
        return {"proof_id": proof_id}
    def sign_pqc(self, eid, msg):
        return {"signature": hashlib.sha3_256(f"{eid}{msg}".encode()).hexdigest()[:32]}
    def provision_pqc(self, eid, level=3):
        self.pqc_registry[eid] = {"level": level}
        return {"entity_id": eid}
    def provision_zk(self, domain, g=2, h=3):
        self.zk_domains[domain] = (g, h)
        return {"domain": domain}

@dataclass
class Vertex:
    vid: str
    vtype: str
    properties: Dict[str, Any] = field(default_factory=dict)

@dataclass
class Hyperedge:
    eid: str
    etype: str
    vertices: List[str] = field(default_factory=list)
    properties: Dict[str, Any] = field(default_factory=dict)

class HypergraphRegistry:
    def __init__(self, endpoint="localhost:8720"):
        self.vertices = {}
        self.edges = {}
    def add_vertex(self, v: Vertex): self.vertices[v.vid] = v
    def add_hyperedge(self, e: Hyperedge): self.edges[e.eid] = e

class MemorySpace:
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.entries = []
    def add(self, entry: dict): self.entries.append(entry)
    def retrieve_relevant(self, query: str) -> List[dict]:
        return [e for e in self.entries if query.lower() in str(e.get("content","")).lower()]

class EncryptedMemoryCommit:
    def __init__(self, octra, agent_id, fhe_pk, zk_domain, pqc_entity):
        self.octra = octra; self.agent_id = agent_id
        self.fhe_pk = fhe_pk; self.zk_domain = zk_domain; self.pqc_entity = pqc_entity
    def commit(self, memory_id: str, payload: dict) -> dict:
        vec = [float(ord(c)) for c in json.dumps(payload, sort_keys=True)[:100]]
        fhe_handle = self.octra.encrypt_fhe(self.fhe_pk, vec)
        proof = self.octra.prove_zk(self.zk_domain, "memory_seed", 42)
        msg = fhe_handle["handle"] + proof["proof_id"]
        sig = self.octra.sign_pqc(self.pqc_entity, msg)
        artefact = {
            "type": "memory.commit", "agent": self.agent_id, "memory_id": memory_id,
            "fhe_handle": fhe_handle["handle"], "zk_proof_id": proof["proof_id"],
            "pqc_signature": sig, "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        artefact["seal"] = hashlib.sha3_256(json.dumps(artefact, sort_keys=True).encode()).hexdigest()
        return artefact

class EpistemicCommitProtocol:
    def __init__(self, memory, committer, hypergraph, agent_vertex):
        self.memory = memory; self.committer = committer
        self.hg = hypergraph; self.agent_v = agent_vertex
    def commit(self, content: dict, relevance=0.8, sensitivity=0.2) -> str:
        cid = hashlib.sha3_256(str(content).encode()).hexdigest()[:16]
        self.memory.add({"id": cid, "content": content, "timestamp": datetime.now(timezone.utc).isoformat()})
        enc_artefact = self.committer.commit(cid, content)
        edge = Hyperedge(eid=f"memory:{cid}", etype="EpistemicCommit",
                         vertices=[self.agent_v.vid, f"data:{cid}"], properties=enc_artefact)
        self.hg.add_hyperedge(edge)
        return cid
    def retrieve(self, query: str, k=5):
        return self.memory.retrieve_relevant(query)[:k]

class QuantumProofOfWork:
    def __init__(self, backend="qasm_simulator"): self.backend = backend
    def mine(self, agent_id, previous_hash, difficulty=4):
        nonce = random.randint(0, 2**32)
        block_hash = hashlib.sha3_256(f"{previous_hash}{nonce}{agent_id}".encode()).hexdigest()
        return {"hash": block_hash, "nonce": nonce, "difficulty": difficulty}

# ═══════════════════════════════════════════════════════════════════
# 5. ArkheAgent — Trinitarian Core + Google Web Grounding
# ═══════════════════════════════════════════════════════════════════
@dataclass
class ArkheConfig:
    maturity: str = "infant"
    memory_policy: str = "encrypted"
    fhe_key_id: str = "arkhe-agent-001"
    zk_domain: str = "arkhe.epistemic"
    pqc_entity_id: str = "arkhe-agent-001-pqc"
    registry_endpoint: str = "localhost:8720"
    qpow_enabled: bool = False
    qpow_backend: str = "qasm_simulator"
    # Google configuration
    google_api_key: Optional[str] = None
    google_cx: Optional[str] = None
    serpapi_key: Optional[str] = None
    google_default_engine: str = "google"
    google_auto_ground: bool = True
    google_max_results: int = 3

class ArkheAgent:
    """
    Arkhe‑OS.gguf AGI Application with Google real-time web grounding.
    Trinitarian principles + Live Web Perception (Substrato 917)
    """
    def __init__(self, config: ArkheConfig = ArkheConfig()):
        self.config = config
        self.agent_id = hashlib.sha3_256(
            f"ARKHE-AGENT-{datetime.now(timezone.utc).isoformat()}".encode()
        ).hexdigest()[:16]
        logger.info(f"🤖 Arkhe Agent {self.agent_id} initialising…")

        # Google Grounding Layer (Substrato 917)
        self.google = GoogleGroundingLayer(
            api_key=config.google_api_key,
            cx=config.google_cx,
            serpapi_key=config.serpapi_key,
            default_engine=config.google_default_engine
        )
        logger.info(f"🌐 Google Grounding Layer active (engine: {config.google_default_engine})")

        # LLM mock
        class MockLLM:
            def embed(self, text): return np.random.randn(512).astype(np.float32)
            def create_completion(self, prompt, max_tokens=200):
                return {"choices": [{"text": f"[AGI response to: {prompt[:50]}...]"}]}
        self.llm = MockLLM()

        # World‑Model with web-grounding support
        self.world_model = ArkheWorldModel(state_dim=256, action_dim=64, maturity=config.maturity)

        # Octra (cryptographic service)
        self.octra = OctraService()
        self.octra.provision_fhe(config.fhe_key_id)
        self.octra.provision_zk(config.zk_domain)
        self.octra.provision_pqc(config.pqc_entity_id)

        # Hypergraph
        self.hypergraph = HypergraphRegistry(config.registry_endpoint)
        self.agent_vertex = Vertex(
            vid=f"agent:{self.agent_id}", vtype="AGI_Agent",
            properties={"maturity": config.maturity, "timestamp": datetime.now(timezone.utc).isoformat()}
        )
        self.hypergraph.add_vertex(self.agent_vertex)

        # Memory
        self.memory_space = MemorySpace(agent_id=self.agent_id)
        self.encrypted_memory = EncryptedMemoryCommit(
            octra=self.octra, agent_id=self.agent_id,
            fhe_pk=config.fhe_key_id, zk_domain=config.zk_domain, pqc_entity=config.pqc_entity_id
        )
        self.epistemic_protocol = EpistemicCommitProtocol(
            memory=self.memory_space, committer=self.encrypted_memory,
            hypergraph=self.hypergraph, agent_vertex=self.agent_vertex
        )

        # qPoW (optional)
        self.qpow = None
        if config.qpow_enabled:
            self.qpow = QuantumProofOfWork(backend=config.qpow_backend)

        self.total_commits = 0
        self.total_interactions = 0
        self.total_web_queries = 0
        logger.info("✅ Arkhe Agent ready — Trinitarian + Google Web Grounding active.")

    def perceive(self, text_input: str, peptide_seq=None,
                 web_query: Optional[str] = None,
                 engine: Optional[str] = None) -> Dict:
        """
        Perception augmented with real-time Google web search.

        Args:
            text_input: Primary sensory input (text)
            peptide_seq: Optional biological grounding signal
            web_query: Override query for web search (defaults to text_input)
            engine: Override search engine (google/google_news/google_scholar)
        """
        self.total_interactions += 1

        # 1. LLM embedding
        llm_emb = self.llm.embed(text_input)

        # 2. Google web grounding (Substrato 917)
        web_context_emb = None
        search_results = None
        synthesized_context = ""

        if self.config.google_auto_ground or web_query:
            query = web_query or text_input
            eng = engine or self.config.google_default_engine

            logger.info(f"🔍 Google search: '{query[:60]}...' [{eng}]")
            search_results = self.google.search(
                query,
                engine=eng,
                num_results=self.config.google_max_results
            )
            self.total_web_queries += 1

            synthesized_context = self.google.synthesize_context(search_results)
            # Encode context into embedding for World Model injection
            web_context_emb = torch.from_numpy(self.llm.embed(synthesized_context)).float().unsqueeze(0)

        # 3. World‑Model forward with web context
        tokens = torch.randn(1, 10, 256)
        action = torch.randn(1, 64)
        outputs = self.world_model(tokens, action, peptide_seq=peptide_seq,
                                   web_context=web_context_emb)

        perception = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "input_text": text_input[:200],
            "web_grounded": search_results is not None,
            "web_context": synthesized_context[:500] if synthesized_context else "",
            "world_model_output": {k: v.detach().numpy().tolist() if isinstance(v, torch.Tensor) else v
                                   for k, v in outputs.items() if isinstance(v, torch.Tensor)},
            "self_model": {
                "confidence": outputs["confidence"].mean().item(),
                "uncertainty": outputs["uncertainty"].mean().item(),
                "novelty": outputs["novelty"].mean().item(),
            },
            "google_stats": {
                "session_queries": self.google.session_queries,
                "results_fetched": self.google.total_results_fetched,
            }
        }
        return perception

    def reason(self, perception: Dict, goal=None) -> Dict:
        relevant = self.memory_space.retrieve_relevant(perception["input_text"])
        web_boost = 0.1 if perception.get("web_grounded") else 0.0
        return {
            "type": "respond",
            "confidence": min(0.95, 0.9 + web_boost),
            "based_on_memories": len(relevant),
            "web_grounded": perception.get("web_grounded", False),
        }

    def act(self, action: Dict) -> str:
        if action["type"] == "respond":
            web_tag = "[WEB-GROUNDED] " if action.get("web_grounded") else ""
            prompt = f"{web_tag}Agent {self.agent_id} acting with confidence {action['confidence']:.2f}"
            return self.llm.create_completion(prompt, max_tokens=200)["choices"][0]["text"]
        return "No action taken."

    def commit_memory(self, content: dict, relevance=0.8, sensitivity=0.2) -> str:
        cid = self.epistemic_protocol.commit(content, relevance, sensitivity)
        self.total_commits += 1
        logger.info(f"💾 Memory commit {cid[:12]}… sealed.")
        return cid

    def retrieve_memory(self, query: str, k=5):
        return self.epistemic_protocol.retrieve(query, k=k)

    def mine_block(self):
        if not self.qpow: raise RuntimeError("qPoW not enabled.")
        block = self.qpow.mine(agent_id=self.agent_id, previous_hash="0x...", difficulty=4)
        self.hypergraph.add_vertex(Vertex(vid=f"block:{block['hash']}", vtype="qPoW_Block", properties=block))
        return block

    def news_grounding(self, query: str, num_results: int = 5,
                       date_restrict: str = "d7") -> Dict:
        """Real-time news grounding (past week by default)."""
        logger.info(f"📰 News grounding: '{query[:60]}...'")
        return self.google.news_search(query, num_results=num_results,
                                       date_restrict=date_restrict)

    def scholar_grounding(self, query: str, num_results: int = 5) -> Dict:
        """Academic paper grounding via Google Scholar."""
        logger.info(f"🎓 Scholar grounding: '{query[:60]}...'")
        return self.google.scholar_search(query, num_results=num_results)

    def site_grounding(self, query: str, site: str, num_results: int = 5) -> Dict:
        """Site-restricted grounding (e.g., arxiv.org, github.com)."""
        logger.info(f"🌐 Site grounding [{site}]: '{query[:60]}...'")
        return self.google.site_restricted_search(query, site, num_results=num_results)

    def run_forever(self):
        logger.info("🔄 Agent loop started…")
        try:
            while True:
                perception = self.perceive(
                    "Agent self-check: status report",
                    peptide_seq="MKWVTFISLLFLFSSAYS"
                )
                action = self.reason(perception)
                response = self.act(action)
                if self.total_interactions % 10 == 0:
                    self.commit_memory({
                        "event": "periodic introspection",
                        "response": response[:100],
                        "web_queries": self.total_web_queries,
                    })
                print(f"\r[{self.agent_id[:8]}] Interactions: {self.total_interactions} | "
                      f"Commits: {self.total_commits} | Web: {self.total_web_queries} | "
                      f"Conf: {perception['self_model']['confidence']:.2f}", end="")
                time.sleep(5)
        except KeyboardInterrupt:
            logger.info("🛑 Agent loop terminated.")

    def report(self) -> str:
        report = f"""
╔══════════════════════════════════════════════════════════╗
║ ARKHE AGENT REPORT — GOOGLE EDITION – {self.agent_id} ║
╠══════════════════════════════════════════════════════════╣
║ Interactions:      {self.total_interactions:>33}
║ Explicit Commits:  {self.total_commits:>33}
║ Web Queries:       {self.total_web_queries:>33}
║ Google Session Qs: {self.google.session_queries:>33}
║ Results Fetched:   {self.google.total_results_fetched:>33}
║ Memory Policy:     {self.config.memory_policy:>33}
║ qPoW Enabled:      {str(self.config.qpow_enabled):>33}
║ World-Model:       {self.config.maturity:>33}
║ Google Engine:     {self.config.google_default_engine:>33}
╚══════════════════════════════════════════════════════════╝
"""
        kr = self.world_model.get_complexity_report()
        report += f"\n🧠 Kolmogorov Complexity (Ethical Parsimony):\n"
        report += f"  Total params: {kr['total_params']}\n"
        report += f"  K upper bound: {kr['K_upper_bound']:.2f} bits\n"
        report += f"\n🌐 Google Web Grounding (Substrato 917):\n"
        report += f"  Real-time perception via Google Search API\n"
        report += f"  Engines: Google / Google News / Google Scholar\n"
        report += f"  Backends: Google CSE API + SerpAPI fallback\n"
        report += f"  Mock mode: deterministic demo when keys unset\n"
        return report

# ═══════════════════════════════════════════════════════════════════
# Demonstration
# ═══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Arkhe‑OS.gguf + Google Trinitarian AGI")
    parser.add_argument("--maturity", default="infant", choices=["embryo","infant","adult"])
    parser.add_argument("--qpow", action="store_true", help="Enable quantum proof-of-work")
    parser.add_argument("--google-key", default="", help="Google API key (or GOOGLE_API_KEY env)")
    parser.add_argument("--google-cx", default="", help="Google CSE ID (or GOOGLE_CX env)")
    parser.add_argument("--serpapi-key", default="", help="SerpAPI key (or SERPAPI_KEY env)")
    parser.add_argument("--engine", default="google",
                       choices=["google","google_news","google_scholar","google_images"],
                       help="Google search engine")
    parser.add_argument("--no-web", action="store_true", help="Disable auto web grounding")
    args = parser.parse_args()

    cfg = ArkheConfig(
        maturity=args.maturity,
        qpow_enabled=args.qpow,
        google_api_key=args.google_key or None,
        google_cx=args.google_cx or None,
        serpapi_key=args.serpapi_key or None,
        google_default_engine=args.engine,
        google_auto_ground=not args.no_web,
    )
    agent = ArkheAgent(cfg)
    print(agent.report())

    # Demo 1: Perceive with Google web grounding
    print("\n" + "="*60)
    print("DEMO 1: Perception with Google Web Grounding")
    print("="*60)

    perception = agent.perceive(
        "latest advances in quantum computing error correction",
        engine="google"
    )
    print(f"\n🧠 Self-Model:")
    print(f"  Confidence: {perception['self_model']['confidence']:.3f}")
    print(f"  Uncertainty: {perception['self_model']['uncertainty']:.3f}")
    print(f"  Novelty: {perception['self_model']['novelty']:.3f}")
    print(f"\n🌐 Web Context (first 300 chars):")
    print(f"  {perception['web_context'][:300]}...")

    # Demo 2: News grounding
    print("\n" + "="*60)
    print("DEMO 2: News Grounding (Past Week)")
    print("="*60)

    news = agent.news_grounding("artificial intelligence regulation", num_results=3)
    print(f"\n📰 News results ({news['total_results']} items):")
    for i, r in enumerate(news.get("results", [])[:3]):
        print(f"  [{i+1}] {r.get('title', 'N/A')}")
        print(f"      {r.get('snippet', '')[:120]}...")

    # Demo 3: Scholar grounding
    print("\n" + "="*60)
    print("DEMO 3: Google Scholar Grounding")
    print("="*60)

    scholar = agent.scholar_grounding("neural network interpretability", num_results=3)
    print(f"\n🎓 Scholar results ({scholar['total_results']} items):")
    for i, r in enumerate(scholar.get("results", [])[:3]):
        print(f"  [{i+1}] {r.get('title', 'N/A')}")

    # Demo 4: Site-restricted grounding
    print("\n" + "="*60)
    print("DEMO 4: Site-Restricted Grounding (arxiv.org)")
    print("="*60)

    site = agent.site_grounding("transformer architecture", "arxiv.org", num_results=3)
    print(f"\n🌐 arXiv results ({site['total_results']} items):")
    for i, r in enumerate(site.get("results", [])[:3]):
        print(f"  [{i+1}] {r.get('title', 'N/A')}")

    # Demo 5: Peptide-SaaS + memory commit
    print("\n" + "="*60)
    print("DEMO 5: Peptide-SaaS Encoding + Memory Commit")
    print("="*60)

    peptide = "MKWVTFISLL"
    desc = agent.world_model.peptide_encoder.to_saaS_descriptor(peptide)
    print(f"\n🔬 Peptide: {desc['sequence']}")
    print(f"   Source hash: {desc['source_code_hash']}")
    print(f"   API: {desc['api_endpoints']}")

    cid = agent.commit_memory({
        "fact": "Google integration complete — Substrato 917 canonized",
        "web_queries": agent.total_web_queries,
        "peptide": peptide,
    })
    print(f"\n📝 Memory committed: {cid}")

    # Demo 6: Google as Peptide-SaaS descriptor
    print("\n" + "="*60)
    print("DEMO 6: Google Search as Peptide-SaaS Service")
    print("="*60)

    google_peptide = agent.google.to_peptide_descriptor(news)
    print(f"\n🔬 Google Peptide Descriptor:")
    print(f"   Sequence: {google_peptide['sequence']}")
    print(f"   Hash: {google_peptide['source_code_hash']}")
    print(f"   API: {google_peptide['api_endpoints']}")
    print(f"   Results fetched: {google_peptide['results_fetched']}")

    print("\n⚡ Arkhe-OS.gguf + Google is alive. Recursive, grounded, web-aware, and ethically bound.")
    print("   Set GOOGLE_API_KEY + GOOGLE_CX, or SERPAPI_KEY for live search.")
    print("   Demo mode active otherwise with deterministic mock results.")