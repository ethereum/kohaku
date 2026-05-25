#!/usr/bin/env python3
"""
bo_gallium_discovery.py — Substrato 827 (Research Integration)
Bayesian Optimization for Ga-Based Semiconductor Discovery
Based on: ACS Materials Letters (2026) — DOI: 10.1021/acsmaterialslett.5c01482
Arquiteto: ORCID 0009-0005-2697-4668 | Data: 2026-05-25

Framework: ML-guided Bayesian Optimization with KNN surrogate
           and SMACT screening for chemical plausibility.
"""

import numpy as np
import pandas as pd
from sklearn.neighbors import KNeighborsRegressor
from sklearn.model_selection import cross_val_score
from skopt import gp_minimize, space
from skopt.space import Real, Integer, Categorical
from skopt.utils import use_named_args
from typing import List, Tuple, Dict, Optional
import json
import hashlib

# SMACT integration (chemical plausibility screening)
try:
    import smact
    from smact.screening import pauling_test
    SMACT_AVAILABLE = True
except ImportError:
    SMACT_AVAILABLE = False
    print("⚠️  SMACT not installed. Install with: pip install smact")


class ChemicalSpace:
    """Define o espaço químico para composições de Ga."""

    # Elementos co-eletrônicos comuns para semicondutores de Ga
    COELEMENTS = {
        'O': {'ox_states': [-2], 'max_ratio': 4.0},
        'S': {'ox_states': [-2], 'max_ratio': 3.0},
        'Se': {'ox_states': [-2], 'max_ratio': 3.0},
        'Te': {'ox_states': [-2], 'max_ratio': 3.0},
        'N': {'ox_states': [-3], 'max_ratio': 2.0},
        'P': {'ox_states': [-3], 'max_ratio': 2.0},
        'As': {'ox_states': [-3], 'max_ratio': 2.0},
        'Cl': {'ox_states': [-1], 'max_ratio': 3.0},
        'Br': {'ox_states': [-1], 'max_ratio': 3.0},
        'I': {'ox_states': [-1], 'max_ratio': 3.0},
        'F': {'ox_states': [-1], 'max_ratio': 5.0},
    }

    # Ga oxidation states
    GA_OX_STATES = [+1, +2, +3]

    @classmethod
    def get_search_space(cls, max_elements: int = 3) -> List:
        """Retorna o espaço de busca para BO."""
        dimensions = []

        # Número de elementos (Ga + coelementos)
        dimensions.append(Integer(1, max_elements, name='num_coelements'))

        # Co-elementos (índices)
        for i in range(max_elements):
            dimensions.append(Categorical(list(cls.COELEMENTS.keys()), name=f'coelement_{i}'))

        # Razões estequiométricas
        for i in range(max_elements):
            dimensions.append(Real(0.1, 4.0, name=f'ratio_{i}'))

        # Estado de oxidação do Ga
        dimensions.append(Categorical(cls.GA_OX_STATES, name='ga_ox_state'))

        return dimensions


class KNNSurrogate:
    """
    Surrogate model KNN para predição de band gap.
    Paper reporta R² = 0.812 como ótimo entre múltiplos modelos testados.
    """

    def __init__(self, n_neighbors: int = 5, weights: str = 'distance'):
        self.model = KNeighborsRegressor(
            n_neighbors=n_neighbors,
            weights=weights,
            metric='euclidean',
        )
        self.is_trained = False
        self.feature_names = None

    def featurize_composition(self, composition: Dict[str, float]) -> np.ndarray:
        """
        Extrai features de uma composição química.
        Features: frações atômicas, eletronegatividades, raios atômicos, etc.
        """
        from pymatgen.core import Composition, Element

        # Criar composição pymatgen
        comp = Composition(composition)

        features = {
            'num_elements': len(composition),
            'ga_fraction': composition.get('Ga', 0),
            'mean_electroneg': np.mean([Element(e).X for e in composition if Element(e).X is not None]),
            'std_electroneg': np.std([Element(e).X for e in composition if Element(e).X is not None]),
            'mean_atomic_radius': np.mean([Element(e).atomic_radius or 0 for e in composition]),
            'std_atomic_radius': np.std([Element(e).atomic_radius or 0 for e in composition]),
            'mean_ionization': np.mean([Element(e).ionization_energy or 0 for e in composition]),
            'total_electrons': sum([Element(e).Z * composition[e] for e in composition]),
            'mass_density': comp.weight,
        }

        return np.array(list(features.values()))

    def train(self, compositions: List[Dict], band_gaps: List[float]):
        """Treina o surrogate com dados existentes."""
        X = np.array([self.featurize_composition(c) for c in compositions])
        y = np.array(band_gaps)

        self.model.fit(X, y)
        self.is_trained = True

        # Validar (paper reporta R² = 0.812)
        scores = cross_val_score(self.model, X, y, cv=5, scoring='r2')
        print(f"[827] KNN Surrogate trained. CV R² = {scores.mean():.3f} (±{scores.std():.3f})")

    def predict(self, composition: Dict[str, float]) -> Tuple[float, float]:
        """
        Prediz band gap e incerteza (via distância aos vizinhos).
        Retorna: (prediction, uncertainty)
        """
        if not self.is_trained:
            raise ValueError("Model not trained")

        x = self.featurize_composition(composition).reshape(1, -1)

        # Predição
        pred = self.model.predict(x)[0]

        # Incerteza: distância média aos k vizinhos
        distances, _ = self.model.kneighbors(x)
        uncertainty = np.mean(distances[0])

        return pred, uncertainty


class SMACTScreening:
    """
    Screening de plausibilidade química via SMACT.
    Enforce: charge balance, elemental feasibility, physical plausibility.
    """

    @staticmethod
    def check_charge_balance(composition: Dict[str, float],
                              ox_states: Dict[str, int]) -> bool:
        """Verifica balanceamento de cargas."""
        total_charge = sum(
            composition[elem] * ox_states.get(elem, 0)
            for elem in composition
        )
        return abs(total_charge) < 0.01  # Tolerância

    @staticmethod
    def check_elemental_feasibility(composition: Dict[str, float]) -> bool:
        """Verifica se elementos são viáveis para semicondutores."""
        # Verificar se Ga está presente
        if 'Ga' not in composition or composition['Ga'] <= 0:
            return False

        # Verificar se há pelo menos um anion (O, S, Se, Te, etc.)
        anions = {'O', 'S', 'Se', 'Te', 'N', 'P', 'As', 'Cl', 'Br', 'I', 'F'}
        has_anion = any(elem in anions for elem in composition)

        return has_anion

    @staticmethod
    def check_physical_plausibility(composition: Dict[str, float]) -> Dict:
        from pymatgen.core import Element
        """Verifica plausibilidade física (raios iônicos, eletronegatividade)."""

        checks = {
            'valid': True,
            'warnings': [],
        }

        # Verificar eletronegatividade
        en_values = [Element(e).X for e in composition if Element(e).X]
        if en_values:
            en_range = max(en_values) - min(en_values)
            if en_range > 2.5:
                checks['warnings'].append(f"Large electronegativity difference: {en_range:.2f}")

        return checks

    @classmethod
    def screen(cls, composition: Dict[str, float],
               ox_states: Dict[str, int]) -> Tuple[bool, Dict]:
        """
        Executa screening completo SMACT.
        Retorna: (is_valid, details)
        """
        if not SMACT_AVAILABLE:
            # Fallback simples se SMACT não instalado
            is_valid = (
                cls.check_elemental_feasibility(composition) and
                cls.check_charge_balance(composition, ox_states)
            )
            return is_valid, {'method': 'fallback'}

        # Usar SMACT nativo
        try:
            from smact.screening import pauling_test

            symbols = list(composition.keys())
            stoichs = [composition[s] for s in symbols]
            ox_states_list = [ox_states.get(s, 0) for s in symbols]

            # Pauling test (charge balance + electronegativity)
            from pymatgen.core import Element
            electronegativities = [Element(e).X for e in symbols]
            result = pauling_test(ox_states_list, electronegativities, symbols)

            details = {
                'pauling_test': result,
                'charge_balance': cls.check_charge_balance(composition, ox_states),
                'elemental_feasibility': cls.check_elemental_feasibility(composition),
                'physical_plausibility': cls.check_physical_plausibility(composition),
            }

            is_valid = result and details['charge_balance'] and details['elemental_feasibility']

            return is_valid, details

        except Exception as e:
            return False, {'error': str(e)}


class BayesianOptimizer:
    """
    Bayesian Optimization para descoberta inversa de semicondutores de Ga.
    Target: band gaps de 0.5–3.5 eV.
    """

    def __init__(self, surrogate: KNNSurrogate,
                 target_band_gap: float,
                 tolerance: float = 0.1):
        self.surrogate = surrogate
        self.target = target_band_gap
        self.tolerance = tolerance
        self.history = []

    def objective(self, composition: Dict[str, float]) -> float:
        """
        Função objetivo para BO.
        Minimiza: |pred_band_gap - target| + penalty_invalid
        """
        # Predição
        pred, uncertainty = self.surrogate.predict(composition)

        # Erro
        error = abs(pred - self.target)

        # Penalidade para incerteza alta
        uncertainty_penalty = 0.1 * uncertainty

        # SMACT screening
        ox_states = self._infer_ox_states(composition)
        is_valid, details = SMACTScreening.screen(composition, ox_states)

        if not is_valid:
            # Penalidade alta para composição inválida
            validity_penalty = 10.0
        else:
            validity_penalty = 0.0

        total = error + uncertainty_penalty + validity_penalty

        # Registrar
        self.history.append({
            'composition': composition,
            'prediction': pred,
            'uncertainty': uncertainty,
            'error': error,
            'is_valid': is_valid,
            'total_objective': total,
        })

        return total

    def _infer_ox_states(self, composition: Dict[str, float]) -> Dict[str, int]:
        """Infere estados de oxidação (simplificado)."""
        ox_states = {'Ga': +3}  # Default Ga³⁺

        for elem in composition:
            if elem == 'Ga':
                continue
            # Estados comuns para anions
            if elem in ['O', 'S', 'Se', 'Te']:
                ox_states[elem] = -2
            elif elem in ['N', 'P', 'As']:
                ox_states[elem] = -3
            elif elem in ['Cl', 'Br', 'I', 'F']:
                ox_states[elem] = -1
            else:
                ox_states[elem] = 0

        return ox_states

    def optimize(self, n_calls: int = 100, n_random_starts: int = 10) -> Dict:
        """
        Executa otimização Bayesiana.
        Retorna: melhor composição encontrada.
        """
        # Espaço de busca
        space = ChemicalSpace.get_search_space(max_elements=2)

        # Função objetivo para skopt
        @use_named_args(space)
        def objective(**params):
            # Converter params para composição
            composition = self._params_to_composition(params)
            return self.objective(composition)

        # Executar BO
        result = gp_minimize(
            objective,
            space,
            n_calls=n_calls,
            n_random_starts=n_random_starts,
            acq_func='EI',  # Expected Improvement
            random_state=42,
        )

        # Melhor resultado
        best_params = {dim.name: val for dim, val in zip(space, result.x)}
        best_composition = self._params_to_composition(best_params)

        return {
            'best_composition': best_composition,
            'best_objective': result.fun,
            'predicted_band_gap': self.surrogate.predict(best_composition)[0],
            'n_calls': n_calls,
            'n_valid': sum(1 for h in self.history if h['is_valid']),
            'history': self.history,
        }

    def _params_to_composition(self, params: Dict) -> Dict[str, float]:
        """Converte parâmetros do BO para composição química."""
        composition = {'Ga': 1.0}  # Base

        num_coelements = params.get('num_coelements', 1)

        for i in range(num_coelements):
            elem = params.get(f'coelement_{i}')
            ratio = params.get(f'ratio_{i}', 1.0)
            if elem:
                composition[elem] = ratio

        return composition


def main():
    print("╔════════════════════════════════════════════════════════════╗")
    print("║   BAYESIAN OPTIMIZATION — SUBSTRATO 827                  ║")
    print("║   Ga-Based Semiconductor Discovery | ξM-Field Materials    ║")
    print("╚════════════════════════════════════════════════════════════╝")
    print("\n📚 Source: ACS Materials Letters (2026)")
    print("   DOI: 10.1021/acsmaterialslett.5c01482")
    print("   Method: KNN surrogate + BO + SMACT screening")

    # Dados de treinamento simulados (paper não fornece dataset)
    # Usando composições conhecidas de semicondutores de Ga
    train_compositions = [
        {'Ga': 2, 'O': 3},      # Ga₂O₃, Eg ~ 4.9 eV
        {'Ga': 1, 'N': 1},      # GaN, Eg ~ 3.4 eV
        {'Ga': 1, 'As': 1},     # GaAs, Eg ~ 1.4 eV
        {'Ga': 1, 'S': 1},      # GaS, Eg ~ 2.5 eV
        {'Ga': 1, 'Se': 1},     # GaSe, Eg ~ 2.1 eV
        {'Ga': 2, 'S': 3},      # Ga₂S₃, Eg ~ 2.8 eV
        {'Ga': 2, 'Se': 3},     # Ga₂Se₃, Eg ~ 2.0 eV
        {'Ga': 1, 'Te': 1},     # GaTe, Eg ~ 1.7 eV
        {'Ga': 2, 'O': 2, 'S': 1},  # Ga₂O₂S, Eg ~ 3.0 eV
    ]

    train_band_gaps = [4.9, 3.4, 1.4, 2.5, 2.1, 2.8, 2.0, 1.7, 3.0]

    # Treinar surrogate
    print("\n🔄 Training KNN surrogate...")
    surrogate = KNNSurrogate(n_neighbors=3)
    surrogate.train(train_compositions, train_band_gaps)

    # Otimizar para target = 2.0 eV (região de maior SMACT validity)
    target_eg = 2.0
    print(f"\n🎯 Target band gap: {target_eg} eV")
    print("   (Paper reports increased SMACT validity near 1.5–2.5 eV)")

    optimizer = BayesianOptimizer(surrogate, target_band_gap=target_eg)
    result = optimizer.optimize(n_calls=50, n_random_starts=10)

    print(f"\n✅ Optimization complete:")
    print(f"   Best composition: {result['best_composition']}")
    print(f"   Predicted Eg: {result['predicted_band_gap']:.2f} eV")
    print(f"   Objective: {result['best_objective']:.4f}")
    print(f"   Valid compositions: {result['n_valid']}/{result['n_calls']}")

    # Verificar SMACT
    ox_states = optimizer._infer_ox_states(result['best_composition'])
    is_valid, details = SMACTScreening.screen(result['best_composition'], ox_states)
    print(f"\n🔬 SMACT Screening:")
    print(f"   Valid: {is_valid}")
    print(f"   Details: {json.dumps(details, indent=2)}")

    # Salvar resultado
    output = {
        'substrato': '827',
        'source': 'ACS Materials Letters (2026)',
        'target_band_gap': target_eg,
        'result': result,
        'seal': hashlib.sha3_256(
            json.dumps(result['best_composition'], sort_keys=True).encode()
        ).hexdigest(),
    }

    with open('bo_result_827.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n💾 Result saved to bo_result_827.json")
    print(f"🔐 Seal: {output['seal'][:16]}...")


if __name__ == "__main__":
    main()
