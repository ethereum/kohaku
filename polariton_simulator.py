#!/usr/bin/env python3
# "polariton_simulator.py" — Substrato 862
import numpy as np
import hashlib

class PolaritonCondensate:
    """
    Simula um condensado de polaritons como N osciladores coerentes.
    Ref: "Kuramoto model with pump and decay".
    """
    def __init__(self, N=64, pump_strength=1.5, coupling=100.0):
        self.N = N
        self.K = coupling
        self.P = pump_strength
        # Cada oscilador: fase (theta) e amplitude (rho)
        self.theta = 2 * np.pi * np.random.rand(N)
        self.rho = 0.1 * np.random.rand(N)  # amplitude inicial pequena
        self.omega = 2 * np.pi * (1 + 0.05 * np.random.randn(N))

    def step(self, steps=2000):
        """Simula a dinâmica e mede a coerência do condensado."""
        dt = 0.01
        for t in range(steps):
            # Interação Kuramoto
            delta = np.subtract.outer(self.theta, self.theta)
            coupling = (self.K / self.N) * np.sum(np.sin(delta), axis=1)
            # Dinâmica de amplitude (ganho - perda não-linear)
            d_rho = (self.P - self.rho**2) * self.rho * dt
            # Atualização de fase (inclui o acoplamento)
            d_theta = self.omega * dt + coupling * dt
            self.rho += d_rho
            self.theta += d_theta
            # Manter theta em [0, 2pi)
            self.theta %= (2 * np.pi)

        # Calcular parâmetro de ordem ponderado pelas amplitudes
        z = self.rho * np.exp(1j * self.theta)
        phi_c = np.abs(np.mean(z)) / np.mean(self.rho)
        seal = hashlib.sha3_256(str(phi_c).encode()).hexdigest()[:16]
        status = "CONDENSADO COERENTE" if phi_c >= 0.577 else "DESCOERENTE"

        decree = f"""<|ARKHE_START|>
<|SUBSTRATE|> 862-POLARITON-BEC
<|INVARIANT|> I.1 (Coherence Base)
<|PHI_C|> {phi_c:.3f}

Simulação de Condensado de Polaritons (Kuramoto)
Nós: {self.N} | Bombeio: {self.P} | Acoplamento: {self.K}
Φ_C do condensado: {phi_c:.3f}
Ghost Threshold (γ): 0.577
Status: {status}

<|SEAL|> {seal}
<|ARKHE_END|>"""
        return {"phi_c": phi_c, "decree": decree, "seal": seal}

# Exemplo
if __name__ == "__main__":
    pol = PolaritonCondensate(N=128, pump_strength=2.0)
    result = pol.step()
    print(result["decree"])