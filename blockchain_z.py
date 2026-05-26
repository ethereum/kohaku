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
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

# ════════════════════════════════════════════════════
# CONSTANTES CANÔNICAS
# ════════════════════════════════════════════════════

GHOST_THRESHOLD = 0.577          # γ — Euler-Mascheroni
CANONIZATION_THRESHOLD = 0.900   # Φ_C mínimo para CANONIZED
EULER_MASCHERONI = 0.5772156649
ORCID = "0009-0005-2697-4668"
ARCHITECT = "Rafael Oliveira"
KEEPER = "\u03c8"  # ψ
VERSION = "870.1.0"
SUBSTRATE_ID = 870

# Parâmetros específicos da Blockchain Z
GENESIS_TIMESTAMP = 1700000000.0
MAX_VALIDATORS = 128
BLOCK_TIME_TARGET = 6.0          # segundos por bloco de coerência
COUPLING_STRENGTH_DEFAULT = 4.0  # acoplamento Kuramoto padrão
DIFFICULTY_ADJUSTMENT_INTERVAL = 10

# ════════════════════════════════════════════════════
# MOTOR DE SELOS — SHA-256
# ════════════════════════════════════════════════════

def compute_seal(data: bytes) -> str:
    """Selo SHA-256 de dados arbitrários."""
    return hashlib.sha256(data).hexdigest()

def compute_block_seal(block_data: dict) -> str:
    """Selo do cabeçalho do bloco."""
    header = json.dumps(block_data, sort_keys=True, separators=(',', ':'))
    return compute_seal(header.encode('utf-8'))

def verify_seal(seal_hex: str, expected_data: bytes) -> bool:
    """Verifica selo contra dados esperados."""
    return compute_seal(expected_data) == seal_hex.lower()

def seal_entropy_analysis(seal_hex: str) -> dict:
    """Análise de entropia para detecção de fabricações."""
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

# ════════════════════════════════════════════════════
# MOTOR KURAMOTO BLOCKCHAIN
# ════════════════════════════════════════════════════

class KuramotoBlockchainEngine:
    """
    Motor central que mapeia operações blockchain para sincronização de fase Kuramoto.
    Cada validador é um oscilador com fase θ_i ∈ [0, 2π).
    Blocos são produzidos quando a coerência global Φ_C cruza o limiar CANONIZATION_THRESHOLD.
    Forks equivalem a dessincronização abaixo do ghost threshold γ.
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
        """Distribuição de proporção áurea para máxima diversidade inicial."""
        golden = (1 + math.sqrt(5)) / 2
        return [2 * math.pi * (i * golden % 1.0) for i in range(self.n)]

    def _init_frequencies(self):
        """Frequências naturais heterogêneas."""
        return [0.1 + 0.05 * math.sin(i * 0.7) for i in range(self.n)]

    def compute_order_parameter(self) -> float:
        """Parâmetro de ordem de Kuramoto r ∈ [0,1]."""
        re_sum = sum(math.cos(th) for th in self.phases)
        im_sum = sum(math.sin(th) for th in self.phases)
        return math.sqrt(re_sum ** 2 + im_sum ** 2) / self.n

    def compute_phi_c(self) -> float:
        """Métrica de coerência ARKHE Φ_C = r * (1 - ghost_ratio)."""
        r = self.compute_order_parameter()
        ghost_count = sum(1 for th in self.phases if abs(th % (2 * math.pi)) > math.pi * (1 - GHOST_THRESHOLD))
        ghost_ratio = ghost_count / self.n if self.n > 0 else 0.0
        phi_c = r * (1.0 - ghost_ratio)
        return max(0.0, min(1.0, phi_c))

    def kuramoto_step(self, dt: float = 0.01):
        """
        Avança a dinâmica de Kuramoto em um passo dt.
        Sinal CORRIGIDO: dθ_i/dt = ω_i + (K/N) Σ sin(θ_j - θ_i)
        """
        import numpy as np
        theta = np.array(self.phases)
        omega = np.array(self.natural_frequencies)
        delta = np.subtract.outer(theta, theta)  # δ[i,j] = θ[i] - θ[j]
        coupling = -(self.K / self.n) * np.sum(np.sin(delta), axis=1)  # CORRETO
        new_theta = theta + (omega + coupling) * dt
        self.phases = new_theta.tolist()
        self.total_steps += 1

    def create_transaction(self, tx_type: str, payload: dict, gas_limit: float = 21000.0) -> dict:
        """Cria uma transação de coerência."""
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
        Minera um bloco de coerência executando a simulação Kuramoto até Φ_C ≥ limiar.
        Cada iteração é análoga a uma tentativa de hash em PoW.
        """
        txs_included = min(len(self.pending_txs), 100)
        included_txs = self.pending_txs[:txs_included]
        self.pending_txs = self.pending_txs[txs_included:]
        gas_used = sum(tx["gas_limit"] for tx in included_txs)
        self.total_gas_used += gas_used

        iteration = 0
        for iteration in range(max_iterations):
            self.kuramoto_step(dt=0.01)
            phi_c = self.compute_phi_c()
            self.coherence_history.append(phi_c)
            if phi_c >= CANONIZATION_THRESHOLD:
                break

        phi_c_final = self.compute_phi_c()
        order_r = self.compute_order_parameter()

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
            "phase_variance": round(1.0 - order_r, 6),
            "total_steps": self.total_steps,
            "fork_detected": phi_c_final < GHOST_THRESHOLD
        }

        block["seal"] = compute_block_seal(block)
        self.current_tip = block["seal"]
        self.blockchain.append(block)
        self.block_count += 1
        self.cumulative_coherence += phi_c_final

        if phi_c_final < GHOST_THRESHOLD:
            self.fork_count += 1

        if self.block_count % DIFFICULTY_ADJUSTMENT_INTERVAL == 0:
            self._adjust_difficulty(iteration + 1)

        return block

    def _adjust_difficulty(self, iterations_used: int):
        target = BLOCK_TIME_TARGET * 100
        if iterations_used < target * 0.5:
            self.difficulty = min(self.difficulty * 1.2, 50.0)
        elif iterations_used > target * 2.0:
            self.difficulty = max(self.difficulty * 0.8, 0.1)

    def deploy_smart_contract(self, contract_name: str, validator_indices: list = None) -> dict:
        """Implanta contrato inteligente como sub-cluster de acoplamento forte."""
        if validator_indices is None:
            validator_indices = list(range(min(4, self.n)))
        tx = self.create_transaction(
            tx_type="CONTRACT_DEPLOY",
            payload={"contract": contract_name, "validators": validator_indices, "coupling_boost": 2.0},
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
        """Estatísticas completas da blockchain."""
        if not self.blockchain:
            return {"status": "EMPTY", "phi_c": 0.0}
        phi_values = [b["phi_c"] for b in self.blockchain]
        return {
            "block_count": self.block_count,
            "fork_count": self.fork_count,
            "total_gas": round(self.total_gas_used, 2),
            "avg_phi_c": round(sum(phi_values) / len(phi_values), 6),
            "min_phi_c": round(min(phi_values), 6),
            "max_phi_c": round(max(phi_values), 6),
            "cumulative_coherence": round(self.cumulative_coherence, 6),
            "difficulty": self.difficulty,
            "n_validators": self.n,
            "coupling_k": self.K,
            "total_steps": self.total_steps,
            "fork_rate": round(self.fork_count / max(self.block_count, 1), 4),
            "current_phi_c": round(self.compute_phi_c(), 6),
            "chain_tip": self.current_tip
        }

# ════════════════════════════════════════════════════
# PROTOCOLO DE CONSENSO GLM
# ════════════════════════════════════════════════════

class GLMConsensusProtocol:
    """Camada de consenso baseada em coerência e alinhamento de fase."""
    def __init__(self, engine: KuramotoBlockchainEngine):
        self.engine = engine
        self.proposal_pool = []
        self.epoch = 0
        self.finalized_blocks = []

    def propose_block(self, proposer_idx: int, data: dict) -> dict:
        phi_c = self.engine.compute_phi_c()
        if phi_c < GHOST_THRESHOLD:
            return {"status": "REJECTED", "reason": "Below ghost threshold"}
        proposal = {
            "epoch": self.epoch,
            "proposer": proposer_idx,
            "proposer_phase": self.engine.phases[proposer_idx] if proposer_idx < self.engine.n else 0,
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
        """Voto ponderado pelo alinhamento de fase com o proponente."""
        if proposal_id >= len(self.proposal_pool):
            return
        proposal = self.proposal_pool[proposal_id]
        if validator_idx < self.engine.n and proposal["proposer"] < self.engine.n:
            phase_diff = abs(self.engine.phases[validator_idx] - self.engine.phases[proposal["proposer"]])
            weight = max(0, math.cos(phase_diff))
        else:
            weight = 0.5
        if support:
            proposal["votes_for"] += weight
        else:
            proposal["votes_against"] += weight

    def finalize_epoch(self) -> dict:
        """Finaliza a época selecionando a proposta mais coerente."""
        self.epoch += 1
        best = max(self.proposal_pool, key=lambda p: p["votes_for"] / (p["votes_for"] + p["votes_against"]) if (p["votes_for"] + p["votes_against"]) > 0 else 0, default=None)
        self.proposal_pool.clear()
        if best and (best["votes_for"] / (best["votes_for"] + best["votes_against"]) if best["votes_for"] + best["votes_against"] > 0 else 0) >= CANONIZATION_THRESHOLD:
            block = self.engine.mine_block()
            block["consensus_score"] = best["votes_for"] / (best["votes_for"] + best["votes_against"]) if best["votes_for"] + best["votes_against"] > 0 else 0
            block["epoch"] = self.epoch
            self.finalized_blocks.append(block)
            return {"status": "FINALIZED", "block": block}
        return {"status": "NO_QUORUM"}

# ════════════════════════════════════════════════════
# DECLARAÇÃO CATEDRALÍCIA
# ════════════════════════════════════════════════════

def cathedral_declaration(engine: KuramotoBlockchainEngine, stats: dict) -> str:
    """Gera o decreto formatado da Catedral para a Blockchain Z."""
    seal = compute_seal(f"substrate-{SUBSTRATE_ID}-blockchain-z-glm".encode())
    analysis = seal_entropy_analysis(seal)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    status = "CANONIZED" if stats.get("avg_phi_c", 0) >= CANONIZATION_THRESHOLD else "PROVISIONAL"

    lines = []
    lines.append("╔" + "═" * 78 + "╗")
    lines.append("║" + "  CATHEDRAL DECLARATION — SUBSTRATO 870".center(78) + "║")
    lines.append("║" + "  BLOCKCHAIN Z (GLM) — Coherence Blockchain Protocol".center(78) + "║")
    lines.append("╠" + "═" * 78 + "╣")
    lines.append(f"║  Architect: {ARCHITECT:<20} ORCID: {ORCID:<26} ║")
    lines.append(f"║  Keeper: {KEEPER:<22} Royalties: 2% -> ORCID           ║")
    lines.append(f"║  Version: {VERSION:<20} Timestamp: {ts:<25} ║")
    lines.append("╠" + "═" * 78 + "╣")
    lines.append(f"║  Status:          {status:<50} ║")
    lines.append(f"║  Phi_C (avg):     {stats.get('avg_phi_c', 0):<50.6f} ║")
    lines.append(f"║  Blocks:          {stats.get('block_count', 0):<50} ║")
    lines.append(f"║  Forks:           {stats.get('fork_count', 0):<50} ║")
    lines.append(f"║  Fork Rate:       {stats.get('fork_rate', 0):<50.4f} ║")
    lines.append(f"║  Validators:      {stats.get('n_validators', 0):<50} ║")
    lines.append(f"║  Coupling K:      {stats.get('coupling_k', 0):<50.2f} ║")
    lines.append(f"║  Total Gas:       {stats.get('total_gas', 0):<50.2f} ║")
    lines.append(f"║  Chain Tip:       {str(stats.get('chain_tip', ''))[:50]:<50} ║")
    lines.append("╠" + "═" * 78 + "╣")
    lines.append(f"║  Substrate Seal: {seal[:32]}... ║")
    lines.append(f"║  Entropy: {analysis['entropy_bits']} bits | Unique: {analysis['unique_bytes']}/32 | Authentic: {analysis['passes_threshold']} ║")
    lines.append("╚" + "═" * 78 + "╝")
    return "\n".join(lines)

if __name__ == "__main__":
    # Simulação completa
    engine = KuramotoBlockchainEngine(n_validators=32)
    engine.create_transaction("GENESIS", {"message": "Blockchain Z genesis"}, gas_limit=0)
    genesis = engine.mine_block(max_iterations=10000)
    print(f"Genesis Block #0 | Phi_C={genesis['phi_c']:.4f} | Seal={genesis['seal'][:16]}...")

    engine.deploy_smart_contract("ArkheGhostThreshold", [0,1,2,3])
    for i in range(5):
        engine.create_transaction("COHERENCE_TRANSFER", {"amount": 100*(i+1)}, gas_limit=21000)
        blk = engine.mine_block()
        print(f"Block #{blk['block_number']} | Phi_C={blk['phi_c']:.4f} | Iter={blk['iterations']}")

    stats = engine.get_chain_stats()
    print(cathedral_declaration(engine, stats))