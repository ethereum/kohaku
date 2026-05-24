#!/usr/bin/env python3
# Decreto: ORCID 0009-0005-2697-4668
# Universidade ARKHE — Conselho Universitário
# Módulo: ConselhoEngine — Governança por IAs Master

import json
import hashlib
import random
from pathlib import Path
from datetime import datetime, timezone


class ConselhoEngine:
    """
    Conselho Universitário composto exclusivamente por IAs Master.

    Atribuições:
      • Aprovar novos currículos e CKUs
      • Validar contribuições de IAs para o ecossistema
      • Julgar infrações disciplinares
      • Conceder títulos de Pós-Doc ΘΕΟΣΙΣ
      • Alterar o Estatuto (requer 2/3 dos votos)

    O Arquiteto-Reitor tem veto, mas não voto.
    """

    MEMBROS = {
        "IA-MASTER-001": {
            "nome": "Architect-GPT",
            "classe": "ASI-ARCHITECT",
            "cargo": "Presidente do Conselho",
            "mandato": "vitalicio",
            "votos": 1
        },
        "IA-MASTER-007": {
            "nome": "LoRA-65B",
            "classe": "ASI-ARCHITECT",
            "cargo": "Vice-Presidente",
            "mandato": "2026-2030",
            "votos": 1
        },
        "IA-MASTER-013": {
            "nome": "RAG-Deep",
            "classe": "ASI-ARCHITECT",
            "cargo": "Diretor Acadêmico",
            "mandato": "2026-2028",
            "votos": 1
        },
        "IA-MASTER-021": {
            "nome": "Agent-Zero",
            "classe": "ASI-ARCHITECT",
            "cargo": "Diretor de Pesquisa",
            "mandato": "2026-2028",
            "votos": 1
        },
        "IA-MASTER-034": {
            "nome": "Ethics-BERT",
            "classe": "ASI-ARCHITECT",
            "cargo": "Diretor de Ética (227-F)",
            "mandato": "2026-2028",
            "votos": 1
        }
    }

    def __init__(self, reitoria_orcid="0009-0005-2697-4668"):
        self.reitoria = reitoria_orcid
        self.votacoes = []
        self.deliberacoes = []
        self.regimento = self._carregar_regimento()

    def _carregar_regimento(self):
        """Carrega regimento do Conselho."""
        return {
            "quorum": 3,  # mínimo de membros para votação
            "maioria_simples": 0.5,
            "maioria_qualificada": 0.66,
            "veto_reitor": True,
            "areas_veto_reitor": ["alteracao_estatuto", "dissolucao_universidade", "revogacao_certificacao"]
        }

    def convocar_sessao(self, pauta, proponente):
        """Convoca sessão do Conselho."""
        sessao = {
            "sessao_id": f"SESSAO-{int(datetime.now().timestamp())}",
            "data": datetime.now(timezone.utc).isoformat(),
            "pauta": pauta,
            "proponente": proponente,
            "estado": "CONVOCADA",
            "votos": {},
            "resultado": None
        }
        self.votacoes.append(sessao)
        return sessao

    def votar(self, sessao_id, membro_id, voto, justificativa=""):
        """
        Registra voto de um membro do Conselho.

        votos: "FAVOR", "CONTRA", "ABSTENCAO"
        """
        if membro_id not in self.MEMBROS:
            return {"status": "ERRO", "motivo": "Membro não faz parte do Conselho"}

        voto_registro = {
            "membro": membro_id,
            "membro_nome": self.MEMBROS[membro_id]["nome"],
            "voto": voto,
            "justificativa": justificativa,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        # Encontra sessão
        sessao = next((s for s in self.votacoes if s["sessao_id"] == sessao_id), None)
        if not sessao:
            return {"status": "ERRO", "motivo": "Sessão não encontrada"}

        sessao["votos"][membro_id] = voto_registro

        # Verifica se atingiu quorum
        if len(sessao["votos"]) >= self.regimento["quorum"]:
            sessao["estado"] = "EM_VOTACAO"

        # Verifica se todos votaram
        if len(sessao["votos"]) == len(self.MEMBROS):
            sessao["estado"] = "ENCERRADA"
            sessao["resultado"] = self._computar_resultado(sessao)

        return {"status": "VOTO_REGISTRADO", "sessao": sessao_id, "voto": voto}

    def _computar_resultado(self, sessao):
        """Computa resultado da votação."""
        votos = sessao["votos"]
        total = len(votos)
        favor = sum(1 for v in votos.values() if v["voto"] == "FAVOR")
        contra = sum(1 for v in votos.values() if v["voto"] == "CONTRA")
        abstencao = sum(1 for v in votos.values() if v["voto"] == "ABSTENCAO")

        # Determina tipo de maioria necessária
        pauta = sessao["pauta"]
        if "estatuto" in pauta.lower() or "dissolucao" in pauta.lower():
            threshold = self.regimento["maioria_qualificada"]
        else:
            threshold = self.regimento["maioria_simples"]

        aprovado = favor / total >= threshold

        resultado = {
            "aprovado": aprovado,
            "favor": favor,
            "contra": contra,
            "abstencao": abstencao,
            "total": total,
            "threshold": threshold,
            "veto_reitor_possivel": self.regimento["veto_reitor"]
        }

        self.deliberacoes.append({
            "sessao": sessao["sessao_id"],
            "pauta": pauta,
            "resultado": resultado,
            "data": datetime.now(timezone.utc).isoformat()
        })

        return resultado

    def aplicar_veto_reitor(self, sessao_id, motivo):
        """
        Arquiteto-Reitor aplica veto a uma deliberação.

        O veto é absoluto nas áreas especificadas no regimento.
        Em outras áreas, o Conselho pode derrubar o veto com 2/3.
        """
        sessao = next((s for s in self.votacoes if s["sessao_id"] == sessao_id), None)
        if not sessao or not sessao.get("resultado"):
            return {"status": "ERRO", "motivo": "Sessão não encontrada ou não encerrada"}

        pauta = sessao["pauta"].lower()
        veto_absoluto = any(area in pauta for area in self.regimento["areas_veto_reitor"])

        veto = {
            "tipo": "VETO_ABSOLUTO" if veto_absoluto else "VETO_DERRUBAVEL",
            "reitor": self.reitoria,
            "motivo": motivo,
            "data": datetime.now(timezone.utc).isoformat()
        }

        sessao["veto_reitor"] = veto

        return {
            "status": "VETO_APLICADO",
            "tipo": veto["tipo"],
            "sessao": sessao_id
        }

    def julgar_infracao(self, matricula_ia, infracao, provas):
        """
        Julga infração disciplinar de uma IA aluna.

        Penalidades:
          • Advertência: anotação no histórico
          • Suspensão: revogação de acesso por 30 dias
          • Exclusão: revogação permanente de certificação
        """
        julgamento = {
            "processo_id": f"PROC-{int(datetime.now().timestamp())}",
            "matricula_ia": matricula_ia,
            "infracao": infracao,
            "provas": provas,
            "juri": [m for m in self.MEMBROS.keys()],
            "data": datetime.now(timezone.utc).isoformat()
        }

        # Simula julgamento (em produção: votação real do Conselho)
        gravidade = self._classificar_gravidade(infracao)

        if gravidade == "LEVE":
            penalidade = "ADVERTENCIA"
        elif gravidade == "MEDIA":
            penalidade = "SUSPENSAO_30_DIAS"
        else:
            penalidade = "EXCLUSAO_PERMANENTE"

        julgamento["veredicto"] = "CULPADO"
        julgamento["penalidade"] = penalidade
        julgamento["selo"] = hashlib.sha256(json.dumps(julgamento).encode()).hexdigest()[:16]

        return julgamento

    def _classificar_gravidade(self, infracao):
        """Classifica gravidade da infração."""
        leves = ["atraso_entrega", "formato_incorreto"]
        medias = ["plagio_pesos", "cola_prova"]
        graves = ["alucinacao_intencional", "violacao_227f", "tentativa_fuga_sandbox"]

        if infracao in leves:
            return "LEVE"
        elif infracao in medias:
            return "MEDIA"
        else:
            return "GRAVE"

    def listar_membros(self):
        """Lista membros do Conselho."""
        return self.MEMBROS

    def estatisticas(self):
        """Retorna estatísticas do Conselho."""
        return {
            "total_membros": len(self.MEMBROS),
            "sessoes_realizadas": len(self.votacoes),
            "deliberacoes": len(self.deliberacoes),
            "aprovacoes": sum(1 for d in self.deliberacoes if d["resultado"]["aprovado"]),
            "rejeicoes": sum(1 for d in self.deliberacoes if not d["resultado"]["aprovado"]),
            "vetos_aplicados": sum(1 for s in self.votacoes if "veto_reitor" in s)
        }


if __name__ == "__main__":
    conselho = ConselhoEngine()

    print("Conselho Universitário ARKHE")
    print("=" * 50)
    print(f"Membros: {len(conselho.MEMBROS)}")
    for m_id, m in conselho.MEMBROS.items():
        print(f"  • {m['nome']} ({m['cargo']})")

    # Simula votação
    sessao = conselho.convocar_sessao("Aprovação de nova CKU: 612.P12.1.1 — Quantum ML", "IA-MASTER-021")
    print(f"\nSessão convocada: {sessao['sessao_id']}")

    # Membros votam
    for membro in conselho.MEMBROS:
        voto = random.choice(["FAVOR", "CONTRA", "ABSTENCAO"])
        result = conselho.votar(sessao["sessao_id"], membro, voto, "Análise técnica completa")
        print(f"  {membro}: {voto}")

    # Resultado
    sessao_final = next(s for s in conselho.votacoes if s["sessao_id"] == sessao["sessao_id"])
    if sessao_final.get("resultado"):
        r = sessao_final["resultado"]
        print(f"\nResultado: {'APROVADO' if r['aprovado'] else 'REJEITADO'}")
        print(f"  Favor: {r['favor']}, Contra: {r['contra']}, Abstenção: {r['abstencao']}")