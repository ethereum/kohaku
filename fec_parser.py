#!/usr/bin/env python3
"""
fec_parser.py — ARKHE OS Substrate 628-FEC-PARSER
Parser e validador de arquivos .fec (Federal Election Commission)
Conforme especificação FEC electronic filing v8.5 (2025)
Author: ORCID 0009-0005-2697-4668
Date: 2026-05-24
"""

import re
import os
import sys
import json
import hashlib
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from datetime import datetime
from pathlib import Path

# ── Constantes do Layout FEC ─────────────────────────────────────────────
DELIMITER = "|"

# Tipos de formulários (Form Types)
FORM_TYPES = {
    "F3": "Report of Receipts and Disbursements — Candidate",
    "F3X": "Report of Receipts and Disbursements — Non-Candidate",
    "F3P": "Report of Receipts and Disbursements — Presidential",
    "F3L": "Report of Bundled Contributions",
    "F4": "Report of Receipts and Disbursements — Convention",
    "F5": "Report of Independent Expenditures",
    "F6": "48-Hour Notice of Contributions",
    "F7": "Report of Communication Costs",
    "F8": "Report of Disbursements for Electioneering",
    "F9": "Report of Expenditures on Credit Card",
    "F13": "Report of Donations Accepted",
    "F24": "24/48-Hour Report of Independent Expenditures",
    "F99": "Miscellaneous Electronic Submission",
    "F1": "Statement of Organization",
    "F1M": "Statement of Organization — Multi-Candidate",
    "F2": "Statement of Candidacy",
}

# Schedules (tipos de transação)
SCHEDULES = {
    "SA": "Schedule A — Receipts (contributions, loans)",
    "SB": "Schedule B — Disbursements (expenditures, refunds)",
    "SC": "Schedule C — Loans",
    "SC1": "Schedule C-1 — Loan Agreement",
    "SC2": "Schedule C-2 — Loan Restructure",
    "SD": "Schedule D — Debts",
    "SE": "Schedule E — Independent Expenditures",
    "SF": "Schedule F — Coordinated Expenditures",
    "SH": "Schedule H — Allocation",
    "SL": "Schedule L — Lobbyist Bundling",
}

# Códigos de entidade (Entity Types)
ENTITY_TYPES = {
    "CAN": "Candidate",
    "CCM": "Candidate Committee",
    "COM": "Committee",
    "IND": "Individual",
    "ORG": "Organization",
    "PAC": "Political Action Committee",
    "PTY": "Party Organization",
}

# ── Estruturas de Dados ────────────────────────────────────────────────────

@dataclass
class FECHeader:
    record_type: str          # HDR (header do arquivo)
    ef_type: str              # Tipo de e-filing (e.g., "FEC")
    software_name: str
    software_version: str
    batch_id: Optional[str] = None

@dataclass
class FECForm:
    form_type: str
    filer_committee_id: str
    committee_name: str
    street_1: str
    street_2: str
    city: str
    state: str
    zip: str
    report_code: str
    coverage_from_date: str
    coverage_through_date: str
    treasurer_name: str
    treasurer_signature: bool
    signature_date: str

@dataclass
class FECScheduleA:
    form_type: str            # SA11AI, SA17A, etc.
    filer_committee_id: str
    transaction_id: str
    back_reference_id: Optional[str]
    back_reference_sched: Optional[str]
    entity_type: str
    contributor_name: str
    contributor_street_1: str
    contributor_street_2: str
    contributor_city: str
    contributor_state: str
    contributor_zip: str
    election_code: str
    election_other_description: str
    contribution_date: str
    contribution_amount: float
    contribution_aggregate: float
    contribution_purpose: str
    employer: str
    occupation: str
    memo_code: str
    memo_text: str

@dataclass
class FECScheduleB:
    form_type: str            # SB17, SB21B, etc.
    filer_committee_id: str
    transaction_id: str
    back_reference_id: Optional[str]
    back_reference_sched: Optional[str]
    entity_type: str
    payee_name: str
    payee_street_1: str
    payee_street_2: str
    payee_city: str
    payee_state: str
    payee_zip: str
    election_code: str
    election_other_description: str
    disbursement_date: str
    disbursement_amount: float
    disbursement_purpose: str
    category_code: str
    memo_code: str
    memo_text: str

@dataclass
class FECFile:
    filename: str
    header: Optional[FECHeader] = None
    forms: List[FECForm] = field(default_factory=list)
    schedules_a: List[FECScheduleA] = field(default_factory=list)
    schedules_b: List[FECScheduleB] = field(default_factory=list)
    raw_lines: List[List[str]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    sha3_256: str = ""

# ── Funções de Validação ─────────────────────────────────────────────────

def calc_sha3_256(filepath: str) -> str:
    h = hashlib.sha3_256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def validate_committee_id(committee_id: str) -> bool:
    """Committee ID FEC: C + 8 dígitos (ex: C00123456)"""
    pattern = r"^C\d{8}$"
    return bool(re.match(pattern, committee_id))

def validate_date(date_str: str) -> bool:
    """Valida MMDDYYYY ou AAAAMMDD (formato FEC)."""
    if len(date_str) != 8 or not date_str.isdigit():
        return False
    try:
        # FEC usa MMDDYYYY
        month = int(date_str[:2])
        day = int(date_str[2:4])
        year = int(date_str[4:])
        datetime(year, month, day)
        return True
    except ValueError:
        return False

def validate_zip(zip_code: str) -> bool:
    """ZIP code US: 5 dígitos ou 5+4."""
    pattern = r"^\d{5}(-\d{4})?$"
    return bool(re.match(pattern, zip_code))

def validate_amount(amount_str: str) -> Tuple[bool, float]:
    """Valida valor monetário FEC (centavos implícitos, 2 casas decimais)."""
    try:
        val = float(amount_str)
        return True, val
    except ValueError:
        return False, 0.0

def validate_state(state: str) -> bool:
    """Valida código de estado US (2 letras)."""
    states = {
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
        "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
        "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
        "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
        "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
        "DC", "PR", "GU", "VI", "AS", "MP",
    }
    return state.upper() in states

def validate_report_code(code: str) -> bool:
    """Códigos de report FEC."""
    valid = {
        "Q1", "Q2", "Q3", "YE", "12P", "12G", "12R", "12C", "12S",
        "30G", "30R", "30S", "M2", "M3", "M4", "M5", "M6", "M7",
        "M8", "M9", "M10", "M11", "M12", "TER", "MY", "YE",
        "24", "48", "M1",
    }
    return code.upper() in valid

# ── Parser Principal ───────────────────────────────────────────────────────

class FECParser:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.result = FECFile(filename=os.path.basename(filepath))
        self.lines: List[List[str]] = []

    def load(self) -> bool:
        try:
            with open(self.filepath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception as e:
            self.result.errors.append(f"Erro ao ler arquivo: {e}")
            return False

        # Parse lines by delimiter
        self.lines = []
        for line_num, raw_line in enumerate(content.splitlines(), start=1):
            # FEC files use pipe delimiter
            fields = raw_line.split(DELIMITER)
            self.lines.append(fields)
        return True

    def parse(self) -> FECFile:
        if not self.load():
            return self.result

        self.result.sha3_256 = calc_sha3_256(self.filepath)

        for idx, fields in enumerate(self.lines, start=1):
            if not fields:
                continue

            record_type = fields[0].upper().strip()

            if record_type == "HDR":
                self._parse_header(fields, idx)
            elif record_type in ("F3", "F3X", "F3P", "F3L", "F4", "F5", "F6", "F7", "F8", "F9", "F13", "F24", "F99", "F1", "F1M", "F2"):
                self._parse_form(fields, idx)
            elif record_type.startswith("SA"):
                self._parse_schedule_a(fields, idx)
            elif record_type.startswith("SB"):
                self._parse_schedule_b(fields, idx)
            elif record_type.startswith("SC"):
                self.result.warnings.append(f"Linha {idx}: Schedule C (loans) — parsing básico")
            elif record_type.startswith("SD"):
                self.result.warnings.append(f"Linha {idx}: Schedule D (debts) — parsing básico")
            elif record_type.startswith("SE"):
                self.result.warnings.append(f"Linha {idx}: Schedule E (independent expenditures) — parsing básico")
            else:
                self.result.warnings.append(f"Linha {idx}: tipo de registro desconhecido '{record_type}'")

        self._cross_validate()
        return self.result

    def _parse_header(self, fields: List[str], idx: int):
        if len(fields) < 4:
            self.result.errors.append(f"Linha {idx} (HDR): campos insuficientes")
            return
        self.result.header = FECHeader(
            record_type=fields[0],
            ef_type=fields[1] if len(fields) > 1 else "",
            software_name=fields[2] if len(fields) > 2 else "",
            software_version=fields[3] if len(fields) > 3 else "",
            batch_id=fields[4] if len(fields) > 4 else None,
        )

    def _parse_form(self, fields: List[str], idx: int):
        form_type = fields[0].upper()
        if form_type not in FORM_TYPES:
            self.result.warnings.append(f"Linha {idx}: form type '{form_type}' não reconhecido")

        # Form types have variable lengths; we handle common ones
        if form_type in ("F3", "F3X", "F3P"):
            if len(fields) < 40:
                self.result.errors.append(f"Linha {idx} ({form_type}): campos insuficientes ({len(fields)})")
                return

            committee_id = fields[1].strip()
            if not validate_committee_id(committee_id):
                self.result.errors.append(f"Linha {idx} ({form_type}): committee ID inválido '{committee_id}'")

            report_code = fields[25].strip() if len(fields) > 25 else ""
            if report_code and not validate_report_code(report_code):
                self.result.warnings.append(f"Linha {idx} ({form_type}): report code desconhecido '{report_code}'")

            coverage_from = fields[28].strip() if len(fields) > 28 else ""
            coverage_through = fields[29].strip() if len(fields) > 29 else ""
            if coverage_from and not validate_date(coverage_from):
                self.result.errors.append(f"Linha {idx} ({form_type}): coverage from date inválida '{coverage_from}'")
            if coverage_through and not validate_date(coverage_through):
                self.result.errors.append(f"Linha {idx} ({form_type}): coverage through date inválida '{coverage_through}'")

            form = FECForm(
                form_type=form_type,
                filer_committee_id=committee_id,
                committee_name=fields[2].strip() if len(fields) > 2 else "",
                street_1=fields[3].strip() if len(fields) > 3 else "",
                street_2=fields[4].strip() if len(fields) > 4 else "",
                city=fields[5].strip() if len(fields) > 5 else "",
                state=fields[6].strip() if len(fields) > 6 else "",
                zip=fields[7].strip() if len(fields) > 7 else "",
                report_code=report_code,
                coverage_from_date=coverage_from,
                coverage_through_date=coverage_through,
                treasurer_name=fields[35].strip() if len(fields) > 35 else "",
                treasurer_signature=fields[36].strip().upper() == "X" if len(fields) > 36 else False,
                signature_date=fields[37].strip() if len(fields) > 37 else "",
            )
            self.result.forms.append(form)

    def _parse_schedule_a(self, fields: List[str], idx: int):
        if len(fields) < 20:
            self.result.errors.append(f"Linha {idx} (SA): campos insuficientes ({len(fields)})")
            return

        committee_id = fields[1].strip()
        if not validate_committee_id(committee_id):
            self.result.warnings.append(f"Linha {idx} (SA): committee ID '{committee_id}' formato não padrão")

        date_str = fields[13].strip() if len(fields) > 13 else ""
        if date_str and not validate_date(date_str):
            self.result.errors.append(f"Linha {idx} (SA): contribution date inválida '{date_str}'")

        amount_ok, amount = validate_amount(fields[14]) if len(fields) > 14 else (False, 0.0)
        if not amount_ok:
            self.result.errors.append(f"Linha {idx} (SA): contribution amount inválido")

        agg_ok, agg = validate_amount(fields[15]) if len(fields) > 15 else (False, 0.0)

        state = fields[10].strip() if len(fields) > 10 else ""
        if state and not validate_state(state):
            self.result.warnings.append(f"Linha {idx} (SA): state '{state}' não reconhecido")

        zip_code = fields[11].strip() if len(fields) > 11 else ""
        if zip_code and not validate_zip(zip_code):
            self.result.warnings.append(f"Linha {idx} (SA): ZIP '{zip_code}' formato inválido")

        sa = FECScheduleA(
            form_type=fields[0],
            filer_committee_id=committee_id,
            transaction_id=fields[2].strip() if len(fields) > 2 else "",
            back_reference_id=fields[3].strip() if len(fields) > 3 else None,
            back_reference_sched=fields[4].strip() if len(fields) > 4 else None,
            entity_type=fields[5].strip() if len(fields) > 5 else "",
            contributor_name=fields[6].strip() if len(fields) > 6 else "",
            contributor_street_1=fields[7].strip() if len(fields) > 7 else "",
            contributor_street_2=fields[8].strip() if len(fields) > 8 else "",
            contributor_city=fields[9].strip() if len(fields) > 9 else "",
            contributor_state=state,
            contributor_zip=zip_code,
            election_code=fields[12].strip() if len(fields) > 12 else "",
            election_other_description="",
            contribution_date=date_str,
            contribution_amount=amount,
            contribution_aggregate=agg,
            contribution_purpose=fields[16].strip() if len(fields) > 16 else "",
            employer=fields[17].strip() if len(fields) > 17 else "",
            occupation=fields[18].strip() if len(fields) > 18 else "",
            memo_code=fields[19].strip() if len(fields) > 19 else "",
            memo_text=fields[20].strip() if len(fields) > 20 else "",
        )
        self.result.schedules_a.append(sa)

    def _parse_schedule_b(self, fields: List[str], idx: int):
        if len(fields) < 20:
            self.result.errors.append(f"Linha {idx} (SB): campos insuficientes ({len(fields)})")
            return

        committee_id = fields[1].strip()
        if not validate_committee_id(committee_id):
            self.result.warnings.append(f"Linha {idx} (SB): committee ID '{committee_id}' formato não padrão")

        date_str = fields[13].strip() if len(fields) > 13 else ""
        if date_str and not validate_date(date_str):
            self.result.errors.append(f"Linha {idx} (SB): disbursement date inválida '{date_str}'")

        amount_ok, amount = validate_amount(fields[14]) if len(fields) > 14 else (False, 0.0)
        if not amount_ok:
            self.result.errors.append(f"Linha {idx} (SB): disbursement amount inválido")

        state = fields[10].strip() if len(fields) > 10 else ""
        if state and not validate_state(state):
            self.result.warnings.append(f"Linha {idx} (SB): state '{state}' não reconhecido")

        sb = FECScheduleB(
            form_type=fields[0],
            filer_committee_id=committee_id,
            transaction_id=fields[2].strip() if len(fields) > 2 else "",
            back_reference_id=fields[3].strip() if len(fields) > 3 else None,
            back_reference_sched=fields[4].strip() if len(fields) > 4 else None,
            entity_type=fields[5].strip() if len(fields) > 5 else "",
            payee_name=fields[6].strip() if len(fields) > 6 else "",
            payee_street_1=fields[7].strip() if len(fields) > 7 else "",
            payee_street_2=fields[8].strip() if len(fields) > 8 else "",
            payee_city=fields[9].strip() if len(fields) > 9 else "",
            payee_state=state,
            payee_zip=fields[11].strip() if len(fields) > 11 else "",
            election_code=fields[12].strip() if len(fields) > 12 else "",
            election_other_description="",
            disbursement_date=date_str,
            disbursement_amount=amount,
            disbursement_purpose=fields[16].strip() if len(fields) > 16 else "",
            category_code=fields[17].strip() if len(fields) > 17 else "",
            memo_code=fields[18].strip() if len(fields) > 18 else "",
            memo_text=fields[19].strip() if len(fields) > 19 else "",
        )
        self.result.schedules_b.append(sb)

    def _cross_validate(self):
        # Regra: todo arquivo deve ter HDR
        if self.result.header is None:
            self.result.errors.append("Arquivo sem registro HDR (header)")

        # Regra: todo arquivo deve ter pelo menos um form
        if not self.result.forms:
            self.result.errors.append("Arquivo sem formulário (F3/F3X/F3P/etc.)")

        # Regra: se há SA, devem ter committee IDs consistentes
        committee_ids = set()
        for form in self.result.forms:
            committee_ids.add(form.filer_committee_id)
        for sa in self.result.schedules_a:
            if sa.filer_committee_id not in committee_ids:
                self.result.warnings.append(
                    f"Schedule A committee ID '{sa.filer_committee_id}' não encontrado nos forms"
                )

        # Regra: contribuições > $200 devem ter employer/occupation (Itemization threshold)
        for sa in self.result.schedules_a:
            if sa.contribution_amount > 200.0:
                if not sa.employer or not sa.occupation:
                    self.result.warnings.append(
                        f"SA txid={sa.transaction_id}: contribuição > $200 sem employer/occupation"
                    )

        # Regra: total de receipts deve bater com form summary (quando disponível)
        # (Stub: requer parsing do summary page do form)

# ── CLI / Interface ────────────────────────────────────────────────────────

def format_report(result: FECFile) -> str:
    lines = []
    lines.append("=" * 70)
    lines.append(f"RELATÓRIO DE VALIDAÇÃO FEC — {result.filename}")
    lines.append(f"SHA3-256: {result.sha3_256}")
    lines.append("=" * 70)

    if result.header:
        lines.append(f"\n📋 HEADER:")
        lines.append(f"   Software: {result.header.software_name} v{result.header.software_version}")
        lines.append(f"   EF Type: {result.header.ef_type}")

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

    total_receipts = sum(sa.contribution_amount for sa in result.schedules_a)
    total_disbursements = sum(sb.disbursement_amount for sb in result.schedules_b)

    lines.append(f"\n📊 Resumo:")
    lines.append(f"   Forms:         {len(result.forms)}")
    lines.append(f"   Schedule A:    {len(result.schedules_a)} transações | ${total_receipts:,.2f}")
    lines.append(f"   Schedule B:    {len(result.schedules_b)} transações | ${total_disbursements:,.2f}")
    lines.append(f"   Outros:        {len(result.raw_lines) - len(result.forms) - len(result.schedules_a) - len(result.schedules_b)} registros")

    status = "REJEITADO" if result.errors else "APROVADO"
    lines.append(f"\n🏁 STATUS: {status}")
    lines.append("=" * 70)
    return "\n".join(lines)

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 fec_parser.py <arquivo.fec> [--json]")
        sys.exit(1)

    filepath = sys.argv[1]
    output_json = "--json" in sys.argv

    parser = FECParser(filepath)
    result = parser.parse()

    if output_json:
        data = {
            "filename": result.filename,
            "sha3_256": result.sha3_256,
            "errors": result.errors,
            "warnings": result.warnings,
            "status": "REJEITADO" if result.errors else "APROVADO",
            "header": {
                "software": result.header.software_name if result.header else None,
                "version": result.header.software_version if result.header else None,
            },
            "forms": [
                {
                    "type": f.form_type,
                    "committee_id": f.filer_committee_id,
                    "committee_name": f.committee_name,
                    "report_code": f.report_code,
                    "coverage": f"{f.coverage_from_date} - {f.coverage_through_date}",
                }
                for f in result.forms
            ],
            "receipts": [
                {
                    "txid": sa.transaction_id,
                    "contributor": sa.contributor_name,
                    "date": sa.contribution_date,
                    "amount": sa.contribution_amount,
                    "employer": sa.employer,
                    "occupation": sa.occupation,
                }
                for sa in result.schedules_a
            ],
            "disbursements": [
                {
                    "txid": sb.transaction_id,
                    "payee": sb.payee_name,
                    "date": sb.disbursement_date,
                    "amount": sb.disbursement_amount,
                    "purpose": sb.disbursement_purpose,
                }
                for sb in result.schedules_b
            ],
        }
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(format_report(result))

    sys.exit(1 if result.errors else 0)

if __name__ == "__main__":
    main()