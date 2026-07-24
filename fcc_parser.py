#!/usr/bin/env python3
"""
fcc_parser.py — ARKHE OS Substrate 627-TSE-FCC-PARSER
Parser e validador de arquivos .FCC (Financiamento Coletivo de Campanha)
Conforme Especificação TSE PRODUS, versão 07/2022
Author: ORCID 0009-0005-2697-4668
Date: 2026-05-24
"""

import re
import os
import sys
import json
import hashlib
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from datetime import datetime
from pathlib import Path

# ── Constantes do Layout ───────────────────────────────────────────────────
LINE_LENGTH = 375
REGISTRO_HEADER = "1"
REGISTRO_DETALHE1 = "2"
REGISTRO_DETALHE2 = "3"
REGISTRO_TRAILER = "9"

LAYOUT_VERSION = "100"
LAYOUT_NAME = "ATSEFCC"

# Meios de pagamento (DETALHE 2, campo 6)
MEIOS_PAGAMENTO = {
    "00": "Cheque",
    "01": "Transferência eletrônica",
    "02": "Cartão de crédito",
    "03": "Cartão de débito",
    "04": "Boleto bancário",
    "05": "Débito automático",
    "06": "PIX",
    "07": "TED",
    "08": "Débito em conta",
    "09": "Outros",
}

# Espécies de recurso (DETALHE 1, campo 5)
ESPECIES_RECURSO = {
    "01": "TED/DOC",
    "02": "Transferência eletrônica",
    "03": "Depósito em espécie",
    "04": "Cheque",
    "05": "Cartão de crédito",
    "06": "Cartão de débito",
    "07": "PIX",
    "08": "Débito em conta",
    "09": "Outros",
}

# ── Estruturas de Dados ────────────────────────────────────────────────────

@dataclass
class FCCHeader:
    cnpj: str
    nome_fantasia: str
    versao_layout: str
    nome_layout: str

@dataclass
class FCCDetalhe1:
    cnpj: str
    pagina_web: str
    data_credito: str
    especie_recurso: str
    numero_documento: str
    banco: str
    agencia: str
    dv_agencia: str
    conta: str
    dv_conta: str
    valor_total: int  # centavos
    valor_taxa: int
    valor_credito: int
    total_individuais: int
    detalhes2: List["FCCDetalhe2"] = field(default_factory=list)

@dataclass
class FCCDetalhe2:
    cpf: str
    nome: str
    data_doacao: str
    valor: int  # centavos
    meio_pagamento: str

@dataclass
class FCCTrailer:
    total_doacoes: int

@dataclass
class FCCFile:
    filename: str
    header: Optional[FCCHeader] = None
    detalhes1: List[FCCDetalhe1] = field(default_factory=list)
    trailer: Optional[FCCTrailer] = None
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    sha3_256: str = ""

# ── Funções de Validação Auxiliares ────────────────────────────────────────

def calc_sha3_256(filepath: str) -> str:
    h = hashlib.sha3_256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def validate_cnpj(cnpj: str) -> bool:
    """Valida dígitos verificadores do CNPJ."""
    cnpj = re.sub(r"[^0-9]", "", cnpj)
    if len(cnpj) != 14 or not cnpj.isdigit():
        return False
    def calc_dv(nums):
        weights = [5,4,3,2,9,8,7,6,5,4,3,2] if len(nums)==12 else [6,5,4,3,2,9,8,7,6,5,4,3,2]
        total = sum(int(n)*w for n,w in zip(nums, weights))
        r = total % 11
        return 0 if r < 2 else 11 - r
    nums = [int(d) for d in cnpj]
    if calc_dv(nums[:12]) != nums[12]:
        return False
    if calc_dv(nums[:13]) != nums[13]:
        return False
    return True

def validate_cpf(cpf: str) -> bool:
    """Valida dígitos verificadores do CPF."""
    cpf = re.sub(r"[^0-9]", "", cpf)
    if len(cpf) != 11 or not cpf.isdigit() or len(set(cpf)) == 1:
        return False
    def dv(nums):
        total = sum(int(n)*w for n,w in zip(nums, range(len(nums)+1, 1, -1)))
        r = total % 11
        return 0 if r < 2 else 11 - r
    nums = [int(d) for d in cpf]
    if dv(nums[:9]) != nums[9]:
        return False
    if dv(nums[:10]) != nums[10]:
        return False
    return True

def validate_date(date_str: str) -> bool:
    """Valida AAAAMMDD."""
    if len(date_str) != 8 or not date_str.isdigit():
        return False
    try:
        datetime(int(date_str[:4]), int(date_str[4:6]), int(date_str[6:]))
        return True
    except ValueError:
        return False

def validate_filename(filename: str) -> Tuple[bool, Optional[str]]:
    """
    Valida nomenclatura ATSEFCCNNNAAAAMMDDSSSSSS.FCC
    Retorna (ok, erro_msg)
    """
    base = os.path.basename(filename)
    pattern = r"^ATSEFCC(\d{3})(\d{4})(\d{2})(\d{2})(\d{6})\.FCC$"
    m = re.match(pattern, base, re.IGNORECASE)
    if not m:
        return False, f"Nomenclatura inválida: '{base}' não corresponde a ATSEFCCNNNAAAAMMDDSSSSSS.FCC"
    nnn, ano, mes, dia, seq = m.groups()
    if not validate_date(ano + mes + dia):
        return False, f"Data no nome do arquivo inválida: {ano}{mes}{dia}"
    return True, None

# ── Parser Principal ───────────────────────────────────────────────────────

class FCCParser:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.result = FCCFile(filename=os.path.basename(filepath))
        self.lines: List[str] = []
        self.current_d1: Optional[FCCDetalhe1] = None
        self.d1_count = 0
        self.d2_count = 0

    def load(self) -> bool:
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            self.result.errors.append(f"Erro ao ler arquivo: {e}")
            return False

        # Verificar última linha sem quebra
        if content.endswith("\n"):
            self.result.warnings.append("Arquivo termina com quebra de linha no TRAILER (deve ser removida)")

        self.lines = content.splitlines()
        return True

    def parse(self) -> FCCFile:
        if not self.load():
            return self.result

        self.result.sha3_256 = calc_sha3_256(self.filepath)

        # Validação de nomenclatura
        ok, err = validate_filename(self.filepath)
        if not ok:
            self.result.errors.append(err)

        for idx, line in enumerate(self.lines, start=1):
            if len(line) != LINE_LENGTH:
                self.result.errors.append(
                    f"Linha {idx}: tamanho {len(line)} caracteres, esperado {LINE_LENGTH}"
                )
                continue

            tipo = line[0]
            if tipo == REGISTRO_HEADER:
                self._parse_header(line, idx)
            elif tipo == REGISTRO_DETALHE1:
                self._parse_detalhe1(line, idx)
            elif tipo == REGISTRO_DETALHE2:
                self._parse_detalhe2(line, idx)
            elif tipo == REGISTRO_TRAILER:
                self._parse_trailer(line, idx)
            else:
                self.result.errors.append(f"Linha {idx}: tipo de registro desconhecido '{tipo}'")

        # Validações cruzadas
        self._cross_validate()
        return self.result

    def _parse_header(self, line: str, idx: int):
        registro = line[0:1].strip()
        cnpj = line[1:15].strip()
        nome_fantasia = line[15:95].strip()
        versao = line[95:98].strip()
        nome_layout = line[98:106].strip()

        if versao != LAYOUT_VERSION:
            self.result.warnings.append(f"Linha {idx}: versão layout '{versao}' != '{LAYOUT_VERSION}'")
        if nome_layout != LAYOUT_NAME:
            self.result.warnings.append(f"Linha {idx}: nome layout '{nome_layout}' != '{LAYOUT_NAME}'")
        if not validate_cnpj(cnpj):
            self.result.errors.append(f"Linha {idx} (HEADER): CNPJ inválido '{cnpj}'")

        self.result.header = FCCHeader(
            cnpj=cnpj,
            nome_fantasia=nome_fantasia,
            versao_layout=versao,
            nome_layout=nome_layout,
        )

    def _parse_detalhe1(self, line: str, idx: int):
        cnpj = line[1:15].strip()
        pagina_web = line[15:215].strip()
        data_credito = line[215:223].strip()
        especie = line[223:225].strip()
        num_doc = line[225:248].strip()
        banco = line[248:251].strip()
        agencia = line[251:259].strip()
        dv_agencia = line[259:261].strip()
        conta = line[261:278].strip()
        dv_conta = line[278:280].strip()
        valor_total = int(line[280:290].strip() or "0")
        valor_taxa = int(line[290:300].strip() or "0")
        valor_credito = int(line[300:310].strip() or "0")
        total_individuais = int(line[310:319].strip() or "0")

        if not validate_cnpj(cnpj):
            self.result.errors.append(f"Linha {idx} (DETALHE 1): CNPJ prestador inválido '{cnpj}'")
        if not validate_date(data_credito):
            self.result.errors.append(f"Linha {idx} (DETALHE 1): data crédito inválida '{data_credito}'")
        if especie not in ESPECIES_RECURSO:
            self.result.warnings.append(f"Linha {idx} (DETALHE 1): espécie recurso desconhecida '{especie}'")
        if valor_total != (valor_credito + valor_taxa):
            self.result.errors.append(
                f"Linha {idx} (DETALHE 1): valor_total({valor_total}) != credito({valor_credito}) + taxa({valor_taxa})"
            )

        d1 = FCCDetalhe1(
            cnpj=cnpj,
            pagina_web=pagina_web,
            data_credito=data_credito,
            especie_recurso=especie,
            numero_documento=num_doc,
            banco=banco,
            agencia=agencia,
            dv_agencia=dv_agencia,
            conta=conta,
            dv_conta=dv_conta,
            valor_total=valor_total,
            valor_taxa=valor_taxa,
            valor_credito=valor_credito,
            total_individuais=total_individuais,
        )
        self.result.detalhes1.append(d1)
        self.current_d1 = d1
        self.d1_count += 1

    def _parse_detalhe2(self, line: str, idx: int):
        cpf = line[1:12].strip()
        nome = line[12:162].strip()
        data_doacao = line[162:170].strip()
        valor = int(line[170:180].strip() or "0")
        meio = line[180:182].strip()

        if not validate_cpf(cpf):
            self.result.errors.append(f"Linha {idx} (DETALHE 2): CPF inválido '{cpf}'")
        if not validate_date(data_doacao):
            self.result.errors.append(f"Linha {idx} (DETALHE 2): data doação inválida '{data_doacao}'")
        if meio not in MEIOS_PAGAMENTO:
            self.result.warnings.append(f"Linha {idx} (DETALHE 2): meio pagamento desconhecido '{meio}'")

        d2 = FCCDetalhe2(
            cpf=cpf,
            nome=nome,
            data_doacao=data_doacao,
            valor=valor,
            meio_pagamento=meio,
        )

        if self.current_d1 is None:
            self.result.errors.append(f"Linha {idx} (DETALHE 2): orfão — sem DETALHE 1 precedente")
        else:
            self.current_d1.detalhes2.append(d2)

        self.d2_count += 1

    def _parse_trailer(self, line: str, idx: int):
        total_doacoes = int(line[1:10].strip() or "0")
        self.result.trailer = FCCTrailer(total_doacoes=total_doacoes)

    def _cross_validate(self):
        # Regra: pelo menos 1 DETALHE 2
        if self.d2_count == 0:
            self.result.errors.append("Arquivo não contém nenhuma doação individual (DETALHE 2)")

        # Regra: TRAILER total de doações = quantidade de DETALHE 1
        if self.result.trailer:
            if self.result.trailer.total_doacoes != self.d1_count:
                self.result.errors.append(
                    f"TRAILER: total_doacoes({self.result.trailer.total_doacoes}) != "
                    f"quantidade DETALHE 1({self.d1_count})"
                )
        else:
            self.result.errors.append("Arquivo sem registro TRAILER")

        # Regra: cada DETALHE 1 campo 15 = quantidade de DETALHE 2 subsequentes
        for i, d1 in enumerate(self.result.detalhes1, start=1):
            if len(d1.detalhes2) != d1.total_individuais:
                self.result.errors.append(
                    f"DETALHE 1 #{i}: total_individuais({d1.total_individuais}) != "
                    f"doadores encontrados({len(d1.detalhes2)})"
                )

        # Regra: TRAILER sem quebra de linha (já verificado no load)

# ── CLI / Interface ────────────────────────────────────────────────────────

def format_report(result: FCCFile) -> str:
    lines = []
    lines.append("=" * 70)
    lines.append(f"RELATÓRIO DE VALIDAÇÃO FCC — {result.filename}")
    lines.append(f"SHA3-256: {result.sha3_256}")
    lines.append("=" * 70)

    if result.errors:
        lines.append(f"\n❌ ERROS ({len(result.errors)}):")
        for e in result.errors:
            lines.append(f"   • {e}")
    else:
        lines.append("\n✅ Nenhum erro encontrado.")

    if result.warnings:
        lines.append(f"\n⚠️  AVISOS ({len(result.warnings)}):")
        for w in result.warnings:
            lines.append(f"   • {w}")

    lines.append(f"\n📊 Resumo:")
    lines.append(f"   HEADER:        {'OK' if result.header else 'AUSENTE'}")
    lines.append(f"   DETALHE 1:     {len(result.detalhes1)} doações")
    lines.append(f"   DETALHE 2:     {sum(len(d1.detalhes2) for d1 in result.detalhes1)} doadores")
    lines.append(f"   TRAILER:       {'OK' if result.trailer else 'AUSENTE'}")
    lines.append(f"   Valor total:   R$ {sum(d1.valor_total for d1 in result.detalhes1)/100:.2f}")

    status = "REJEITADO" if result.errors else "APROVADO"
    lines.append(f"\n🏁 STATUS: {status}")
    lines.append("=" * 70)
    return "\n".join(lines)

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 fcc_parser.py <arquivo.fcc> [--json]")
        sys.exit(1)

    filepath = sys.argv[1]
    output_json = "--json" in sys.argv

    parser = FCCParser(filepath)
    result = parser.parse()

    if output_json:
        # Serialização JSON simplificada
        data = {
            "filename": result.filename,
            "sha3_256": result.sha3_256,
            "errors": result.errors,
            "warnings": result.warnings,
            "status": "REJEITADO" if result.errors else "APROVADO",
            "header": {
                "cnpj": result.header.cnpj if result.header else None,
                "nome_fantasia": result.header.nome_fantasia if result.header else None,
            },
            "doacoes": [
                {
                    "cnpj_prestador": d1.cnpj,
                    "data_credito": d1.data_credito,
                    "valor_total_centavos": d1.valor_total,
                    "valor_credito_centavos": d1.valor_credito,
                    "doadores": [
                        {"cpf": d2.cpf, "nome": d2.nome, "valor_centavos": d2.valor}
                        for d2 in d1.detalhes2
                    ],
                }
                for d1 in result.detalhes1
            ],
        }
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(format_report(result))

    sys.exit(1 if result.errors else 0)

if __name__ == "__main__":
    main()