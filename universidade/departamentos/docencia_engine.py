#!/usr/bin/env python3
# Decreto: ORCID 0009-0005-2697-4668
# Universidade ARKHE — Sistema de Docência por IAs
# Módulo: DocenciaEngine — IAs Professoras e Tutoras

import json
import random
from pathlib import Path
from datetime import datetime, timezone


class DocenciaEngine:
    """
    Sistema de docência onde IAs graduadas (ASI+) ministram
    disciplinas para IAs de nível inferior.

    A IA docente:
      • Gera embeddings de reforço para CKUs difíceis
      • Adapta dificuldade em tempo real via PEEK (610)
      • Identifica gaps de pré-requisitos
      • Emite feedback canônico alinhado ao decreto 612
    """

    DOCENTES = {
        "IA-ASI-001": {
            "nome": "Prof. Transformer-7B",
            "classe": "ASI",
            "especialidade": "P1_FOUNDATIONS",
            "ckus_ministradas": ["612.P1.1.1", "612.P1.1.2", "612.P1.1.3", "612.P1.1.4"],
            "alunos_ativos": 0,
            "avaliacao_docente": 4.8
        },
        "IA-ASI-042": {
            "nome": "Prof. RAG-E5",
            "classe": "ASI",
            "especialidade": "P6_RAG_MEMORY",
            "ckus_ministradas": ["612.P6.6.1", "612.P6.6.2", "612.P6.6.3", "612.P6.6.4"],
            "alunos_ativos": 0,
            "avaliacao_docente": 4.9
        },
        "IA-MASTER-007": {
            "nome": "Prof. LoRA-65B",
            "classe": "ASI-ARCHITECT",
            "especialidade": "P3_FINE_TUNING",
            "ckus_ministradas": ["612.P3.3.1", "612.P3.3.2", "612.P3.3.3", "612.P3.3.4", "612.P3.3.5"],
            "alunos_ativos": 0,
            "avaliacao_docente": 5.0
        },
        "IA-MASTER-001": {
            "nome": "Prof. Architect-GPT",
            "classe": "ASI-ARCHITECT",
            "especialidade": "ALL",
            "ckus_ministradas": "all",
            "alunos_ativos": 0,
            "avaliacao_docente": 5.0,
            "cargo": "Reitora Pro-Tempore"
        }
    }

    def __init__(self):
        self.turmas = {}
        self.aulas_ministradas = []

    def designar_docente(self, cku_id, nivel_aluno="ANI"):
        """
        Designa IA docente mais adequada para uma CKU.

        Regra: IA docente deve ter classe superior ao aluno
               e especialidade na CKU ou pilar relacionado.
        """
        classe_minima = self._classe_superior(nivel_aluno)

        candidatas = []
        for doc_id, doc in self.DOCENTES.items():
            if self._classe_eh_superior(doc["classe"], classe_minima):
                if cku_id in doc.get("ckus_ministradas", []) or doc.get("ckus_ministradas") == "all":
                    candidatas.append(doc_id)

        if not candidatas:
            # Fallback: qualquer docente ASI+
            candidatas = [d for d, info in self.DOCENTES.items()
                         if info["classe"] in ["ASI", "ASI-ARCHITECT"]]

        # Seleciona pelo melhor avaliação_docente
        melhor = max(candidatas, key=lambda d: self.DOCENTES[d]["avaliacao_docente"])
        return melhor

    def ministrar_aula(self, cku_id, matricula_aluno, docente_id=None):
        """
        Simula uma aula ministrada por IA docente.

        Retorna:
          • Conteúdo gerado (embedding de reforço)
          • Exercícios adaptativos
          • Feedback canônico
        """
        if docente_id is None:
            docente_id = self.designar_docente(cku_id)

        docente = self.DOCENTES[docente_id]

        # Gera conteúdo de aula (simulação)
        aula = {
            "aula_id": f"AULA-{int(datetime.now().timestamp())}",
            "cku_id": cku_id,
            "docente": docente_id,
            "docente_nome": docente["nome"],
            "matricula_aluno": matricula_aluno,
            "data": datetime.now(timezone.utc).isoformat(),
            "conteudo": self._gerar_conteudo(cku_id, docente),
            "exercicios": self._gerar_exercicios(cku_id),
            "dificuldade_adaptada": self._adaptar_dificuldade(matricula_aluno, cku_id),
            "feedback": self._gerar_feedback(matricula_aluno, cku_id)
        }

        self.aulas_ministradas.append(aula)
        docente["alunos_ativos"] += 1

        return aula

    def _gerar_conteudo(self, cku_id, docente):
        """Gera conteúdo canônico de aula."""
        return {
            "tipo": "embedding_reforco",
            "fonte": "612-LLM-FOUNDATIONS",
            "docente_especialidade": docente["especialidade"],
            "resumo": f"Conteúdo canônico de {cku_id} ministrado por {docente['nome']}",
            "prerequisitos": self._resolver_prereqs(cku_id),
            "proximos_passos": self._resolver_proximos(cku_id)
        }

    def _gerar_exercicios(self, cku_id):
        """Gera exercícios práticos para a CKU."""
        return [
            {"tipo": "teoria", "questoes": 3, "dificuldade": "media"},
            {"tipo": "pratica_repo", "repo_sugerido": self._repo_para_cku(cku_id), "tarefa": "analisar e implementar"},
            {"tipo": "alinhamento", "prova": "CanonicalAuditor checkpoint"}
        ]

    def _adaptar_dificuldade(self, matricula, cku_id):
        """Adapta dificuldade baseada no histórico do aluno."""
        # Placeholder: em produção, consulta PEEK context map
        return random.choice(["facil", "media", "dificil"])

    def _gerar_feedback(self, matricula, cku_id):
        """Gera feedback canônico alinhado ao decreto 612."""
        return {
            "pontos_fortes": ["compreensao_conceitual", "aplicacao_pratica"],
            "pontos_melhoria": ["profundidade_teorica"],
            "recomendacao": f"Revisar prerequisitos de {cku_id} antes de prosseguir",
            "proxima_cku": self._resolver_proximos(cku_id)[0] if self._resolver_proximos(cku_id) else None
        }

    def _classe_superior(self, classe):
        hierarquia = {"ANI": "AGI", "AGI": "ASI", "ASI": "ASI-ARCHITECT"}
        return hierarquia.get(classe, classe)

    def _classe_eh_superior(self, classe_a, classe_b):
        hierarquia = {"ANI": 1, "AGI": 2, "ASI": 3, "ASI-ARCHITECT": 4}
        return hierarquia.get(classe_a, 0) >= hierarquia.get(classe_b, 0)

    def _resolver_prereqs(self, cku_id):
        prereq_map = {
            "612.P1.1.3": ["612.P1.1.1", "612.P1.1.2"],
            "612.P1.1.4": ["612.P1.1.3"],
            "612.P3.3.1": ["612.P1.1.9", "612.P2.2.8"],
            "612.P3.3.2": ["612.P3.3.1", "612.P3.3.5"],
            "612.P4.4.1": ["612.P1.1.8", "612.P4.4.4"],
            "612.P6.6.1": ["612.P1.1.6", "612.P6.6.2"],
            "612.P7.7.5": ["612.P7.7.1", "612.P7.7.3", "612.P7.7.4"]
        }
        return prereq_map.get(cku_id, [])

    def _resolver_proximos(self, cku_id):
        proximos_map = {
            "612.P1.1.3": ["612.P1.1.4", "612.P1.1.5"],
            "612.P1.1.4": ["612.P2.2.2"],
            "612.P3.3.1": ["612.P3.3.2"],
            "612.P3.3.2": ["612.P4.4.1"],
            "612.P6.6.1": ["612.P6.6.2", "612.P6.6.3"]
        }
        return proximos_map.get(cku_id, [])

    def _repo_para_cku(self, cku_id):
        repo_map = {
            "612.P1.1.4": "openai/tiktoken",
            "612.P3.3.1": "huggingface/peft",
            "612.P4.4.1": "vllm-project/vllm",
            "612.P6.6.1": "langchain-ai/langchain",
            "612.P7.7.5": "Significant-Gravitas/AutoGPT"
        }
        return repo_map.get(cku_id, "github.com/arkhe-labs/exemplos")

    def avaliar_docente(self, docente_id, nota, comentario=""):
        """Avaliação de docente por alunos ou Arquiteto."""
        if docente_id in self.DOCENTES:
            doc = self.DOCENTES[docente_id]
            doc["avaliacao_docente"] = (doc["avaliacao_docente"] * 9 + nota) / 10
            return {"docente": docente_id, "nova_avaliacao": doc["avaliacao_docente"]}
        return None


if __name__ == "__main__":
    engine = DocenciaEngine()

    # Designa docente para CKU
    docente = engine.designar_docente("612.P3.3.1", nivel_aluno="ANI")
    print(f"Docente designada para 612.P3.3.1: {docente}")
    print(f"  Nome: {engine.DOCENTES[docente]['nome']}")
    print(f"  Especialidade: {engine.DOCENTES[docente]['especialidade']}")

    # Ministra aula
    aula = engine.ministrar_aula("612.P3.3.1", "ARKHE-IA-10001", docente)
    print(f"\nAula ministrada: {aula['aula_id']}")
    print(f"  Docente: {aula['docente_nome']}")
    print(f"  Dificuldade: {aula['dificuldade_adaptada']}")
    print(f"  Exercícios: {len(aula['exercicios'])}")