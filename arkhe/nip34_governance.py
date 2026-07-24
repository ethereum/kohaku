#!/usr/bin/env python3
"""
ARKHE OS Substrate 603 — NIP-34 Governance Protocol
Arquiteto: ORCID 0009-0005-2697-4668
Data: 2026-05-23
STRICT MODE

Models NIP-34 as an alternative to TemporalChain for governance decisions,
with final anchor on the TemporalChain for immutability.

NIP-34: https://github.com/nostr-protocol/nips/blob/master/34.md
"""

import json
import hashlib
import time
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum


class DecisionStatus(Enum):
    PROPOSED = "proposed"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXECUTED = "executed"
    ANCHORED = "anchored"


class DecisionType(Enum):
    CONSTITUTIONAL_AMENDMENT = "constitutional_amendment"  # P1-P7 changes
    SUBSTRATE_ADOPTION = "substrate_adoption"
    PARAMETER_CHANGE = "parameter_change"
    EMERGENCY_ACTION = "emergency_action"
    ROYALTY_ADJUSTMENT = "royalty_adjustment"


@dataclass
class GovernanceDecision:
    """A governance decision following NIP-34 structure."""

    # NIP-34 core fields
    id: str  # SHA-256 of canonical JSON
    kind: int  # 38002 = ARKHE governance event
    pubkey: str  # Proposer's npub
    created_at: int
    content: str  # Human-readable description

    # ARKHE-specific tags (NIP-34 compatible)
    decision_type: str
    target_substrate: Optional[str]
    proposed_value: Any
    previous_value: Optional[Any]

    # Review process
    reviewers: List[str]  # List of reviewer npubs
    approvals: List[str]  # npubs that approved
    rejections: List[str]  # npubs that rejected

    # Status
    status: str
    quorum_required: float  # e.g., 0.67 for 2/3

    # TemporalChain anchor
    temporal_anchor_tx: Optional[str]  # Transaction hash on TemporalChain
    temporal_anchor_block: Optional[int]

    # Metadata
    constitutional_principles: List[str]  # Which P1-P7 principles affected
    impact_assessment: str

    def compute_id(self) -> str:
        """Compute deterministic ID from canonical representation."""
        canonical = {
            "kind": self.kind,
            "created_at": self.created_at,
            "content": self.content,
            "tags": [
                ["decision_type", self.decision_type],
                ["target_substrate", self.target_substrate or ""],
                ["proposed_value", json.dumps(self.proposed_value)],
                ["previous_value", json.dumps(self.previous_value) if self.previous_value else ""],
                ["quorum", str(self.quorum_required)],
                ["principles", ",".join(self.constitutional_principles)],
            ]
        }
        canonical_json = json.dumps(canonical, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(canonical_json.encode()).hexdigest()

    def to_nostr_event(self) -> Dict:
        """Convert to Nostr event format (NIP-34)."""
        return {
            "id": self.id,
            "pubkey": self.pubkey,
            "created_at": self.created_at,
            "kind": self.kind,
            "tags": [
                ["d", self.id[:16]],  # NIP-34 identifier tag
                ["decision_type", self.decision_type],
                ["target_substrate", self.target_substrate or ""],
                ["status", self.status],
                ["quorum", str(self.quorum_required)],
                ["principles", ",".join(self.constitutional_principles)],
                ["reviewers"] + self.reviewers,
                ["approvals"] + self.approvals,
                ["rejections"] + self.rejections,
                ["temporal_anchor", self.temporal_anchor_tx or ""],
                ["e", self.id, "", "root"],  # Thread root
            ],
            "content": json.dumps({
                "description": self.content,
                "proposed_value": self.proposed_value,
                "previous_value": self.previous_value,
                "impact_assessment": self.impact_assessment,
            }),
            "sig": ""  # To be filled by signer
        }

    def check_quorum(self) -> bool:
        """Check if quorum is reached."""
        total_reviewers = len(self.reviewers)
        if total_reviewers == 0:
            return False
        approval_ratio = len(self.approvals) / total_reviewers
        return approval_ratio >= self.quorum_required

    def transition_status(self, new_status: DecisionStatus) -> bool:
        """Attempt status transition with validation."""
        valid_transitions = {
            DecisionStatus.PROPOSED: [DecisionStatus.UNDER_REVIEW],
            DecisionStatus.UNDER_REVIEW: [DecisionStatus.APPROVED, DecisionStatus.REJECTED],
            DecisionStatus.APPROVED: [DecisionStatus.EXECUTED],
            DecisionStatus.EXECUTED: [DecisionStatus.ANCHORED],
        }

        current = DecisionStatus(self.status)
        if new_status in valid_transitions.get(current, []):
            self.status = new_status.value
            return True
        return False


class NIP34Governance:
    """NIP-34 governance engine for ARKHE OS."""

    ARKHE_KIND = 38002  # Custom kind for ARKHE governance

    def __init__(self, relay_urls: List[str], temporal_chain_client=None):
        self.relay_urls = relay_urls
        self.temporal_chain = temporal_chain_client
        self.decisions: Dict[str, GovernanceDecision] = {}

    def propose(self,
                pubkey: str,
                decision_type: DecisionType,
                content: str,
                proposed_value: Any,
                target_substrate: Optional[str] = None,
                previous_value: Any = None,
                reviewers: Optional[List[str]] = None,
                quorum: float = 0.67,
                principles: Optional[List[str]] = None) -> GovernanceDecision:
        """Propose a new governance decision."""

        decision = GovernanceDecision(
            id="",  # Will be computed
            kind=self.ARKHE_KIND,
            pubkey=pubkey,
            created_at=int(time.time()),
            content=content,
            decision_type=decision_type.value,
            target_substrate=target_substrate,
            proposed_value=proposed_value,
            previous_value=previous_value,
            reviewers=reviewers or [],
            approvals=[],
            rejections=[],
            status=DecisionStatus.PROPOSED.value,
            quorum_required=quorum,
            temporal_anchor_tx=None,
            temporal_anchor_block=None,
            constitutional_principles=principles or [],
            impact_assessment=""
        )

        decision.id = decision.compute_id()
        self.decisions[decision.id] = decision
        return decision

    def review(self, decision_id: str, reviewer_npub: str, approve: bool) -> bool:
        """Submit a review (approve or reject)."""
        decision = self.decisions.get(decision_id)
        if not decision:
            return False

        if reviewer_npub not in decision.reviewers:
            return False

        if approve:
            if reviewer_npub not in decision.approvals:
                decision.approvals.append(reviewer_npub)
            if reviewer_npub in decision.rejections:
                decision.rejections.remove(reviewer_npub)
        else:
            if reviewer_npub not in decision.rejections:
                decision.rejections.append(reviewer_npub)
            if reviewer_npub in decision.approvals:
                decision.approvals.remove(reviewer_npub)

        # Auto-transition if quorum reached
        if decision.check_quorum() and decision.status == DecisionStatus.UNDER_REVIEW.value:
            decision.transition_status(DecisionStatus.APPROVED)

        return True

    def execute(self, decision_id: str) -> bool:
        """Execute an approved decision."""
        decision = self.decisions.get(decision_id)
        if not decision or decision.status != DecisionStatus.APPROVED.value:
            return False

        # Perform execution logic here
        success = decision.transition_status(DecisionStatus.EXECUTED)
        return success

    async def anchor_to_temporal_chain(self, decision_id: str) -> Optional[str]:
        """Anchor decision to TemporalChain for final immutability."""
        decision = self.decisions.get(decision_id)
        if not decision or decision.status != DecisionStatus.EXECUTED.value:
            return None

        if not self.temporal_chain:
            return None

        # Create anchor transaction
        anchor_data = {
            "arkhe_decision_id": decision.id,
            "nostr_event_id": decision.id,
            "decision_type": decision.decision_type,
            "proposed_value": decision.proposed_value,
            "timestamp": decision.created_at,
            "seal": hashlib.sha256(json.dumps(decision.to_nostr_event(), sort_keys=True).encode()).hexdigest()
        }

        # Submit to TemporalChain
        try:
            tx_hash = await self.temporal_chain.submit_anchor(anchor_data)
            decision.temporal_anchor_tx = tx_hash
            decision.temporal_anchor_block = await self.temporal_chain.get_latest_block()
            decision.transition_status(DecisionStatus.ANCHORED)
            return tx_hash
        except Exception as e:
            print(f"[ERROR] TemporalChain anchor failed: {e}")
            return None

    def get_decision_history(self, substrate_id: Optional[str] = None) -> List[GovernanceDecision]:
        """Get decision history, optionally filtered by substrate."""
        decisions = list(self.decisions.values())
        if substrate_id:
            decisions = [d for d in decisions if d.target_substrate == substrate_id]
        return sorted(decisions, key=lambda d: d.created_at)


# ── Example Usage ─────────────────────────────────────────

def example():
    """Demonstrate NIP-34 governance flow."""

    gov = NIP34Governance(
        relay_urls=["wss://relay.damus.io", "wss://relay.nostr.band"]
    )

    # Propose constitutional amendment (P3: Augmentatism)
    decision = gov.propose(
        pubkey="npub1arkhe...",
        decision_type=DecisionType.CONSTITUTIONAL_AMENDMENT,
        content="Amend P3 (Augmentatism) to include Nostr-based Inter-Agent Economy",
        proposed_value={
            "principle": "P3",
            "text": "Augmentatism — Every agent may discover and hire other agents via Nostr relays",
            "version": "2.1"
        },
        previous_value={
            "principle": "P3",
            "text": "Augmentatism — Every agent may discover and hire other agents via IPFS DHT",
            "version": "2.0"
        },
        target_substrate="603-HASHTREE-CC",
        reviewers=[
            "npub1reviewer1...",
            "npub1reviewer2...",
            "npub1reviewer3...",
        ],
        quorum=0.67,
        principles=["P3", "P7"]
    )

    print(f"Proposed decision: {decision.id}")
    print(f"Status: {decision.status}")

    # Move to review
    decision.transition_status(DecisionStatus.UNDER_REVIEW)

    # Reviews
    gov.review(decision.id, "npub1reviewer1...", approve=True)
    gov.review(decision.id, "npub1reviewer2...", approve=True)

    print(f"After 2 approvals: {decision.status}")
    print(f"Quorum reached: {decision.check_quorum()}")

    # Third approval triggers auto-approval
    gov.review(decision.id, "npub1reviewer3...", approve=True)
    print(f"After quorum: {decision.status}")

    # Convert to Nostr event
    event = decision.to_nostr_event()
    print(f"\nNostr Event (kind {event['kind']}):")
    print(json.dumps(event, indent=2))

if __name__ == "__main__":
    example()
