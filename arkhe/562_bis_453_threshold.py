#!/usr/bin/env python3
# 562-BIS-453-THRESHOLD — Concrete threshold experiment for d=3 and d=5
import stim, sinter
import numpy as np, matplotlib.pyplot as plt
import os

# Build circuits for different distances and physical error rates
def build_surface_circuit(distance: int, rounds: int, p: float) -> stim.Circuit:
    return stim.Circuit.generated(
        code_task="surface_code:rotated_memory_x",
        distance=distance,
        rounds=rounds,
        after_clifford_depolarization=p,
    )

# Configuration
distances = [3, 5]
error_rates = np.logspace(-3, -1.5, 4)          # 0.001 to ~0.03
rounds = 9                                       # enough for threshold visibility

# Generate tasks for Sinter
tasks = []
os.makedirs("/tmp/arkhe", exist_ok=True)
for d in distances:
    for p in error_rates:
        circuit = build_surface_circuit(d, rounds, p)
        dem = circuit.detector_error_model(decompose_errors=True)
        # Write to files (for reproducibility)
        circuit.to_file(f"/tmp/arkhe/d{d}_p{p:.4f}.stim")
        dem.to_file(f"/tmp/arkhe/d{d}_p{p:.4f}.dem")
        tasks.append(sinter.Task(
            circuit=stim.Circuit.from_file(f"/tmp/arkhe/d{d}_p{p:.4f}.stim"),
            detector_error_model=stim.DetectorErrorModel.from_file(f"/tmp/arkhe/d{d}_p{p:.4f}.dem"),
            json_metadata={"d": d, "p": p},
        ))

# Run collection (adjust workers for your hardware)
stats = sinter.collect(num_workers=4, tasks=tasks, max_shots=5000, max_errors=50,
                       decoders=["pymatching"], print_progress=True)

# Extract logical error rate per round
def logical_rate(stat):
    effective = stat.shots - stat.discards
    if effective == 0: return float('nan')
    return stat.errors / effective

# Plot threshold
for d in distances:
    d_stats = [s for s in stats if s.json_metadata["d"] == d]
    p_vals = [s.json_metadata["p"] for s in d_stats]
    lers = [logical_rate(s) for s in d_stats]
    plt.loglog(p_vals, lers, 'o-', label=f'd={d}')

plt.axvline(0.01, color='gray', linestyle='--', label='~1% threshold (literature)')
plt.xlabel('Physical error rate p')
plt.ylabel('Logical error rate per round')
plt.legend()
plt.grid(True, alpha=0.3)
plt.savefig('surface_code_threshold.png', dpi=200)
print("Threshold plot saved. Expected crossing near p≈0.01.")