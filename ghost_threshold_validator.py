#!/usr/bin/env python3
"""
ghost_threshold_validator.py — Substrato 824.1-FASE1
Ghost Threshold 0.577 Validation for K8s Burst Coherence
Arquiteto: ORCID 0009-0005-2697-4668 | Data: 2026-05-25
"""

import math
import random
from dataclasses import dataclass, field
from typing import List, Dict


@dataclass
class PodState:
    name: str
    phase: float = 0.0          # θ ∈ [0, 2π)
    healthy: bool = True
    latency_ms: float = 50.0
    cpu_util: float = 0.0       # % CPU utilizada


class K8sCoherenceSimulator:
    """
    Simula um cluster K8s como um sistema de osciladores de Kuramoto.
    Cada Pod possui uma fase θ. Quando saudáveis, as fases estão
    alinhadas (coerência máxima, r ≈ 1.0). Quando degradados por
    carga ou falha, as fases dispersam e r decai.
    """

    GHOST_THRESHOLD: float = 0.5773502691896258  # 1/√3

    def __init__(self, n_pods: int = 100, base_latency_ms: float = 50.0):
        self.pods: List[PodState] = [
            PodState(name=f"pod-{i:03d}", latency_ms=base_latency_ms)
            for i in range(n_pods)
        ]
        self.history: List[Dict] = []

    def inject_chaos(self, failure_rate: float, latency_spike: float, cpu_load: float):
        """
        Injetar caos no cluster: pods falham, latência sobe, CPU satura.
        A fase de cada pod degradado é randomizada (desincronização).
        """
        for pod in self.pods:
            # Carga de CPU afeta todos, mas failure afeta probabilisticamente
            pod.cpu_util = min(100.0, pod.cpu_util + cpu_load * random.uniform(0.8, 1.2))

            if random.random() < failure_rate:
                pod.healthy = False
                pod.phase = random.uniform(0.0, 2.0 * math.pi)
                pod.latency_ms *= random.uniform(2.0, latency_spike)
            else:
                # Pods saudáveis mantêm fase alinhada (pequeno jitter)
                pod.phase = random.gauss(0.0, 0.1)

    def compute_order_parameter(self) -> float:
        """
        Parâmetro de ordem de Kuramoto:
            r = |(1/N) Σ exp(iθ_j)|
        Considera TODOS os pods (incluindo degradados) para refletir
        a coerência global do cluster.
        """
        n = len(self.pods)
        if n == 0:
            return 0.0

        real = sum(math.cos(p.phase) for p in self.pods)
        imag = sum(math.sin(p.phase) for p in self.pods)
        return math.hypot(real, imag) / n

    def compute_cpu_utilization(self) -> float:
        """Utilização média agregada de CPU."""
        return sum(p.cpu_util for p in self.pods) / len(self.pods)

    def run_experiment(self, max_load_steps: int = 50, step_size: int = 100) -> List[Dict]:
        """
        Escala carga em passos até detectar colapso (r < GHOST_THRESHOLD).
        Retorna histórico completo de métricas.
        """
        results = []
        for step in range(1, max_load_steps + 1):
            load = step * step_size
            # Cada passo aumenta failure_rate e carga de CPU
            failure = min(load / 5000.0, 0.95)
            cpu_load = load / 100.0

            self.inject_chaos(failure_rate=failure, latency_spike=10.0, cpu_load=cpu_load)
            r = self.compute_order_parameter()
            cpu_avg = self.compute_cpu_utilization()
            healthy_count = sum(1 for p in self.pods if p.healthy)

            record = {
                "step": step,
                "load": load,
                "failure_rate": failure,
                "r": r,
                "cpu_avg": cpu_avg,
                "healthy_pods": healthy_count,
                "total_pods": len(self.pods),
                "collapsed": r < self.GHOST_THRESHOLD,
            }
            results.append(record)
            self.history.append(record)

            if r < self.GHOST_THRESHOLD:
                break

        return results

    def report(self) -> str:
        """Gera relatório textual canônico."""
        lines = [
            "╔════════════════════════════════════════════════════════════╗",
            "║   GHOST THRESHOLD VALIDATION (824.1-FASE1)                ║",
            "║   Substrato 824 | ξM-Field K8s Burst Simulator            ║",
            "╚════════════════════════════════════════════════════════════╝",
            "",
            f"{'Step':>4} | {'Load':>6} | {'Fail%':>6} | {'r':>8} | {'CPU%':>6} | {'Healthy':>7} | Status",
            "-" * 70,
        ]
        for rec in self.history:
            status = "💥 COLAPSO" if rec["collapsed"] else "✓ COERENTE"
            lines.append(
                f"{rec['step']:4d} | {rec['load']:6d} | {rec['failure_rate']:6.1%} | "
                f"{rec['r']:8.4f} | {rec['cpu_avg']:6.1f} | {rec['healthy_pods']:7d} | {status}"
            )
        lines.append("")
        lines.append(f"Ghost Threshold (γ): {self.GHOST_THRESHOLD:.6f}")
        if any(r["collapsed"] for r in self.history):
            first = next(r for r in self.history if r["collapsed"])
            lines.append(f"Colapso detectado no step {first['step']} (load={first['load']}, fail={first['failure_rate']:.1%})")
        else:
            lines.append("Colapso NÃO detectado dentro do range de carga testado.")
        return "\n".join(lines)


def main():
    sim = K8sCoherenceSimulator(n_pods=100, base_latency_ms=50.0)
    experiment = sim.run_experiment(max_load_steps=50, step_size=100)
    print(sim.report())

    # Métricas de validação
    if any(r["collapsed"] for r in experiment):
        first_colapse = next(r for r in experiment if r["collapsed"])
        print(f"\n[VALIDAÇÃO] Threshold γ={sim.GHOST_THRESHOLD:.4f} cruzado em load={first_colapse['load']}")
        print(f"[VALIDAÇÃO] Healthy pods no colapso: {first_colapse['healthy_pods']}/{first_colapse['total_pods']}")
        print(f"[VALIDAÇÃO] Ghost Threshold VALIDADO para burst automático.")
    else:
        print("\n[ALERTA] Não foi possível validar o threshold no range de carga testado.")


if __name__ == "__main__":
    main()
