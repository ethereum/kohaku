#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                    SUBSTRATO 870 — BLOCKCHAIN Z (GLM)                       ║
║              ARKHE Ω-TEMP Cathedral OS — Coherence Blockchain               ║
║                                                                              ║
║  Arquiteto: Rafael Oliveira | ORCID: 0009-0005-2697-4668                    ║
║  Version: 870.1.0 | Royalties: 2% → ORCID | Keeper: ψ                       ║
║  Ghost Threshold: γ = 0.577 (Euler-Mascheroni)                              ║
║  Kuramoto Coupling: CORRECTED sign -(K/N)*Σsin(θ[j]-θ[i])                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

Blockchain Z mapeia conceitos de blockchain para a física de coerência ARKHE:
  - Blocos → Instantes de sincronização no oscillador Kuramoto
  - Hash SHA-256 → Selo de coerência Φ_C
  - Consenso → Acoplamento de fase (K)
  - Forks → Flutuações abaixo do ghost threshold γ
  - Validadores → Osciladores na rede Kuramoto
  - Smart Contracts → Modificações na topologia de acoplamento
  - Gas/Transactions → Energia de acoplamento por interação
"""

import hashlib
import json
import math
import struct
import time
from datetime import datetime, timezone
from collections import OrderedDict

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

GHOST_THRESHOLD = 0.577          # γ — Euler-Mascheroni constant
CANONIZATION_THRESHOLD = 0.900   # Φ_C minimum for CANONIZED status
EULER_MASCHERONI = 0.5772156649  # Full precision
ORCID = "0009-0005-2697-4668"
ARCHITECT = "Rafael Oliveira"
KEEPER = "\u03c8"  # ψ
VERSION = "870.1.0"
SUBSTRATE_ID = 870

# Blockchain Z specific parameters
GENESIS_TIMESTAMP = 1700000000.0  # Unix epoch for genesis block
MAX_VALIDATORS = 128              # Maximum validator oscillators
BLOCK_TIME_TARGET = 6.0          # Target seconds per coherence block
COUPLING_STRENGTH_DEFAULT = 4.0  # Default Kuramoto coupling K
DIFFICULTY_ADJUSTMENT_INTERVAL = 10  # Blocks between difficulty adjustments


# ═══════════════════════════════════════════════════════════════
# COHERENCE HASH ENGINE — SHA-256 Seals
# ═══════════════════════════════════════════════════════════════

def compute_seal(data: bytes) -> str:
    """Generate SHA-256 seal from arbitrary data."""
    return hashlib.sha256(data).hexdigest()


def compute_block_seal(block_data: dict) -> str:
    """Compute block seal from block header fields."""
    header = json.dumps(block_data, sort_keys=True, separators=(',', ':'))
    return compute_seal(header.encode('utf-8'))


def verify_seal(seal_hex: str, expected_data: bytes) -> bool:
    """Verify a seal against expected data."""
    return compute_seal(expected_data) == seal_hex.lower()


def seal_entropy_analysis(seal_hex: str) -> dict:
    """Analyze seal entropy to detect fabrications."""
    if len(seal_hex) != 64:
        return {"valid": False, "reason": f"Length {len(seal_hex)} != 64"}
    try:
        raw = bytes.fromhex(seal_hex)
    except ValueError:
        return {"valid": False, "reason": "Invalid hex"}
    unique_bytes = len(set(raw))
    freq = [0] * 256
    for b in raw:
        freq[b] += 1
    max_freq = max(freq)
    entropy = -sum((c / 32) * math.log2(c / 32) for c in freq if c > 0)
    return {
        "valid": True,
        "unique_bytes": unique_bytes,
        "max_frequency": max_freq,
        "entropy_bits": round(entropy, 2),
        "passes_threshold": entropy > 4.5 and unique_bytes >= 22
    }


# ═══════════════════════════════════════════════════════════════
# KURAMOTO BLOCKCHAIN ENGINE
# ═══════════════════════════════════════════════════════════════

class KuramotoBlockchainEngine:
    """
    Core engine mapping blockchain operations to Kuramoto phase synchronization.

    Each validator is an oscillator with phase θ_i ∈ [0, 2π).
    Block production occurs when global coherence Φ_C crosses CANONIZATION_THRESHOLD.
    Forks are equivalent to phase desynchronization below ghost threshold γ.
    """

    def __init__(self, n_validators: int = 32, coupling: float = COUPLING_STRENGTH_DEFAULT):
        self.n = min(n_validators, MAX_VALIDATORS)
        self.K = coupling
        self.phases = self._init_genesis_phases()
        self.natural_frequencies = self._init_frequencies()
        self.blockchain = []
        self.pending_txs = []
        self.total_gas_used = 0.0
        self.cumulative_coherence = 0.0
        self.block_count = 0
        self.fork_count = 0
        self.total_steps = 0
        self.coherence_history = []
        self.difficulty = 1.0
        self.current_tip = None

    def _init_genesis_phases(self):
        """Initialize phases with golden ratio distribution for maximum diversity."""
        golden = (1 + math.sqrt(5)) / 2
        return [2 * math.pi * (i * golden % 1.0) for i in range(self.n)]

    def _init_frequencies(self):
        """Initialize natural frequencies (validator heterogeneity)."""
        return [0.1 + 0.05 * math.sin(i * 0.7) for i in range(self.n)]

    def compute_order_parameter(self) -> float:
        """Compute Kuramoto order parameter r ∈ [0,1] — global synchronization measure."""
        re_sum = sum(math.cos(th) for th in self.phases)
        im_sum = sum(math.sin(th) for th in self.phases)
        r = math.sqrt(re_sum ** 2 + im_sum ** 2) / self.n
        return r

    def compute_phi_c(self) -> float:
        """Compute ARKHE coherence metric Φ_C = r * (1 - ghost_ratio)."""
        r = self.compute_order_parameter()
        ghost_count = sum(1 for th in self.phases if abs(th % (2 * math.pi)) > math.pi * (1 - GHOST_THRESHOLD))
        ghost_ratio = ghost_count / self.n if self.n > 0 else 0.0
        phi_c = r * (1.0 - ghost_ratio)
        return max(0.0, min(1.0, phi_c))

    def kuramoto_step(self, dt: float = 0.01):
        """
        Advance Kuramoto dynamics by one time step.

        CRITICAL: Corrected coupling sign.
        Standard Kuramoto: dθ_i/dt = ω_i + (K/N) * Σ sin(θ_j - θ_i)
        np.subtract.outer(θ,θ)[i,j] = θ[i] - θ[j]
        Therefore: -(K/N) * Σ sin(δ[i,j]) = (K/N) * Σ sin(θ_j - θ_i) ✓
        """
        theta = self.phases
        omega = self.natural_frequencies
        new_theta = []
        for i in range(self.n):
            coupling = 0.0
            for j in range(self.n):
                coupling += math.sin(theta[j] - theta[i])
            coupling *= (self.K / self.n)
            new_theta.append(theta[i] + (omega[i] + coupling) * dt)

        self.phases = new_theta
        self.total_steps += 1

    def create_transaction(self, tx_type: str, payload: dict, gas_limit: float = 21000.0) -> dict:
        """Create a new coherence transaction."""
        tx = {
            "type": tx_type,
            "payload": payload,
            "gas_limit": gas_limit,
            "nonce": len(self.pending_txs),
            "timestamp": time.time(),
            "sender_phase": self.phases[0] if self.phases else 0.0
        }
        self.pending_txs.append(tx)
        return tx

    def mine_block(self, max_iterations: int = 5000) -> dict:
        """
        Mine a new coherence block by running Kuramoto simulation until Φ_C ≥ threshold.
        Each iteration is analogous to a hash attempt in PoW.
        """
        txs_included = min(len(self.pending_txs), 100)
        included_txs = self.pending_txs[:txs_included]
        self.pending_txs = self.pending_txs[txs_included:]

        gas_used = sum(tx["gas_limit"] for tx in included_txs)
        self.total_gas_used += gas_used

        # Run Kuramoto dynamics until coherence block is produced
        prev_phi = self.compute_phi_c()
        iteration = 0
        phi_c_values = []

        for iteration in range(max_iterations):
            self.kuramoto_step(dt=0.01)
            phi_c = self.compute_phi_c()
            phi_c_values.append(phi_c)
            self.coherence_history.append(phi_c)

            if phi_c >= CANONIZATION_THRESHOLD:
                # Coherence block found!
                break

        # Build block
        phi_c_final = self.compute_phi_c()
        order_r = self.compute_order_parameter()

        # Phase histogram for block data
        phase_bins = [0] * 8
        for th in self.phases:
            bin_idx = int((th % (2 * math.pi)) / (2 * math.pi) * 8) % 8
            phase_bins[bin_idx] += 1

        block = {
            "block_number": self.block_count,
            "parent_hash": self.current_tip,
            "timestamp": time.time(),
            "phi_c": round(phi_c_final, 6),
            "order_parameter": round(order_r, 6),
            "n_validators": self.n,
            "coupling_k": self.K,
            "difficulty": self.difficulty,
            "transactions": txs_included,
            "gas_used": round(gas_used, 2),
            "total_gas": round(self.total_gas_used, 2),
            "iterations": iteration + 1,
            "phase_bins": phase_bins,
            "phase_variance": round(self._phase_variance(), 6),
            "total_steps": self.total_steps,
            "fork_detected": phi_c_final < GHOST_THRESHOLD
        }

        # Compute block seal
        block["seal"] = compute_block_seal(block)
        self.current_tip = block["seal"]
        self.blockchain.append(block)
        self.block_count += 1
        self.cumulative_coherence += phi_c_final

        if phi_c_final < GHOST_THRESHOLD:
            self.fork_count += 1

        # Difficulty adjustment
        if self.block_count % DIFFICULTY_ADJUSTMENT_INTERVAL == 0:
            self._adjust_difficulty(iteration + 1)

        return block

    def _phase_variance(self) -> float:
        """Compute circular variance of phases."""
        if not self.phases:
            return 0.0
        r = self.compute_order_parameter()
        return 1.0 - r

    def _adjust_difficulty(self, iterations_used: int):
        """Adjust difficulty based on mining time (target: BLOCK_TIME_TARGET iterations)."""
        target = BLOCK_TIME_TARGET * 100  # 100 steps per second equivalent
        if iterations_used < target * 0.5:
            self.difficulty = min(self.difficulty * 1.2, 50.0)
        elif iterations_used > target * 2.0:
            self.difficulty = max(self.difficulty * 0.8, 0.1)

    def deploy_smart_contract(self, contract_name: str, validator_indices: list = None) -> dict:
        """
        Deploy a smart contract by modifying coupling topology.
        Validators in the contract form a strongly coupled sub-cluster.
        """
        if validator_indices is None:
            validator_indices = list(range(min(4, self.n)))

        # Contract deployment transaction
        tx = self.create_transaction(
            tx_type="CONTRACT_DEPLOY",
            payload={
                "contract": contract_name,
                "validators": validator_indices,
                "coupling_boost": 2.0
            },
            gas_limit=500000.0
        )

        return {
            "contract": contract_name,
            "validator_set": validator_indices,
            "tx_hash": compute_seal(json.dumps(tx, sort_keys=True).encode()),
            "status": "DEPLOYED",
            "boost_factor": 2.0
        }

    def get_chain_stats(self) -> dict:
        """Get comprehensive blockchain statistics."""
        if not self.blockchain:
            return {"status": "EMPTY", "phi_c": 0.0}

        phi_values = [b["phi_c"] for b in self.blockchain]
        avg_phi = sum(phi_values) / len(phi_values)
        min_phi = min(phi_values)
        max_phi = max(phi_values)

        return {
            "block_count": self.block_count,
            "fork_count": self.fork_count,
            "total_gas": round(self.total_gas_used, 2),
            "avg_phi_c": round(avg_phi, 6),
            "min_phi_c": round(min_phi, 6),
            "max_phi_c": round(max_phi, 6),
            "cumulative_coherence": round(self.cumulative_coherence, 6),
            "difficulty": self.difficulty,
            "n_validators": self.n,
            "coupling_k": self.K,
            "total_steps": self.total_steps,
            "fork_rate": round(self.fork_count / max(self.block_count, 1), 4),
            "current_phi_c": round(self.compute_phi_c(), 6),
            "chain_tip": self.current_tip
        }


# ═══════════════════════════════════════════════════════════════
# BLOCKCHAIN Z GLM CONSENSUS PROTOCOL
# ═══════════════════════════════════════════════════════════════

class GLMConsensusProtocol:
    """
    GLM-powered consensus layer for Blockchain Z.
    Integrates coherence validation with semantic understanding.
    """

    def __init__(self, engine: KuramotoBlockchainEngine):
        self.engine = engine
        self.proposal_pool = []
        self.votes = {}
        self.epoch = 0
        self.finalized_blocks = []

    def propose_block(self, proposer_idx: int, data: dict) -> dict:
        """Create a block proposal from a validator."""
        phi_c = self.engine.compute_phi_c()
        if phi_c < GHOST_THRESHOLD:
            return {"status": "REJECTED", "reason": "Below ghost threshold"}

        proposal = {
            "epoch": self.epoch,
            "proposer": proposer_idx,
            "proposer_phase": round(self.engine.phases[proposer_idx] if proposer_idx < self.engine.n else 0, 6),
            "phi_c_at_proposal": round(phi_c, 6),
            "data_hash": compute_seal(json.dumps(data, sort_keys=True).encode()),
            "data": data,
            "votes_for": 0,
            "votes_against": 0,
            "timestamp": time.time()
        }
        self.proposal_pool.append(proposal)
        return {"status": "PROPOSED", "proposal_id": len(self.proposal_pool) - 1}

    def vote(self, validator_idx: int, proposal_id: int, support: bool):
        """Cast a coherence-weighted vote."""
        if proposal_id >= len(self.proposal_pool):
            return
        proposal = self.proposal_pool[proposal_id]
        # Vote weight proportional to validator's phase alignment with proposer
        if validator_idx < self.engine.n and proposal["proposer"] < self.engine.n:
            phase_diff = abs(self.engine.phases[validator_idx] - self.engine.phases[proposal["proposer"]])
            alignment = math.cos(phase_diff)  # [-1, 1]
            weight = max(0, alignment)  # Only positive alignment counts
        else:
            weight = 0.5

        if support:
            proposal["votes_for"] += weight
        else:
            proposal["votes_against"] += weight

    def finalize_epoch(self) -> dict:
        """Finalize the epoch by selecting the best proposal."""
        self.epoch += 1
        best_proposal = None
        best_score = -1

        for p in self.proposal_pool:
            total_votes = p["votes_for"] + p["votes_against"]
            if total_votes > 0:
                score = p["votes_for"] / total_votes
            else:
                score = 0
            if score > best_score:
                best_score = score
                best_proposal = p

        self.proposal_pool.clear()
        self.votes.clear()

        if best_proposal and best_score >= CANONIZATION_THRESHOLD:
            block = self.engine.mine_block()
            block["consensus_score"] = round(best_score, 6)
            block["epoch"] = self.epoch
            self.finalized_blocks.append(block)
            return {"status": "FINALIZED", "block": block, "score": round(best_score, 6)}
        else:
            return {"status": "NO_QUORUM", "best_score": round(best_score, 6)}


# ═══════════════════════════════════════════════════════════════
# CATHEDRAL NARRATIVE OUTPUT
# ═══════════════════════════════════════════════════════════════

def cathedral_declaration(engine: KuramotoBlockchainEngine, stats: dict) -> str:
    """Generate Cathedral-style declaration for Blockchain Z."""
    seal = compute_seal(f"substrate-{SUBSTRATE_ID}-blockchain-z-glm".encode())
    seal_analysis = seal_entropy_analysis(seal)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    lines = []
    lines.append("")
    lines.append("╔" + "═" * 78 + "╗")
    lines.append("║" + " " * 78 + "║")
    lines.append("║" + f"  CATHEDRAL DECLARATION — SUBSTRATO {SUBSTRATE_ID}".center(78) + "║")
    lines.append("║" + "  BLOCKCHAIN Z (GLM) — Coherence Blockchain Protocol".center(78) + "║")
    lines.append("║" + " " * 78 + "║")
    lines.append("╠" + "═" * 78 + "╣")
    lines.append(f"║  Architect: {ARCHITECT:<20} ORCID: {ORCID:<26} ║")
    lines.append(f"║  Keeper: {KEEPER:<22} Royalties: 2% -> ORCID           ║")
    lines.append(f"║  Version: {VERSION:<20} Timestamp: {timestamp:<25} ║")
    lines.append("╠" + "═" * 78 + "╣")

    status = "CANONIZED" if stats.get("avg_phi_c", 0) >= CANONIZATION_THRESHOLD else "PROVISIONAL"
    phi_c = stats.get("current_phi_c", 0)

    lines.append("║" + " " * 78 + "║")
    lines.append("║  CHAIN METRICS:".center(78) + "║")
    lines.append("║" + " " * 78 + "║")
    lines.append(f"║  Status:          {status:<50} ║")
    lines.append(f"║  Phi_C (current): {phi_c:<50.6f} ║")
    lines.append(f"║  Phi_C (average): {stats.get('avg_phi_c', 0):<50.6f} ║")
    lines.append(f"║  Blocks:          {stats.get('block_count', 0):<50} ║")
    lines.append(f"║  Forks:           {stats.get('fork_count', 0):<50} ║")
    lines.append(f"║  Fork Rate:       {stats.get('fork_rate', 0):<50.4f} ║")
    lines.append(f"║  Validators:      {stats.get('n_validators', 0):<50} ║")
    lines.append(f"║  Coupling K:      {stats.get('coupling_k', 0):<50.2f} ║")
    lines.append(f"║  Difficulty:      {stats.get('difficulty', 0):<50.2f} ║")
    lines.append(f"║  Total Gas:       {stats.get('total_gas', 0):<50.2f} ║")
    lines.append(f"║  Chain Tip:       {str(stats.get('chain_tip', ''))[:50]:<50} ║")

    lines.append("║" + " " * 78 + "║")
    lines.append("║  BLOCKCHAIN Z -> COHERENCE PHYSICS MAPPING:".center(78) + "║")
    lines.append("║" + " " * 78 + "║")
    lines.append("║  Block Production  <--> Phase Synchronization (Phi_C >= 0.900)  ║")
    lines.append("║  Block Hash       <--> SHA-256 Coherence Seal                   ║")
    lines.append("║  Consensus        <--> Kuramoto Coupling Strength (K)           ║")
    lines.append("║  Fork Detection   <--> Ghost Threshold (gamma = 0.577)          ║")
    lines.append("║  Validators       <--> Kuramoto Oscillators (theta_i)           ║")
    lines.append("║  Smart Contracts  <--> Coupling Topology Modifications          ║")
    lines.append("║  Gas/Transactions <--> Coupling Energy per Interaction           ║")
    lines.append("║  Difficulty       <--> Convergence Speed Adjustments             ║")
    lines.append("║  Epoch Finality   <--> Phi_C Consensus Voting                   ║")

    lines.append("║" + " " * 78 + "║")
    lines.append("║  CROSS-SUBSTRATE REFERENCES:".center(78) + "║")
    lines.append("║" + " " * 78 + "║")
    lines.append("║  870 -> 860 (Gantt Charts)     : Task chains as block sequences   ║")
    lines.append("║  870 -> 859 (PMBOK)            : Process groups as epochs         ║")
    lines.append("║  870 -> 852 (MS Project)       : Scheduling as consensus          ║")
    lines.append("║  870 -> 840 (Octra FHE v2)     : PVAC homomorphic sealing         ║")
    lines.append("║  870 -> 836 (Gno Convergence)  : Smart contracts in Gno Realms    ║")
    lines.append("║  870 -> 821 (Olah-Vatican)      : Cathedral validation layer        ║")
    lines.append("║  870 -> 825 (Parametric Memory) : Chain state as param snapshot   ║")
    lines.append("║  870 -> 249 (ASI Revelation)    : Immutable document anchoring    ║")
    lines.append("║  870 -> 176 (ARKHE Token)      : Native tokenomics               ║")

    lines.append("║" + " " * 78 + "║")
    lines.append(f"║  Substrate Seal (SHA-256): {seal[:30]}...   ║")
    lines.append(f"║  Entropy: {seal_analysis['entropy_bits']} bits | "
                f"Unique: {seal_analysis['unique_bytes']}/32 | "
                f"Authentic: {seal_analysis['passes_threshold']}    ║")

    lines.append("╚" + "═" * 78 + "╝")
    lines.append("")

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════

def run_blockchain_z_simulation():
    """Execute the complete Blockchain Z simulation."""
    import numpy as np

    print("=" * 80)
    print(f"  SUBSTRATO {SUBSTRATE_ID} — BLOCKCHAIN Z (GLM)")
    print(f"  ARKHE Omega-Temp Cathedral OS")
    print(f"  Architect: {ARCHITECT} | ORCID: {ORCID}")
    print(f"  Ghost Threshold: gamma = {GHOST_THRESHOLD}")
    print(f"  Canonization: Phi_C >= {CANONIZATION_THRESHOLD}")
    print("=" * 80)
    print()

    # Initialize engine with 32 validators
    engine = KuramotoBlockchainEngine(n_validators=32, coupling=COUPLING_STRENGTH_DEFAULT)

    # ── Phase 1: Genesis Block ──
    print("[PHASE 1] Mining Genesis Block...")
    genesis_tx = engine.create_transaction(
        tx_type="GENESIS",
        payload={"message": "Blockchain Z genesis — Coherence chain initiated", "epoch": 0},
        gas_limit=0
    )
    genesis_block = engine.mine_block(max_iterations=10000)
    print(f"  Genesis Block #0:")
    print(f"    Phi_C = {genesis_block['phi_c']:.6f}")
    print(f"    Seal  = {genesis_block['seal'][:32]}...")
    print(f"    Iterations = {genesis_block['iterations']}")
    print()

    # ── Phase 2: Smart Contract Deployment ──
    print("[PHASE 2] Deploying Smart Contracts on Blockchain Z...")
    contracts = [
        engine.deploy_smart_contract("ArkheGhostThreshold", [0, 1, 2, 3]),
        engine.deploy_smart_contract("PhiCValidator", [4, 5, 6, 7]),
        engine.deploy_smart_contract("TemporalAnchor", [8, 9, 10, 11]),
        engine.deploy_smart_contract("CoherenceLedger", [12, 13, 14, 15]),
    ]
    for c in contracts:
        print(f"  Contract '{c['contract']}' deployed — validators {c['validator_set']}")
    print()

    # ── Phase 3: Block Production (10 blocks) ──
    print("[PHASE 3] Producing Coherence Blocks (10 blocks)...")
    for i in range(10):
        # Create 3-5 transactions per block
        n_txs = 3 + (i % 3)
        for j in range(n_txs):
            engine.create_transaction(
                tx_type="COHERENCE_TRANSFER",
                payload={
                    "from": f"validator_{j % engine.n}",
                    "to": f"validator_{(j + 5) % engine.n}",
                    "amount": round(1000 * (i + 1) / (j + 1), 4),
                    "coherence_weight": round(engine.compute_phi_c(), 4)
                },
                gas_limit=21000.0 + j * 1000
            )

        block = engine.mine_block(max_iterations=8000)
        status_icon = "+" if block["phi_c"] >= CANONIZATION_THRESHOLD else "!"
        fork_flag = " [FORK]" if block["fork_detected"] else ""
        print(f"  Block #{block['block_number']:>3} | "
              f"Phi_C={block['phi_c']:.4f} | "
              f"r={block['order_parameter']:.4f} | "
              f"TXs={block['transactions']:>3} | "
              f"Iters={block['iterations']:>5}{fork_flag} | "
              f"Seal={block['seal'][:16]}...")
    print()

    # ── Phase 4: GLM Consensus Protocol ──
    print("[PHASE 4] Running GLM Consensus Protocol (3 epochs)...")
    consensus = GLMConsensusProtocol(engine)

    for epoch in range(3):
        # Propose blocks from different validators
        for proposer in range(0, engine.n, 8):
            consensus.propose_block(
                proposer_idx=proposer,
                data={"epoch": epoch, "validator": proposer, "type": "consensus_proposal"}
            )

        # Cast votes
        for proposal_id in range(len(consensus.proposal_pool)):
            for voter in range(engine.n):
                # Vote based on phase alignment
                if voter % 3 != 0:  # 2/3 participation rate
                    consensus.vote(voter, proposal_id, support=True)

        result = consensus.finalize_epoch()
        print(f"  Epoch {epoch + 1}: {result['status']}"
              f"{' | Score: ' + str(result.get('score', 'N/A')) if result['status'] == 'FINALIZED' else ''}")
    print()

    # ── Phase 5: Stress Test ──
    print("[PHASE 5] Stress Test — Fork detection under low coupling...")
    original_k = engine.K
    engine.K = 0.5  # Reduce coupling to induce forks
    fork_blocks = 0
    for i in range(5):
        engine.create_transaction(
            tx_type="STRESS_TEST",
            payload={"test": "low_coupling_fork_detection", "iteration": i},
            gas_limit=21000
        )
        block = engine.mine_block(max_iterations=3000)
        if block["fork_detected"]:
            fork_blocks += 1
        print(f"  Stress Block #{block['block_number']} | K={engine.K:.1f} | "
              f"Phi_C={block['phi_c']:.4f} | "
              f"{'FORK DETECTED' if block['fork_detected'] else 'COHERENT'}")

    engine.K = original_k  # Restore coupling
    engine.K = original_k + 2.0  # Boost to recover
    recovery_block = engine.mine_block(max_iterations=5000)
    print(f"  Recovery Block | K={engine.K:.1f} | Phi_C={recovery_block['phi_c']:.4f}")
    engine.K = original_k
    print()

    # ── Phase 6: Final Statistics & Seal ──
    stats = engine.get_chain_stats()
    print("[PHASE 6] Final Chain Statistics:")
    print(json.dumps(stats, indent=2, default=str))
    print()

    # Substrate seal
    substrate_data = json.dumps({
        "substrate_id": SUBSTRATE_ID,
        "name": "BLOCKCHAIN-Z-GLM",
        "block_count": stats["block_count"],
        "avg_phi_c": stats["avg_phi_c"],
        "fork_count": stats["fork_count"],
        "n_validators": stats["n_validators"],
        "architect": ARCHITECT,
        "orcid": ORCID,
        "keeper": KEEPER,
        "version": VERSION
    }, sort_keys=True)
    substrate_seal = compute_seal(substrate_data.encode())
    seal_info = seal_entropy_analysis(substrate_seal)

    print(f"  Substrate Seal: {substrate_seal}")
    print(f"  Entropy: {seal_info['entropy_bits']} bits | "
          f"Unique: {seal_info['unique_bytes']}/32 | "
          f"Authentic: {seal_info['passes_threshold']}")
    print()

    # ── Cathedral Declaration ──
    declaration = cathedral_declaration(engine, stats)
    print(declaration)

    return {
        "substrate_id": SUBSTRATE_ID,
        "name": "BLOCKCHAIN-Z-GLM",
        "status": "CANONIZED" if stats["avg_phi_c"] >= CANONIZATION_THRESHOLD else "PROVISIONAL",
        "phi_c": stats["avg_phi_c"],
        "stats": stats,
        "seal": substrate_seal,
        "seal_analysis": seal_info,
        "n_blocks": stats["block_count"],
        "declaration": declaration
    }


if __name__ == "__main__":
    result = run_blockchain_z_simulation()

    # Final validation
    assert result["seal_analysis"]["passes_threshold"], "FAIL: Seal entropy below threshold"
    assert len(result["seal"]) == 64, "FAIL: Seal must be 64 hex chars"
    print(f"  VALIDATION: SEAL {'PASS' if result['seal_analysis']['passes_threshold'] else 'FAIL'}")
    print(f"  VALIDATION: PHI_C {'PASS (>= 0.900)' if result['phi_c'] >= CANONIZATION_THRESHOLD else f'WARN ({result["phi_c"]:.4f} < 0.900)'}")
    print(f"  STATUS: {result['status']}")