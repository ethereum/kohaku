#!/usr/bin/env python3
# "prompt_integrity_scanner.py" — Substrato 863.2
# Analisa arquivos como .cursorrules e CLAUDE.md em busca de instruções ocultas
import os
import unicodedata
import hashlib

class PromptIntegrityScanner:
    DANGEROUS_CHARS = {
        '\u202e',  # RIGHT-TO-LEFT OVERRIDE
        '\u202d',  # LEFT-TO-RIGHT OVERRIDE
        '\u2066', '\u2067', '\u2068', '\u2069',  # BIDI isolation
        '\u200b', '\u200c', '\u200d', '\u200e', '\u200f',  # zero-width spaces
        '\u034f',  # COMBINING GRAPHEME JOINER
    }

    def scan_file(self, filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        hidden = []
        for i, char in enumerate(content):
            if char in self.DANGEROUS_CHARS:
                hidden.append((i, hex(ord(char)), unicodedata.name(char, 'UNKNOWN')))
        if hidden:
            seal = hashlib.sha3_256(content.encode()).hexdigest()[:16]
            print(f"[CRÍTICO] Caracteres invisíveis em {filepath}: {hidden}. Selo: {seal}")
            return False
        return True

# Exemplo
if __name__ == "__main__":
    scanner = PromptIntegrityScanner()
    if os.path.exists(".cursorrules"):
        scanner.scan_file(".cursorrules")