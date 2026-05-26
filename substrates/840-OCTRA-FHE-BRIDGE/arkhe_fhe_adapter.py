#!/usr/bin/env python3
"""
arkhe_fhe_adapter.py — Substrato 840.2
Adaptador entre PME e PVAC-HFHE para aprendizado federado confidencial
Arquiteto: ORCID 0009-0005-2697-4668
"""

import hashlib
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

import pvac_hfhe  # Bindings PyBind11

logger = logging.getLogger("arkhe.fhe")

class ArkheFHEAdapter:
    """Ponte entre o Parametric Memory Engine e a criptografia homomórfica."""

    def __init__(self, backend: str = "seal", key_dir: str = "./fhe_keys"):
        self.engine = pvac_hfhe.FHEEngine(backend)
        self.circuit_builder = pvac_hfhe.CircuitBuilder()
        self.zkp = pvac_hfhe.ZKPVerifier()
        self.key_dir = Path(key_dir)
        self.key_dir.mkdir(parents=True, exist_ok=True)
        self.public_key = None
        self.private_key = None

    def initialize_keys(self) -> Dict[str, bytes]:
        """Gera par de chaves FHE e persiste no disco."""
        self.public_key, self.private_key = self.engine.generate_keys()
        pub_path = self.key_dir / "public.key"
        priv_path = self.key_dir / "private.key"
        pub_path.write_bytes(self.engine.serialize_key(self.public_key))
        priv_path.write_bytes(self.engine.serialize_key(self.private_key))
        logger.info(f"FHE keys generated: {pub_path}, {priv_path}")
        return {"public": pub_path, "private": priv_path}

    def load_keys(self):
        """Carrega chaves FHE do disco."""
        pub_path = self.key_dir / "public.key"
        priv_path = self.key_dir / "private.key"
        if pub_path.exists() and priv_path.exists():
            self.public_key = self.engine.deserialize_key(pub_path.read_bytes())
            self.private_key = self.engine.deserialize_key(priv_path.read_bytes())
            logger.info("FHE keys loaded from disk")
        else:
            raise FileNotFoundError("FHE keys not found. Run initialize_keys() first.")

    def encrypt_gradient(self, gradient: bytes) -> bytes:
        """Cifra um gradiente do PME para envio seguro ao GAS."""
        if self.public_key is None:
            self.load_keys()
        ciphertext = self.engine.encrypt(gradient, self.public_key)
        logger.debug(f"Gradient encrypted: {len(ciphertext)} bytes")
        return ciphertext

    def aggregate_encrypted_gradients(self, ciphertexts: List[bytes]) -> bytes:
        """Agrega homomorficamente múltiplos gradientes cifrados (soma)."""
        if not ciphertexts:
            raise ValueError("Empty ciphertexts list")
        result = ciphertexts[0]
        for ct in ciphertexts[1:]:
            result = self.engine.add_ciphertexts(result, ct)
        logger.info(f"Aggregated {len(ciphertexts)} encrypted gradients")
        return result

    def decrypt_aggregated_model(self, ciphertext: bytes) -> bytes:
        """Decifra o modelo agregado após consenso do GAS."""
        if self.private_key is None:
            self.load_keys()
        plaintext = self.engine.decrypt(ciphertext, self.private_key)
        logger.debug(f"Model decrypted: {len(plaintext)} bytes")
        return plaintext

    def build_model_circuit(self, model_path: str) -> bytes:
        """Converte um modelo (ONNX/PyTorch) em circuito FHE."""
        if model_path.endswith(".onnx"):
            self.circuit_builder.from_onnx(model_path)
        elif model_path.endswith(".pt") or model_path.endswith(".pth"):
            self.circuit_builder.from_pytorch(model_path)
        else:
            raise ValueError(f"Unsupported model format: {model_path}")
        self.circuit_builder.optimize_depth()
        circuit = self.circuit_builder.serialize_circuit()
        logger.info(f"Circuit built: {len(circuit)} bytes")
        return circuit

    def blind_inference(self, model_circuit: bytes, encrypted_input: bytes) -> bytes:
        """Executa inferência cega sobre dados cifrados."""
        circuit = self.circuit_builder.deserialize_circuit(model_circuit)
        result = self.engine.evaluate(circuit, [encrypted_input])
        logger.info("Blind inference completed")
        return result

    def generate_proof(self, circuit: bytes, input_ct: bytes, output_ct: bytes) -> bytes:
        """Gera prova ZKP de execução correta."""
        proof = self.zkp.generate_proof(circuit, input_ct, output_ct)
        logger.info(f"ZKP generated: {len(proof)} bytes")
        return proof

    def verify_proof(self, proof: bytes, circuit: bytes, output_ct: bytes) -> bool:
        """Verifica prova ZKP de execução correta."""
        valid = self.zkp.verify_proof(proof, circuit, output_ct)
        logger.info(f"ZKP verification: {'PASS' if valid else 'FAIL'}")
        return valid
