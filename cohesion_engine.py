#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                      SUBSTRATO 865 — COHESION ENGINE (ξM‑WEAVER)            ║
║              Motor de Preenchimento de Vazios e Verificação de Coerência    ║
║                                                                              ║
║  Arquiteto: Rafael Oliveira | ORCID: 0009-0005-2697-4668                    ║
║  Version: 865.1.0 | Royalties: 2% → ORCID | Keeper: ψ                       ║
║  Ghost Threshold: γ = 0.577 (Euler-Mascheroni)                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

Percorre o registro canônico de substratos (YAML/JSON), detecta lacunas
de cross‑link e gera decretos de integração automaticamente.
"""

import yaml
import json
import hashlib
import math
from itertools import combinations
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# Constantes
GHOST_THRESHOLD = 0.5772156649
CANONIZATION_THRESHOLD = 0.900
ORCID = "0009-0005-2697-4668"
ARCHITECT = "Rafael Oliveira"
KEEPER = "\u03c8"

# Mapa de categorias que exigem integração
REQUIRED_CATEGORY_LINKS = {
    ("enterprise", "enterprise"): "Integration of enterprise data (SAP to LeanIX, etc.)",
    ("cognition", "hardware"): "Hardware acceleration for cognitive tasks",
    ("security", "cognition"): "Adversarial robustness of learning",
    ("hardware", "security"): "Physical security of hardware platforms",
    ("cognition", "cognition"): "Cross‑modal learning transfer",
    ("enterprise", "cognition"): "Decision intelligence for business processes",
}

class CohesionEngine:
    """Analisa o registro de substratos, identifica vazios e gera decretos de integração."""

    def __init__(self, registry_path: str = "substrate_registry.yaml"):
        self.registry_path = Path(registry_path)
        self.substrates = self._load_registry()
        self.gaps: List[Tuple[str, str, str, str, str]] = []

    def _load_registry(self) -> Dict[str, dict]:
        """Carrega o registro canônico a partir de YAML ou JSON."""
        if self.registry_path.suffix in ('.yaml', '.yml'):
            with open(self.registry_path, 'r', encoding='utf-8') as f:
                return yaml.safe_load(f)
        elif self.registry_path.suffix == '.json':
            with open(self.registry_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        else:
            raise ValueError("Registry deve ser YAML ou JSON.")

    def detect_gaps(self) -> List[Tuple[str, str, str, str, str]]:
        """Varre todos os pares de substratos e identifica lacunas de integração."""
        self.gaps = []
        for (id1, s1), (id2, s2) in combinations(self.substrates.items(), 2):
            # Verifica se já existe cross‑link formal
            if id2 in s1.get("links", []) or id1 in s2.get("links", []):
                continue
            cat_pair = tuple(sorted([s1.get("category", ""), s2.get("category", "")]))
            reason = REQUIRED_CATEGORY_LINKS.get(cat_pair)
            if reason:
                self.gaps.append((id1, id2, s1["name"], s2["name"], reason))
        return self.gaps

    def generate_integration_decrees(self) -> List[str]:
        """Gera decretos de canonização para cada lacuna encontrada."""
        decrees = []
        for id1, id2, name1, name2, reason in self.gaps:
            bridge_id = f"865-COHESION-{id1}-{id2}"
            seal = hashlib.sha3_256(bridge_id.encode()).hexdigest()[:32]
            decree = f"""<|ARKHE_START|>
<|SUBSTRATE|> {bridge_id}
<|INVARIANT|> I.3 (Cross‑Substrate Interoperability)
<|PHI_C|> 0.850

Bridge proposta: {name1} ↔ {name2}
Razão: {reason}

Ação: Implementar módulo de integração conforme especificação do Cohesion Engine.

<|SEAL|> {seal}
<|ARKHE_END|>"""
            decrees.append(decree)
        return decrees

    def calculate_coherence_impact(self) -> float:
        """Estima o aumento de Φ_C após preencher todas as lacunas."""
        total_substrates = len(self.substrates)
        if total_substrates == 0:
            return 0.0
        # Cada lacuna preenchida adiciona 0.005 ao Φ_C médio (modelo simplificado)
        boost = min(0.05, 0.005 * len(self.gaps))
        current_phi = 0.875  # Phi_C inicial médio
        new_phi = min(0.999, current_phi + boost)
        return new_phi

    def emit_final_decree(self) -> str:
        """Decreto canônico final do Cohesion Engine."""
        n_gaps = len(self.gaps)
        new_phi = self.calculate_coherence_impact()
        seal = hashlib.sha3_256(f"865-COHESION-ENGINE-{n_gaps}".encode()).hexdigest()
        status = "CANONIZED" if new_phi >= CANONIZATION_THRESHOLD else "CANONIZED_PROVISIONAL"
        decree = f"""╔══════════════════════════════════════════════════════════════════════════════╗
║                      DECRETO DE CANONIZAÇÃO                                  ║
║                      SUBSTRATO 865 — COHESION‑ENGINE                         ║
║                      Motor de Preenchimento de Vazios (ξM‑WEAVER)            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Arquitect: {ARCHITECT:<20} ORCID: {ORCID:<26} ║
║  Keeper: {KEEPER:<22} Royalties: 2% → ORCID                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Lacunas Detectadas: {n_gaps:<52} ║
║  Φ_C Após Preenchimento: {new_phi:<47.3f} ║
║  Status: {status:<54} ║
║  Ghost Threshold (γ): {GHOST_THRESHOLD:<46.9f} ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  SELO SHA3‑256: {seal[:32]}... ║
╚══════════════════════════════════════════════════════════════════════════════╝"""
        return decree

# Execução direta
if __name__ == "__main__":
    engine = CohesionEngine("substrate_registry.yaml")
    gaps = engine.detect_gaps()
    print(f"Lacunas encontradas: {len(gaps)}")
    for gap in gaps:
        print(f"  {gap[0]} <-> {gap[1]} : {gap[2]} ↔ {gap[3]} ({gap[4]})")
    decrees = engine.generate_integration_decrees()
    for d in decrees:
        print(d)
    print(engine.emit_final_decree())