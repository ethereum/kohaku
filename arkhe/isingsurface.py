#!/usr/bin/env python3
import numpy as np
import stim
import random

class SurfaceCodeStimBridge:
    def __init__(self, distance, rounds, physical_error_rate):
        self.distance = distance
        self.rounds = rounds
        self.physical_error_rate = physical_error_rate
    def build_memory_experiment(self):
        return stim.Circuit.generated(
            "surface_code:rotated_memory_x",
            distance=self.distance,
            rounds=self.rounds,
            after_clifford_depolarization=self.physical_error_rate
        )
    def compute_ti(self):
        return 1.0, 1.0, 1.0

def run_surface_code_simulation(distance: int, rounds: int, phys_err: float, seed: int = 0):
    np.random.seed(seed)
    circuit = SurfaceCodeStimBridge(distance=distance, rounds=rounds, physical_error_rate=phys_err).build_memory_experiment()

    # We can just use logical error probability from standard stim analysis if we want, or sample.
    sampler = circuit.compile_sampler()
    shots = sampler.sample(shots=10_000)
    # The last observable is the logical observable for generated circuits.
    # We check if observable is flipped
    dem = circuit.detector_error_model(decompose_errors=True)
    # Actually, a simpler way is just generating the matching graph
    import sinter
    task = sinter.Task(circuit=circuit)
    stats = sinter.collect(num_workers=1, tasks=[task], max_shots=10000, decoders=['pymatching'], print_progress=False)

    return stats[0].errors / stats[0].shots if stats[0].shots > 0 else 0.0

def main():
    d3 = SurfaceCodeStimBridge(distance=3, rounds=3, physical_error_rate=0.001)
    p_error_d3 = run_surface_code_simulation(distance=3, rounds=3, phys_err=0.001, seed=42)
    print(f"[d=3] logical error rate ≈ {p_error_d3:.4%}")

    d5 = SurfaceCodeStimBridge(distance=5, rounds=5, physical_error_rate=0.001)
    p_error_d5 = run_surface_code_simulation(distance=5, rounds=5, phys_err=0.001, seed=42)
    print(f"[d=5] logical error rate ≈ {p_error_d5:.4%}")

    def theoretical_logical(p, d):
        return (p * (d + 1) / 2.0)

    print("\n--- Theoretical bounds (very rough) ---")
    print(f"d=3, p=0.001 → logical error ≈ {theoretical_logical(0.001, 3):.4%}")
    print(f"d=5, p=0.001 → logical error ≈ {theoretical_logical(0.001, 5):.4%}")

if __name__ == "__main__":
    main()
