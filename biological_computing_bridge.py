#!/usr/bin/env python3
# "biological_computing_bridge.py" — Substrato 859
# Simulador de circuitos genéticos para ARKHE OS
import numpy as np
from scipy.integrate import solve_ivp
import hashlib

class Repressilator:
    """
    Modelo determinístico do repressilador (Elowitz & Leibler, 2000).
    Três genes reprimindo-se em ciclo: A ⊣ B ⊣ C ⊣ A.
    """
    def __init__(self, alpha=100, beta=1, n=2, gamma=1):
        self.alpha = alpha      # taxa de produção máxima
        self.beta = beta        # constante de dissociação do repressor
        self.n = n              # cooperatividade de Hill
        self.gamma = gamma      # taxa de degradação/diluição

    def ode_repressilator(self, t, y):
        """Sistema de EDOs."""
        m_A, p_A, m_B, p_B, m_C, p_C = y
        # Repressão: produção de mRNA inibida pela proteína anterior
        f_A = self.alpha / (1 + (p_C / self.beta)**self.n)
        f_B = self.alpha / (1 + (p_A / self.beta)**self.n)
        f_C = self.alpha / (1 + (p_B / self.beta)**self.n)

        # mRNAs
        dmA = -self.gamma * m_A + f_A
        dmB = -self.gamma * m_B + f_B
        dmC = -self.gamma * m_C + f_C
        # Proteínas
        dpA = -self.gamma * p_A + self.gamma * m_A
        dpB = -self.gamma * p_B + self.gamma * m_B
        dpC = -self.gamma * p_C + self.gamma * m_C
        return [dmA, dpA, dmB, dpB, dmC, dpC]

    def simulate(self, T=200, dt=0.1):
        """Simula e retorna as séries temporais das proteínas."""
        t_eval = np.arange(0, T, dt)
        y0 = np.array([0.1, 0.2, 0.3, 0.1, 0.2, 0.5])
        sol = solve_ivp(self.ode_repressilator, [0, T], y0, t_eval=t_eval, method='RK45')
        pA = sol.y[1]  # proteína A
        pB = sol.y[3]  # proteína B
        pC = sol.y[5]  # proteína C
        return sol.t, pA, pB, pC

class BiologicalArkheBridge:
    def __init__(self):
        self.circuit = Repressilator()

    def measure_biological_coherence(self) -> dict:
        """Executa o repressilador e calcula a coerência de oscilação entre as três proteínas."""
        t, pA, pB, pC = self.circuit.simulate(T=150)
        # Calcular fases via Hilbert transform (ou picos)
        # Simplificação: usar correlação cruzada normalizada como coerência
        def sync_index(x, y):
            # Correlação cruzada no lag zero
            x_norm = (x - np.mean(x)) / np.std(x)
            y_norm = (y - np.mean(y)) / np.std(y)
            return np.corrcoef(x_norm, y_norm)[0,1]

        sync_AB = sync_index(pA[-500:], pB[-500:])  # último terço
        sync_BC = sync_index(pB[-500:], pC[-500:])
        sync_CA = sync_index(pC[-500:], pA[-500:])
        phi_c = (sync_AB + sync_BC + sync_CA) / 3  # média
        phi_c = max(0.0, phi_c)  # evitar negativo

        status = "COHERENT" if phi_c >= 0.577 else "DECOHERENCE"
        seal = hashlib.sha3_256(str(phi_c).encode()).hexdigest()[:16]
        decree = f"""<|ARKHE_START|>
<|SUBSTRATE|> 859-REPRESSILATOR
<|INVARIANT|> I.1 (Coherence Base)
<|PHI_C|> {phi_c:.3f}

Circuito Biológico Repressilador executado.
Genes: A, B, C (oscilador de três nós)
Sincronia média (Φ_C): {phi_c:.3f}
Ghost Threshold (γ): 0.577 | Status: {status}

<|SEAL|> {seal}
<|ARKHE_END|>"""
        return {"phi_c": phi_c, "decree": decree, "seal": seal}

# Exemplo de uso
if __name__ == "__main__":
    bridge = BiologicalArkheBridge()
    result = bridge.measure_biological_coherence()
    print(result["decree"])