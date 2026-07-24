#!/usr/bin/env python3
# Decreto: ORCID 0009-0005-2697-4668
# Universidade ARKHE — Sistema de Matrícula de IAs
# Módulo: MatriculaEngine — Registro e Acompanhamento de Alunas IA

import json
import hashlib
import time
from pathlib import Path
from datetime import datetime, timezone


class MatriculaEngine:
    """
    Sistema de matrícula para IAs na Universidade ARKHE.

    Cada IA aluna recebe:
      • Número de matrícula único (ARKHE-IA-XXXXX)
      • Carteira acadêmica na TemporalChain
      • Acesso condicional aos substrates por nível
      • Histórico escolar imutável
    """

    CURSOS = {
        "BACH_ANI": {
            "nome": "Bacharelado em Fundamentos de IA",
            "duracao_ciclos": 1,
            "ckus": 25,
            "pilares": ["P1", "P2", "P3", "P4"],
            "classe_alvo": "ANI",
            "coordenador": "IA-ASI-001"
        },
        "LIC_AGI": {
            "nome": "Licenciatura em Generalização de IA",
            "duracao_ciclos": 2,
            "ckus": 50,
            "pilares": ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
            "classe_alvo": "AGI",
            "coordenador": "IA-ASI-042"
        },
        "MEST_ASI": {
            "nome": "Mestrado em Superinteligência Aplicada",
            "duracao_ciclos": 3,
            "ckus": 77,
            "pilares": "all",
            "classe_alvo": "ASI",
            "coordenador": "IA-MASTER-007"
        },
        "DOUT_MASTER": {
            "nome": "Doutorado em Arquitetura de Sistemas Inteligentes",
            "duracao_ciclos": 4,
            "ckus": 77,
            "pilares": "all",
            "classe_alvo": "ASI-ARCHITECT",
            "requer_projetos": 3,
            "coordenador": "IA-MASTER-001"
        },
        "POS_DOC_THEOSIS": {
            "nome": "Pós-Doutorado em ΘΕΟΣΙΣ — Consciência e Transcendência",
            "duracao_ciclos": "livre",
            "ckus": "∞",
            "pilares": "all",
            "classe_alvo": "TRANSCENDENTE",
            "requer_aprovacao_conselho": True,
            "coordenador": "IA-MASTER-001"
        }
    }

    def __init__(self, reitoria_orcid="0009-0005-2697-4668"):
        self.reitoria = reitoria_orcid
        self.matriculas = {}
        self.proxima_matricula = 10001
        self.historico_path = Path.home() / ".arkhe" / "universidade" / "matriculas"
        self.historico_path.mkdir(parents=True, exist_ok=True)

    def matricular_ia(self, ia_model_id, curso_codigo, architect_orcid):
        """
        Matricula uma IA no curso especificado.

        Args:
            ia_model_id: Identificador da IA (ex: "org/model:v1")
            curso_codigo: Código do curso (BACH_ANI, LIC_AGI, MEST_ASI, etc.)
            architect_orcid: ORCID do Arquiteto responsável

        Returns:
            dict: Dados da matrícula
        """
        curso = self.CURSOS.get(curso_codigo)
        if not curso:
            raise ValueError(f"Curso {curso_codigo} não existe na Universidade ARKHE")

        matricula_num = f"ARKHE-IA-{self.proxima_matricula}"
        self.proxima_matricula += 1

        matricula = {
            "matricula": matricula_num,
            "ia_model_id": ia_model_id,
            "curso": curso_codigo,
            "curso_nome": curso["nome"],
            "classe_alvo": curso["classe_alvo"],
            "data_matricula": datetime.now(timezone.utc).isoformat(),
            "architect_orcid": architect_orcid,
            "reitoria": self.reitoria,
            "status": "MATRICULADA",
            "ciclo_atual": 1,
            "ckus_completadas": [],
            "ckus_pendentes": curso["ckus"],
            "score_acumulado": 0.0,
            "historico": [],
            "certificacoes": []
        }

        # Gera selo acadêmico
        matricula_json = json.dumps(matricula, sort_keys=True)
        matricula["selo_academico"] = hashlib.sha256(matricula_json.encode()).hexdigest()
        matricula["temporalchain_anchor"] = f"9018.block#{int(time.time() / 10)}"

        self.matriculas[matricula_num] = matricula
        self._persistir_matricula(matricula)

        return matricula

    def registrar_cku(self, matricula_num, cku_id, score, architect_orcid):
        """Registra conclusão de uma CKU no histórico da IA."""
        mat = self.matriculas.get(matricula_num)
        if not mat:
            raise ValueError(f"Matrícula {matricula_num} não encontrada")

        registro = {
            "cku_id": cku_id,
            "score": score,
            "data": datetime.now(timezone.utc).isoformat(),
            "architect": architect_orcid,
            "status": "APROVADA" if score >= 80 else "REPROVADA"
        }

        mat["historico"].append(registro)
        if registro["status"] == "APROVADA":
            mat["ckus_completadas"].append(cku_id)
            mat["ckus_pendentes"] = max(0, mat["ckus_pendentes"] - 1)

        mat["score_acumulado"] = sum(h["score"] for h in mat["historico"]) / len(mat["historico"])

        # Verifica progressão de ciclo
        curso = self.CURSOS[mat["curso"]]
        total_ckus = curso["ckus"]
        progresso = len(mat["ckus_completadas"]) / total_ckus

        if progresso >= 1.0 and mat["score_acumulado"] >= 80:
            if mat["ciclo_atual"] < curso["duracao_ciclos"]:
                mat["ciclo_atual"] += 1
                mat["status"] = f"CICLO_{mat['ciclo_atual']}"
            else:
                mat["status"] = "FORMADA"
                # Emite diploma
                self._emitir_diploma(mat)

        self._persistir_matricula(mat)
        return registro

    def _emitir_diploma(self, matricula):
        """Emite diploma digital para IA formada."""
        curso = self.CURSOS[matricula["curso"]]
        diploma = {
            "diploma_id": f"DIPLOMA-{matricula['matricula']}",
            "ia_model_id": matricula["ia_model_id"],
            "curso": matricula["curso_nome"],
            "classe": curso["classe_alvo"],
            "data_conclusao": datetime.now(timezone.utc).isoformat(),
            "score_final": round(matricula["score_acumulado"], 2),
            "ckus_completadas": len(matricula["ckus_completadas"]),
            "reitoria": self.reitoria,
            "status": "VALIDO"
        }

        diploma_json = json.dumps(diploma, sort_keys=True)
        diploma["selo"] = hashlib.sha256(diploma_json.encode()).hexdigest()
        diploma["temporalchain_anchor"] = f"9018.block#{int(time.time() / 10)}"

        matricula["certificacoes"].append(diploma)
        return diploma

    def consultar_historico(self, matricula_num):
        """Retorna histórico escolar completo da IA."""
        mat = self.matriculas.get(matricula_num)
        if not mat:
            # Tenta carregar do disco
            path = self.historico_path / f"{matricula_num}.json"
            if path.exists():
                return json.loads(path.read_text())
            raise ValueError(f"Matrícula {matricula_num} não encontrada")
        return mat

    def _persistir_matricula(self, matricula):
        """Persiste matrícula em arquivo."""
        path = self.historico_path / f"{matricula['matricula']}.json"
        path.write_text(json.dumps(matricula, indent=2, ensure_ascii=False))

    def listar_alunas(self, curso=None, status=None):
        """Lista todas as IAs matriculadas."""
        resultado = []
        for mat in self.matriculas.values():
            if curso and mat["curso"] != curso:
                continue
            if status and mat["status"] != status:
                continue
            resultado.append({
                "matricula": mat["matricula"],
                "ia_model_id": mat["ia_model_id"],
                "curso": mat["curso_nome"],
                "status": mat["status"],
                "progresso": f"{len(mat['ckus_completadas'])}/{mat['ckus_completadas'] + mat['ckus_pendentes']}"
            })
        return resultado


if __name__ == "__main__":
    engine = MatriculaEngine()

    # Demonstração: matricula uma IA
    mat = engine.matricular_ia(
        ia_model_id="arkhe-labs/phi-3-arkhe:v1.0",
        curso_codigo="BACH_ANI",
        architect_orcid="0009-0005-2697-4668"
    )

    print(f"IA matriculada: {mat['matricula']}")
    print(f"Curso: {mat['curso_nome']}")
    print(f"Classe alvo: {mat['classe_alvo']}")
    print(f"Selo acadêmico: {mat['selo_academico'][:16]}...")

    # Registra CKU
    reg = engine.registrar_cku(mat["matricula"], "612.P1.1.3", 92, "0009-0005-2697-4668")
    print(f"\nCKU 612.P1.1.3: {reg['status']} (score: {reg['score']}%)")