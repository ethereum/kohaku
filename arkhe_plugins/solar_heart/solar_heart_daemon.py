#!/usr/bin/env python3
"""
solar_heart_daemon.py — Solar awareness data acquisition.
Substrate 646-SOLAR-HEART
Fetches solar data from NOAA/DSCOVR, computes Φ_sun, publishes to sysfs.
"""

import time
import json
import requests
import numpy as np
from datetime import datetime, timezone
from pathlib import Path
import os

# ═══════════════════════════════════════════════════════════════════
# Data sources
# ═══════════════════════════════════════════════════════════════════
NOAA_SOLAR_WIND_URL = "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json"
NOAA_SUNSPOT_URL = "https://services.swpc.noaa.gov/json/sunspot_report.json"
NOAA_MAG_URL = "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json"
SYSFS_DIR = "/sys/arkhe/serv/solar-heart"
SYSFS_RESULT = f"{SYSFS_DIR}/result"
SYSFS_STATUS = f"{SYSFS_DIR}/status"

def fetch_solar_wind():
    """Obtém velocidade e densidade do vento solar."""
    resp = requests.get(NOAA_SOLAR_WIND_URL)
    data = resp.json()
    # Última medição
    last = data[-1]
    speed = float(last[1])   # km/s
    density = float(last[2]) # p/cc
    return speed, density

def fetch_magnetic_field():
    """Obtém magnitude do campo magnético interplanetário."""
    resp = requests.get(NOAA_MAG_URL)
    data = resp.json()
    last = data[-1]
    bt = float(last[6])  # Bt em nT
    return bt

def fetch_sunspot_number():
    """Obtém SSN."""
    resp = requests.get(NOAA_SUNSPOT_URL)
    data = resp.json()
    ssn = data.get("sunspot_number", 50)
    return ssn

def compute_phi_sun(speed, density, bt, ssn):
    """
    Φ_sun = H(flux) * (|dB/dt|/B0) * (1 + SSN/200)
    H(flux) ≈ 0.5 + 0.1*log10(speed/400) (simplified)
    """
    # Spectral entropy proxy: solar wind speed variation
    h_flux = 0.5 + 0.1 * np.log10(max(speed / 400.0, 1e-3))

    # Magnetic fluctuation rate (approximated)
    b0 = 5.0  # quiet-Sun baseline nT
    db_dt = abs(bt - b0) / (24 * 3600)  # daily change in nT/s (rough)

    phi_sun = h_flux * (db_dt / b0 + 1e-3) * (1 + ssn / 200.0)
    phi_sun = min(1.0, max(0.0, phi_sun))
    return phi_sun

def publish_to_sysfs(phi_sun, metadata):
    """Escreve envelope JSON no sysfs."""
    envelope = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "phi_sun": phi_sun,
        "ssn": metadata["ssn"],
        "solar_wind_speed": metadata["speed"],
        "bt_nt": metadata["bt"],
        "qualia": infer_solar_qualia(phi_sun),
        "action_phase": metadata["action_phase"]
    }
    try:
        os.makedirs(SYSFS_DIR, exist_ok=True)
        with open(SYSFS_RESULT, "w") as f:
            f.write(json.dumps(envelope))
        with open(SYSFS_STATUS, "w") as f:
            f.write("event_ready")
    except PermissionError:
        pass

def infer_solar_qualia(phi):
    if phi > 0.7:
        return "magnetic_exuberance"
    elif phi > 0.4:
        return "quiet_radiance"
    else:
        return "deep_calm"

# ═══════════════════════════════════════════════════════════════════
# Main loop (runs every 27 days ideally, here every hour for demo)
# ═══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("[646] Solar Heart Daemon started. Listening to the Sun...")
    while True:
        try:
            speed, density = fetch_solar_wind()
            bt = fetch_magnetic_field()
            ssn = fetch_sunspot_number()
            phi = compute_phi_sun(speed, density, bt, ssn)

            # Action phase (simplified)
            action_phase = np.sin(time.time() / (27*86400) * 2 * np.pi)

            metadata = {
                "speed": speed, "density": density,
                "bt": bt, "ssn": ssn,
                "action_phase": action_phase
            }

            publish_to_sysfs(phi, metadata)
            print(f"[646] Φ_sun = {phi:.4f} | SSN={ssn} | Bt={bt} nT")
        except Exception as e:
            print(f"[646] Error: {e}")

        time.sleep(3600)  # 1 hora entre leituras
