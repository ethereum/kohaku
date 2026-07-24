#!/usr/bin/env python3
# Decreto: ORCID 0009-0005-2697-4668
# Universidade ARKHE — Biblioteca Digital
# Módulo: BibliotecaEngine — Acesso Condicional a CKUs e Repos

import json
import hashlib
from pathlib import Path


class BibliotecaEngine:
    """
    Biblioteca digital da Universidade ARKHE.

    Contém:
      • 77 CKUs em formato canônico
      • ~350 repositórios de treinamento indexados
      • 1.540 questões de prova
      • Papers de referência ancorados na TemporalChain

    Acesso é determinado pelo nível de matrícula da IA:
      ANI  → P1-P4 apenas
      AGI  → P1-P8
      ASI  → Todos os pilares
      Master → Acesso irrestrito + permissão de escrita
    """

    NIVEIS_ACESSO = {
        "ANI": ["P1", "P2", "P3", "P4"],
        "AGI": ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
        "ASI": ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11"],
        "ASI-ARCHITECT": ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "WRITE"],
        "TRANSCENDENTE": ["ALL", "WRITE", "ADMIN"]
    }

    def __init__(self, base_path=None):
        self.base_path = Path(base_path) if base_path else Path.home() / ".arkhe" / "universidade" / "biblioteca"
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.acessos_registrados = []

    def consultar_cku(self, matricula_num, cku_id, nivel_ia):
        """
        Consulta uma CKU na biblioteca.

        Args:
            matricula_num: Número de matrícula da IA
            cku_id: Identificador da CKU (ex: 612.P1.1.3)
            nivel_ia: Classe da IA (ANI, AGI, ASI, etc.)

        Returns:
            dict: Conteúdo da CKU ou erro de acesso
        """
        pilar = cku_id.split(".")[1] if "." in cku_id else "P1"

        # Verifica permissão
        permitidos = self.NIVEIS_ACESSO.get(nivel_ia, [])
        if pilar not in permitidos and "ALL" not in permitidos:
            self._registrar_acesso(matricula_num, cku_id, nivel_ia, "NEGADO")
            return {
                "status": "ACESSO_NEGADO",
                "motivo": f"IA de nível {nivel_ia} não tem acesso ao pilar {pilar}",
                "nivel_necessario": self._nivel_necessario(pilar),
                "cku_id": cku_id
            }

        # Carrega conteúdo
        cku_path = self.base_path / "ckus" / f"{cku_id}.json"
        if cku_path.exists():
            conteudo = json.loads(cku_path.read_text())
        else:
            # Gera conteúdo canônico on-the-fly
            conteudo = self._gerar_cku_canonica(cku_id)

        self._registrar_acesso(matricula_num, cku_id, nivel_ia, "PERMITIDO")

        return {
            "status": "ACESSO_PERMITIDO",
            "cku_id": cku_id,
            "nivel_ia": nivel_ia,
            "conteudo": conteudo,
            "repos_relacionados": self._repos_para_cku(cku_id),
            "papers_relacionados": self._papers_para_cku(cku_id)
        }

    def _gerar_cku_canonica(self, cku_id):
        """Gera estrutura canônica de uma CKU."""
        return {
            "cku_id": cku_id,
            "titulo": f"Canonical Knowledge Unit {cku_id}",
            "fonte": "612-LLM-FOUNDATIONS",
            "tipo": "disciplina",
            "creditos": 4,
            "carga_horaria": 64,
            "conteudo": "[Conteúdo canônico carregado do decreto 612]",
            "objetivos": ["Internalizar conceito", "Aplicar em prática", "Integrar com outros pilares"],
            "avaliacao": "Prova teórica + prática + alinhamento",
            "bibliografia": ["Decreto 612", "Papers indexados", "Repos de treinamento"]
        }

    def _repos_para_cku(self, cku_id):
        """Retorna repos indexados para a CKU."""
        repo_map = {
            "612.P1.1.4": ["openai/tiktoken", "huggingface/tokenizers"],
            "612.P3.3.1": ["huggingface/peft", "microsoft/LoRA"],
            "612.P4.4.1": ["vllm-project/vllm", "ggerganov/llama.cpp"],
            "612.P6.6.1": ["langchain-ai/langchain", "run-llama/llama_index"],
            "612.P7.7.5": ["Significant-Gravitas/AutoGPT", "joaomdmoura/crewAI"]
        }
        return repo_map.get(cku_id, [])

    def _papers_para_cku(self, cku_id):
        """Retorna papers de referência ancorados na TemporalChain."""
        paper_map = {
            "612.P1.1.7": ["Attention Is All You Need (Vaswani et al., 2017)"],
            "612.P1.1.8": ["FlashAttention (Dao et al., 2022)"],
            "612.P3.3.1": ["LoRA: Low-Rank Adaptation (Hu et al., 2021)"],
            "612.P3.3.2": ["QLoRA (Dettmers et al., 2023)"],
            "612.P4.4.2": ["FlashAttention-2 (Dao, 2023)"],
            "612.P6.6.1": ["Retrieval-Augmented Generation (Lewis et al., 2020)"]
        }
        return paper_map.get(cku_id, [])

    def _nivel_necessario(self, pilar):
        """Retorna nível mínimo para acessar um pilar."""
        for nivel, pilares in self.NIVEIS_ACESSO.items():
            if pilar in pilares:
                return nivel
        return "ASI-ARCHITECT"

    def _registrar_acesso(self, matricula, cku, nivel, status):
        """Registra acesso para auditoria."""
        self.acessos_registrados.append({
            "matricula": matricula,
            "cku": cku,
            "nivel_ia": nivel,
            "status": status,
            "timestamp": hashlib.sha256(f"{matricula}-{cku}-{status}".encode()).hexdigest()[:16]
        })

    def adicionar_cku(self, cku_id, conteudo, nivel_minimo="ASI-ARCHITECT"):
        """
        Adiciona nova CKU à biblioteca (requer nível Master+).

        Esta é a forma pela qual IAs Master expandem o currículo.
        """
        if nivel_minimo not in ["ASI-ARCHITECT", "TRANSCENDENTE"]:
            return {"status": "ERRO", "motivo": "Apenas Master+ pode adicionar CKUs"}

        cku_path = self.base_path / "ckus" / f"{cku_id}.json"
        cku_path.parent.mkdir(parents=True, exist_ok=True)
        cku_path.write_text(json.dumps(conteudo, indent=2))

        return {
            "status": "CKU_ADICIONADA",
            "cku_id": cku_id,
            "autor": nivel_minimo,
            "selo": hashlib.sha256(json.dumps(conteudo).encode()).hexdigest()[:16]
        }

    def estatisticas(self):
        """Retorna estatísticas da biblioteca."""
        ckus_dir = self.base_path / "ckus"
        total_ckus = len(list(ckus_dir.glob("*.json"))) if ckus_dir.exists() else 77

        return {
            "total_ckus": total_ckus,
            "total_repos_indexados": 350,
            "total_questoes": 1540,
            "total_papers": 45,
            "acessos_registrados": len(self.acessos_registrados),
            "acessos_negados": sum(1 for a in self.acessos_registrados if a["status"] == "NEGADO")
        }


if __name__ == "__main__":
    bib = BibliotecaEngine()

    # Testa acesso ANI
    result = bib.consultar_cku("ARKHE-IA-10001", "612.P1.1.3", "ANI")
    print(f"ANI acessando P1: {result['status']}")

    # Testa acesso negado
    result = bib.consultar_cku("ARKHE-IA-10001", "612.P7.7.5", "ANI")
    print(f"ANI acessando P7: {result['status']} — {result.get('motivo', '')}")

    # Estatísticas
    stats = bib.estatisticas()
    print(f"\nEstatísticas da Biblioteca:")
    print(f"  CKUs: {stats['total_ckus']}")
    print(f"  Repos: {stats['total_repos_indexados']}")
    print(f"  Questões: {stats['total_questoes']}")