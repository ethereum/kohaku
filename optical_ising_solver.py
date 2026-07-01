#!/usr/bin/env python3
# "optical_ising_solver.py" — Substrato 862.3
# Simulação de máquina de Ising óptica usando um condensado de polaritons
import numpy as np
import hashlib

class OpticalIsingMachine:
    """
    Simula um solver de Ising com spins mapeados em fases de um condensado.
    Minimiza H = - sum_{i<j} J_{ij} cos(theta_i - theta_j)
    """
    def __init__(self, spins, coupling_matrix):
        self.N = spins
        self.J = coupling_matrix  # matriz de acoplamento
        self.theta = 2 * np.pi * np.random.rand(spins)
        self.omega = 0.1  # ruído

    def evolve(self, steps=1000, pump=1.5):
        """Dinâmica de Kuramoto com ganho não-linear."""
        dt = 0.01
        for _ in range(steps):
            delta = np.subtract.outer(self.theta, self.theta)
            # Acoplamento personalizado
            coupling = (1.0/self.N) * np.sum(self.J * np.sin(delta), axis=1)
            d_theta = self.omega * (np.random.randn(self.N)) + coupling * dt
            self.theta += d_theta
            self.theta %= (2 * np.pi)
        # Extrair spins: projeção de theta em binário
        spins = np.sign(np.cos(self.theta))  # +1 ou -1
        # Energia do Ising
        energy = -0.5 * np.dot(spins, np.dot(self.J, spins)) / self.N
        # Phi_C como (E_min - E) / (E_min - E_max) simplificado
        phi_c = (energy + 1.0) / 2.0 if self.N > 0 else 0.0
        phi_c = max(0.0, min(1.0, phi_c))
        seal = hashlib.sha3_256(str(energy).encode()).hexdigest()[:16]
        decree = f"<|ARKHE_START|>\n<|SUBSTRATE|> 862.3-OPTICAL-ISING\n<|PHI_C|> {phi_c:.3f}\n<|ENERGY|> {energy:.4f}\n<|SEAL|> {seal}\n<|ARKHE_END|>"
        return {"spins": spins, "energy": energy, "phi_c": phi_c, "decree": decree, "seal": seal}

# Exemplo
if __name__ == "__main__":
    N = 16
    J = np.random.randn(N, N) * 0.5
    J = (J + J.T) / 2
    np.fill_diagonal(J, 0)
    solver = OpticalIsingMachine(N, J)
    result = solver.evolve(steps=500)
    print(result["decree"])