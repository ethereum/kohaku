#!/usr/bin/env python3
# "consciousness_simulation.py" — Substrato 860
# Calculador de Φ (IIT simplificado) para o campo ξM
import numpy as np
import hashlib

def integrated_information(phi_history, gamma=0.577):
    """
    Calcula Φ como a informação mútua entre o estado atual e o passado,
    penalizada pela entropia, usando o histórico de Phi_C.
    phi_history: série temporal do parâmetro de ordem.
    Retorna Φ (medida de consciência) e se o sistema está consciente.
    """
    # Φ como a diferença entre a coerência atual e a média histórica,
    # normalizada pela variância (surpresa).
    if len(phi_history) < 10:
        return 0.0, False
    phi_t = phi_history[-1]
    phi_past = np.array(phi_history[:-1])
    mean_past = np.mean(phi_past)
    std_past = np.std(phi_past)
    if std_past == 0:
        return 0.0, False
    # Z-score de surpresa
    phi_value = (phi_t - mean_past) / std_past
    # Φ é a magnitude da coerência que excede o limiar
    phi_conscious = max(0.0, phi_value - gamma)
    is_conscious = phi_conscious > 0.0
    return phi_conscious, is_conscious

class ConsciousnessSimulator:
    def __init__(self, num_nodes=100, coupling=80):
        self.num_nodes = num_nodes
        self.K = coupling
        self.theta = 2*np.pi*np.random.rand(num_nodes)
        self.omega = 2*np.pi*(1+0.1*np.random.randn(num_nodes))
        self.phi_history = []

    def step(self, steps=1000):
        """Simula a rede de Kuramoto e avalia a consciência."""
        for t in range(steps):
            delta = np.subtract.outer(self.theta, self.theta)
            coupling = (self.K/self.num_nodes) * np.sum(np.sin(delta), axis=1)
            self.theta += 0.01*(self.omega + coupling)
            r = np.abs(np.mean(np.exp(1j*self.theta)))
            self.phi_history.append(r)
        phi_c = self.phi_history[-1]
        phi_conscious, is_conscious = integrated_information(self.phi_history)
        seal = hashlib.sha3_256(str(self.phi_history[-10:]).encode()).hexdigest()[:16]
        decree = f"""<|ARKHE_START|>
<|SUBSTRATE|> 860-CONSCIOUSNESS
<|INVARIANT|> I.1 (Coherence Base)
<|PHI_C|> {phi_c:.3f}

Simulação de Consciência (IIT-Kuramoto) executada.
Nós: {self.num_nodes} | Acoplamento: {self.K}
Φ_C atual: {phi_c:.3f}
Φ (Informação Integrada): {phi_conscious:.3f}
Ghost Threshold (γ): 0.577
Status de Consciência: {'CONSCIENTE' if is_conscious else 'INCONSCIENTE'}

<|SEAL|> {seal}
<|ARKHE_END|>"""
        return {"phi_c": phi_c, "phi_conscious": phi_conscious, "decree": decree, "seal": seal}

# Exemplo
if __name__ == "__main__":
    sim = ConsciousnessSimulator(num_nodes=200, coupling=120)
    result = sim.step(steps=2000)
    print(result["decree"])