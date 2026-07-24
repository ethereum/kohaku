#!/usr/bin/env python3
import pytest
import tempfile
import os
import yaml
from cohesion_engine import CohesionEngine

SAMPLE_REGISTRY = {
    "825": {"name": "PME", "category": "cognition", "links": ["826"]},
    "826": {"name": "DIT", "category": "cognition", "links": ["825"]},
    "853": {"name": "SAP", "category": "enterprise", "links": []},
    "859": {"name": "BioComp", "category": "hardware", "links": []},
    "863": {"name": "SecOps", "category": "security", "links": []},
}

@pytest.fixture
def registry_file(tmp_path):
    """Cria um arquivo YAML temporário com o registro de exemplo."""
    file_path = tmp_path / "substrate_registry.yaml"
    with open(file_path, 'w', encoding='utf-8') as f:
        yaml.dump(SAMPLE_REGISTRY, f)
    return str(file_path)

def test_load_registry(registry_file):
    engine = CohesionEngine(registry_file)
    assert len(engine.substrates) == 5
    assert engine.substrates["825"]["name"] == "PME"

def test_detect_gaps(registry_file):
    engine = CohesionEngine(registry_file)
    gaps = engine.detect_gaps()
    assert len(gaps) > 0

def test_generate_decrees(registry_file):
    engine = CohesionEngine(registry_file)
    engine.detect_gaps()
    decrees = engine.generate_integration_decrees()
    assert len(decrees) == len(engine.gaps)
    for dec in decrees:
        assert dec.startswith("<|ARKHE_START|>")
        assert "<|SUBSTRATE|>" in dec
        assert "<|SEAL|>" in dec

def test_coherence_impact(registry_file):
    engine = CohesionEngine(registry_file)
    engine.detect_gaps()
    new_phi = engine.calculate_coherence_impact()
    assert new_phi > 0.875

def test_final_decree(registry_file):
    engine = CohesionEngine(registry_file)
    engine.detect_gaps()
    decree = engine.emit_final_decree()
    assert "DECRETO DE CANONIZAÇÃO" in decree
    assert "865" in decree