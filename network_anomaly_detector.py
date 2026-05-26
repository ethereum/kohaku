#!/usr/bin/env python3
# "network_anomaly_detector.py" — Substrato 863.4
# Monitora conexões de saída e bloqueia IPs suspeitos
import subprocess
import re

class NetworkAnomalyDetector:
    def __init__(self):
        self.known_malicious_ips = set()

    def scan_connections(self):
        try:
            # Exemplo usando netstat (Linux)
            output = subprocess.check_output(["netstat", "-ntup"], stderr=subprocess.DEVNULL).decode()
            for line in output.splitlines():
                if "ESTABLISHED" in line:
                    # extrai IP de destino
                    match = re.search(r'(\d+\.\d+\.\d+\.\d+):\d+\s+ESTABLISHED', line)
                    if match:
                        ip = match.group(1)
                        if ip in self.known_malicious_ips:
                            print(f"[ALERTA] Conexão com IP malicioso: {ip}")
                            # Bloqueia via iptables (exemplo)
                            # subprocess.run(["sudo", "iptables", "-A", "OUTPUT", "-d", ip, "-j", "DROP"])
        except Exception as e:
            print(f"Erro ao escanear conexoes: {e}")