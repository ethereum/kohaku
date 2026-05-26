#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════╗
║     BRIDGE API — Glosa 245 Anchor Service (Substrato 870-B)     ║
║     FastAPI server para publicação e verificação on‑chain        ║
╚══════════════════════════════════════════════════════════════════╝
"""
import hashlib
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from web3 import Web3
from web3.middleware import geth_poa_middleware
import json
import yaml

# Configurações
RPC_URL = os.getenv("RPC_URL", "https://ethereum-rpc.publicnode.com")
PRIVATE_KEY = os.getenv("PRIVATE_KEY", "0x0000000000000000000000000000000000000000000000000000000000000000")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "0x0000000000000000000000000000000000000000")
# ABI do contrato Glosa245Anchor (simplificada)
CONTRACT_ABI = [
    {
        "inputs": [{"internalType": "string", "name": "sequence", "type": "string"},
                   {"internalType": "bytes32", "name": "expectedHash", "type": "bytes32"}],
        "name": "anchorSequence",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "bytes32", "name": "providedHash", "type": "bytes32"}],
        "name": "verifyHash",
        "outputs": [{"internalType": "bool", "name": "valid", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "canonicalSequenceHash",
        "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
        "stateMutability": "view",
        "type": "function"
    }
]

app = FastAPI(title="Arkhe Glosa 245 Bridge", version="1.0.0")

# Modelos de dados
class PublishRequest(BaseModel):
    sequence: str = Field(..., example="110000010010100011001111101101011100")
    metadata: dict = Field(default={}, description="Metadados adicionais (opcional)")

class PublishReceipt(BaseModel):
    status: str
    tx_hash: str
    sequence_hash: str
    sequence: str
    block_number: int | None = None
    metadata: dict = {}

class VerifyResponse(BaseModel):
    anchored: bool
    hash: str

# Inicialização Web3
w3 = Web3(Web3.HTTPProvider(RPC_URL))
if "poa" in RPC_URL or "publicnode" in RPC_URL:
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)
account = w3.eth.account.from_key(PRIVATE_KEY)
contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=CONTRACT_ABI)

def compute_keccak256(text: str) -> str:
    return Web3.keccak(text=text).hex()

@app.post("/publish", response_model=PublishReceipt)
async def publish_sequence(req: PublishRequest):
    """Publica a sequência no contrato Glosa245Anchor e retorna o receipt."""
    try:
        expected_hash = compute_keccak256(req.sequence)
        # Verifica se já foi ancorada (off-chain rápido)
        if contract.functions.canonicalSequenceHash().call() != b'\x00' * 32:
            raise HTTPException(status_code=400, detail="Sequência já ancorada anteriormente.")
        # Construção da transação
        txn = contract.functions.anchorSequence(
            req.sequence,
            expected_hash
        ).build_transaction({
            'from': account.address,
            'nonce': w3.eth.get_transaction_count(account.address),
            'gas': 200000,
            'gasPrice': w3.eth.gas_price,
        })
        signed_tx = account.sign_transaction(txn)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        return PublishReceipt(
            status="ANCHORED",
            tx_hash=tx_hash.hex(),
            sequence_hash=expected_hash,
            sequence=req.sequence,
            block_number=receipt['blockNumber'],
            metadata=req.metadata
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/verify/{hash}", response_model=VerifyResponse)
async def verify_hash(hash: str):
    """Verifica se o hash fornecido corresponde ao selo canônico on‑chain."""
    try:
        # Normaliza para bytes32
        if not hash.startswith("0x"):
            hash = "0x" + hash
        is_valid = contract.functions.verifyHash(hash).call()
        return VerifyResponse(anchored=is_valid, hash=hash)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "ok", "contract": CONTRACT_ADDRESS}