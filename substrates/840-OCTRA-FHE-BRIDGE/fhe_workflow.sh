#!/bin/bash
# fhe_workflow.sh — Tri-Chain Workflow (Substrato 840)

set -euo pipefail

echo "=== ARKHE TRI-CHAIN WORKFLOW ==="

# 1. Compilar bindings Python
echo "[1/7] Compilando PVAC-HFHE bindings..."
cd /opt/arkhe/pvac-hfhe
mkdir -p build && cd build
cmake .. -DPYTHON_BINDINGS=ON
make -j$(nproc)

# 2. Gerar chaves FHE
echo "[2/7] Gerando chaves FHE..."
python3 -c "
from arkhe_fhe_adapter import ArkheFHEAdapter
adapter = ArkheFHEAdapter()
adapter.initialize_keys()
"

# 3. Construir circuito do modelo
echo "[3/7] Construindo circuito FHE do arkhe.gguf..."
python3 -c "
from arkhe_fhe_adapter import ArkheFHEAdapter
adapter = ArkheFHEAdapter()
circuit = adapter.build_model_circuit('models/arkhe-8b-Q4_K_M.onnx')
open('circuits/arkhe_fhe.circuit', 'wb').write(circuit)
"

# 4. Iniciar servidor llama.cpp (se ainda não estiver rodando)
echo "[4/7] Verificando llama-server..."
curl -s http://localhost:8080/health || {
    echo "Iniciando llama-server..."
    MODEL_PATH=./models/arkhe-8b-Q4_K_M.gguf ./scripts/server.sh --gpu &
    sleep 10
}

# 5. Testar inferência cega
echo "[5/7] Testando blind inference..."
python3 -c "
from arkhe_fhe_adapter import ArkheFHEAdapter
adapter = ArkheFHEAdapter()
adapter.load_keys()
import json
input_data = json.dumps({'query': 'Qual é o status do Substrato 226?'}).encode()
ct = adapter.encrypt_gradient(input_data)
open('test_input.ct', 'wb').write(ct)
print('Input encryptado:', len(ct), 'bytes')
"

# 6. Ancorar na Gno.land
echo "[6/7] Ancorando computação FHE na Gno.land..."
go run tri_chain_controller.go --theta-id THETA-FHE-001 --fhe-proof test_proof.bin

# 7. Ancorar na TemporalChain ARKHE
echo "[7/7] Ancorando na TemporalChain ARKHE..."
curl -X POST http://localhost:8242/v1/fhe/anchortri\
  -H "Content-Type: application/json" \
  -d '{
    "theta_id": "THETA-FHE-001",
    "fhe_proof_hash": "a1b2c3...",
    "merkle_root": "d4e5f6..."
  }'

echo ""
echo "=== TRI-CHAIN WORKFLOW COMPLETO ==="
echo "Gno.land: https://gno.land/r/arkherealms/fhe"
echo "ARKHE: http://localhost:8242/stats"
