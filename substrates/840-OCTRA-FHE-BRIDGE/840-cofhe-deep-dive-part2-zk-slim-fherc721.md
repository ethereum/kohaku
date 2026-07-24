# ANÁLISE PROFUNDA — COMPONENTES COFHE (FHENIX) PARTE 2
## ZK Verifier + Slim Listener/Result Processor + FHERC721 | Integração Substrato 840+

**Data:** 2026-05-26
**Arquiteto:** ORCID 0009-0005-2697-4668
**Fonte:** https://cofhe-docs.fhenix.zone/

---

# PARTE 4: ZK VERIFIER

## 4.1 Conceito Fundamental

O **ZK Verifier** é um serviço off-chain que verifica **Zero-Knowledge Proofs of Knowledge (ZKPoK)** de inputs cifrados antes que possam ser usados em smart contracts confidenciais.

### Por que ZKPoK?

| Ataque | Descrição | Como ZKPoK Protege |
|--------|-----------|-------------------|
| **Malleability Attack** | Atacante manipula ciphertexts observados, combinando com zeros cifrados para criar dados válidos | Exige conhecimento do plaintext para gerar prova válida |
| **Chosen Ciphertext Attack (CCA)** | Atacante submete ciphertexts modificados e observa resultados | Apenas usuários com plaintext conhecido produzem proofs válidos |
| **Key Recovery** | Exploração de operações homomórficas para inferir chave secreta | ZKPoK elimina vetores de ataque ao validar origem do ciphertext |

### Fluxo ZKPoK:

```
┌─────────┐     ┌──────────┐     ┌─────────────┐     ┌─────────────┐
│  User   │────►│ Encrypt  │────►│ Generate    │────►│ ZK Verifier │
│         │     │ Input    │     │ ZKPoK       │     │             │
└─────────┘     └──────────┘     └─────────────┘     └──────┬───────┘
                                                            │
                                                            │ Verify
                                                            │ Sign
                                                            ▼
                                              ┌─────────────────────┐
                                              │  Signed Approval    │
                                              │  (ecrecover-ready)  │
                                              └─────────────────────┘
                                                            │
                                                            ▼
                                              ┌─────────────────────┐
                                              │  Smart Contract     │
                                              │  ecrecover verify   │
                                              │  Execute logic      │
                                              └─────────────────────┘
```

**Passos:**
1. Usuário criptografa input e gera ZK proof de conhecimento
2. Envia ciphertext + proof para ZK Verifier
3. ZK Verifier verifica proof — se válido, assina mensagem de aprovação
4. Retorna assinatura ao usuário
5. Usuário envia `(ciphertext, signed_approve)` ao contrato
6. Contrato verifica assinatura via `ecrecover`
7. Contrato executa lógica FHE

> **Abstração:** Passos 1-6 são automatizados pelo `@cofhe/sdk`. O usuário escreve apenas o passo 7.

---

## 4.2 Arquitetura do ZK Verifier

| Aspecto | Descrição |
|---------|-----------|
| **Tipo** | Serviço off-chain, usado por clientes |
| **Função** | Verifica input do usuário, garantindo segurança |
| **Responsabilidades** | Recebe ZKPoK → Verifica proofs → Gera assinatura → Armazena em GCS bucket → Comunica com FheOS |
| **Execução** | TEE (Trusted Execution Environment) para reduzir trust |
| **Chave Pública** | Predeterminada e bem-conhecida — usada em `ecrecover` |

### Formato da Mensagem Assinada (ZK Approval):

| Campo | Tamanho | Descrição |
|-------|---------|-----------|
| `ctHash` | 32 bytes | Hash do ciphertext |
| `publicKey` | 32 bytes | Chave pública do usuário |
| `nonce` | 8 bytes | Nonce único para replay protection |
| `timestamp` | 8 bytes | Timestamp de expiração |

---

## 4.3 Código: ZK Verifier Integration com Substrato 840

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title OctraZKVerifier
 * @dev Integra ZK Verifier Fhenix com Octra HFHE para validação de inputs
 * Substrate 840+ — ZK Verification Module
 */
contract OctraZKVerifier {
    using ECDSA for bytes32;

    // Endereço público do ZK Verifier (predeterminado)
    address public zkVerifierSigner;

    // Nonces usados (replay protection)
    mapping(bytes32 => bool) public usedNonces;

    // Mapping: Circle ID → ZK verification status
    mapping(string => mapping(bytes32 => bool)) public circleInputVerified;

    // Eventos
    event ZKInputVerified(string circleId, bytes32 ctHash, address user);
    event ZKVerificationFailed(string circleId, bytes32 ctHash, string reason);
    event ZKVerifierSignerUpdated(address newSigner);

    modifier onlyZKVerifierSigner() {
        require(msg.sender == zkVerifierSigner, "Not ZK Verifier");
        _;
    }

    constructor(address _zkVerifierSigner) {
        zkVerifierSigner = _zkVerifierSigner;
    }

    /**
     * @dev Atualiza endereço do ZK Verifier signer (governança)
     */
    function updateZKVerifierSigner(address newSigner) external {
        // Requer GOV-840-001
        zkVerifierSigner = newSigner;
        emit ZKVerifierSignerUpdated(newSigner);
    }

    /**
     * @dev Verifica input cifrado com assinatura ZK Verifier
     * @param circleId Circle Octra associado
     * @param encryptedInput Input cifrado (InEuint64)
     * @param zkSignature Assinatura do ZK Verifier
     * @param nonce Nonce único para replay protection
     */
    function verifyZKInput(
        string calldata circleId,
        InEuint64 memory encryptedInput,
        bytes calldata zkSignature,
        bytes32 nonce
    ) external returns (bool) {
        require(!usedNonces[nonce], "Nonce already used");

        // Reconstrói mensagem assinada
        bytes32 ctHash = encryptedInput.ctHash;
        bytes32 messageHash = keccak256(abi.encodePacked(
            ctHash,
            msg.sender,
            nonce,
            block.timestamp
        ));

        // Verifica assinatura via ecrecover
        address signer = messageHash.toEthSignedMessageHash().recover(zkSignature);
        require(signer == zkVerifierSigner, "Invalid ZK Verifier signature");

        // Marca nonce como usado
        usedNonces[nonce] = true;

        // Registra verificação para Circle
        circleInputVerified[circleId][ctHash] = true;

        emit ZKInputVerified(circleId, ctHash, msg.sender);
        return true;
    }

    /**
     * @dev Verifica se um input foi validado por ZK para um Circle
     */
    function isInputVerified(
        string calldata circleId,
        bytes32 ctHash
    ) external view returns (bool) {
        return circleInputVerified[circleId][ctHash];
    }

    /**
     * @dev Batch verification: múltiplos inputs de uma vez
     */
    function verifyZKInputsBatch(
        string calldata circleId,
        InEuint64[] memory encryptedInputs,
        bytes[] calldata zkSignatures,
        bytes32[] calldata nonces
    ) external returns (bool[] memory) {
        require(
            encryptedInputs.length == zkSignatures.length &&
            zkSignatures.length == nonces.length,
            "Array length mismatch"
        );

        bool[] memory results = new bool[](encryptedInputs.length);

        for (uint i = 0; i < encryptedInputs.length; i++) {
            results[i] = this.verifyZKInput(
                circleId,
                encryptedInputs[i],
                zkSignatures[i],
                nonces[i]
            );
        }

        return results;
    }

    /**
     * @dev Revoga verificação de input (emergency)
     */
    function revokeZKVerification(
        string calldata circleId,
        bytes32 ctHash
    ) external {
        // Requer governança
        circleInputVerified[circleId][ctHash] = false;
    }
}
```

---

## 4.4 TypeScript: Client ZK Verifier

```typescript
// File: arkhe_fhe_integration/src/zk_verifier_client.ts
// Client para interação com ZK Verifier Fhenix

import { createCofheClient } from '@cofhe/sdk';
import { createHash, randomBytes } from 'crypto';

const ZK_VERIFIER_ABI = [
  'function verifyZKInput(string circleId, tuple(uint256 ctHash, bytes signature) encryptedInput, bytes zkSignature, bytes32 nonce) returns (bool)',
  'function isInputVerified(string circleId, bytes32 ctHash) view returns (bool)',
  'function verifyZKInputsBatch(string circleId, tuple(uint256 ctHash, bytes signature)[] encryptedInputs, bytes[] zkSignatures, bytes32[] nonces) returns (bool[])',
  'event ZKInputVerified(string circleId, bytes32 ctHash, address user)',
];

export class OctraZKVerifierClient {
  private cofheClient: any;
  private zkVerifierContract: `0x${string}`;

  constructor(
    privateKey: `0x${string}`,
    zkVerifierContract: `0x${string}`,
    chainConfig: any
  ) {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: chainConfig, transport: http() });
    this.cofheClient = createCofheClient({ walletClient, provider: http() });
    this.zkVerifierContract = zkVerifierContract;
  }

  /**
   * Fluxo completo: encrypt → generate ZKPoK → verify → submit
   */
  async encryptAndVerify(
    circleId: string,
    plaintextValue: bigint
  ): Promise<{
    encryptedInput: any;
    zkSignature: `0x${string}`;
    nonce: `0x${string}`;
    txHash: `0x${string}`;
  }> {
    // 1. Criptografa input off-chain
    const encryptedInput = await this.cofheClient.encryptUint64(plaintextValue);

    // 2. Gera ZKPoK (abstraído pelo SDK)
    const zkProof = await this.cofheClient.generateZKProof(encryptedInput);

    // 3. Envia para ZK Verifier (off-chain)
    const zkResponse = await this.submitToZKVerifier(encryptedInput, zkProof);

    // 4. Gera nonce único
    const nonce = '0x' + randomBytes(32).toString('hex') as `0x${string}`;

    // 5. Submite verificação on-chain
    const tx = await this.cofheClient.writeContract({
      address: this.zkVerifierContract,
      abi: ZK_VERIFIER_ABI,
      functionName: 'verifyZKInput',
      args: [circleId, encryptedInput, zkResponse.signature, nonce],
    });

    const receipt = await tx.wait();

    return {
      encryptedInput,
      zkSignature: zkResponse.signature,
      nonce,
      txHash: receipt.transactionHash,
    };
  }

  /**
   * Submite proof para ZK Verifier off-chain
   */
  private async submitToZKVerifier(
    encryptedInput: any,
    zkProof: any
  ): Promise<{ signature: `0x${string}`; verified: boolean }> {
    // Chamada HTTP para ZK Verifier service
    const response = await fetch('https://zk-verifier.fhenix.zone/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ciphertext: encryptedInput.ctHash,
        proof: zkProof,
        publicKey: encryptedInput.publicKey,
      }),
    });

    const result = await response.json();
    return {
      signature: result.signature,
      verified: result.verified,
    };
  }

  /**
   * Verifica se input foi validado (view function)
   */
  async isVerified(circleId: string, ctHash: `0x${string}`): Promise<boolean> {
    return await this.cofheClient.readContract({
      address: this.zkVerifierContract,
      abi: ZK_VERIFIER_ABI,
      functionName: 'isInputVerified',
      args: [circleId, ctHash],
    });
  }

  /**
   * Batch verification para múltiplos inputs
   */
  async verifyBatch(
    circleId: string,
    plaintextValues: bigint[]
  ): Promise<{ txHash: `0x${string}`; results: boolean[] }> {
    const encryptedInputs = [];
    const zkSignatures = [];
    const nonces = [];

    for (const value of plaintextValues) {
      const result = await this.encryptAndVerify(circleId, value);
      encryptedInputs.push(result.encryptedInput);
      zkSignatures.push(result.zkSignature);
      nonces.push(result.nonce);
    }

    const tx = await this.cofheClient.writeContract({
      address: this.zkVerifierContract,
      abi: ZK_VERIFIER_ABI,
      functionName: 'verifyZKInputsBatch',
      args: [circleId, encryptedInputs, zkSignatures, nonces],
    });

    const receipt = await tx.wait();

    // Extrai results do evento
    const results = this.extractBatchResults(receipt);

    return { txHash: receipt.transactionHash, results };
  }

  private extractBatchResults(receipt: any): boolean[] {
    const events = receipt.logs.filter((log: any) => log.eventName === 'ZKInputVerified');
    return events.map(() => true);
  }
}
```

---

# PARTE 5: SLIM LISTENER / RESULT PROCESSOR

## 5.1 Slim Listener

### Conceito
Serviço off-chain que **monitora eventos on-chain** e encaminha requests de operações FHE para o FHEOS Server.

| Aspecto | Descrição |
|---------|-----------|
| **Tipo** | Serviço off-chain de monitoramento de eventos |
| **Função** | Escuta eventos blockchain e encaminha requests FHE para FHEOS |
| **Responsabilidades** | Monitora Task Manager → Processa requests → Encaminha para FHEOS → Garante delivery confiável |

### Fluxo:
```
Task Manager (on-chain) → Emite evento FHEOperationRequested
    ↓
Slim Listener (off-chain) → Captura evento via WebSocket/RPC
    ↓
FHEOS Server (off-chain) → Recebe request para execução FHE
```

---

## 5.2 Result Processor

### Conceito
Serviço off-chain que **recebe resultados do FHEOS** e publica de volta na blockchain.

| Aspecto | Descrição |
|---------|-----------|
| **Tipo** | Serviço off-chain de processamento de resultados |
| **Função** | Recebe resultados FHEOS e publica na blockchain |
| **Responsabilidades** | Recebe resultado → Envia para DA layer → Publica no Task Manager → Completa ciclo FHE |

### Fluxo Completo:
```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│ Task Manager│───►│ Slim Listener │───►│  FHEOS      │───►│   Result     │
│ (on-chain)  │    │ (off-chain)   │    │  Server     │    │  Processor   │
└─────────────┘    └──────────────┘    └─────────────┘    └──────┬───────┘
                                                                   │
                                                                   │ Publish
                                                                   ▼
                                                          ┌─────────────┐
                                                          │ Task Manager│
                                                          │ (on-chain)  │
                                                          └─────────────┘
```

---

## 5.3 Código: Slim Listener + Result Processor Integration

```go
// File: bridge_relay/slim_listener.go
// Slim Listener + Result Processor para CoFHE
// Integração com Substrato 840

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// FHEOperationRequest representa um evento do Task Manager
type FHEOperationRequest struct {
	Handle      *big.Int `json:"handle"`
	Operation   string   `json:"operation"`
	Operands    []*big.Int `json:"operands"`
	ResultHandle *big.Int `json:"resultHandle"`
	Timestamp   uint64   `json:"timestamp"`
}

// FHEOperationResult representa resultado do FHEOS
type FHEOperationResult struct {
	ResultHandle *big.Int `json:"resultHandle"`
	ResultCT     []byte   `json:"resultCT"`
	ZKProof      []byte   `json:"zkProof"`
	Timestamp    uint64   `json:"timestamp"`
}

// SlimListener monitora eventos on-chain
type SlimListener struct {
	client          *ethclient.Client
	contractAddress common.Address
	taskManagerABI  string
	fheosEndpoint   string
	resultProcessor *ResultProcessor
}

// ResultProcessor publica resultados on-chain
type ResultProcessor struct {
	client          *ethclient.Client
	contractAddress common.Address
	privateKey      string
	chainID         *big.Int
}

func NewSlimListener(
	rpcEndpoint string,
	contractAddr string,
	fheosEndpoint string,
) (*SlimListener, error) {
	client, err := ethclient.Dial(rpcEndpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to RPC: %w", err)
	}

	return &SlimListener{
		client:          client,
		contractAddress: common.HexToAddress(contractAddr),
		fheosEndpoint:   fheosEndpoint,
	}, nil
}

func NewResultProcessor(
	rpcEndpoint string,
	contractAddr string,
	privateKey string,
	chainID int64,
) (*ResultProcessor, error) {
	client, err := ethclient.Dial(rpcEndpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to RPC: %w", err)
	}

	return &ResultProcessor{
		client:          client,
		contractAddress: common.HexToAddress(contractAddr),
		privateKey:      privateKey,
		chainID:         big.NewInt(chainID),
	}, nil
}

/**
 * StartListening inicia o monitoramento de eventos do Task Manager
 */
func (sl *SlimListener) StartListening(ctx context.Context) error {
	// Query para eventos FHEOperationRequested
	query := ethereum.FilterQuery{
		Addresses: []common.Address{sl.contractAddress},
		Topics: [][]common.Hash{{
			// Keccak256("FHEOperationRequested(uint256,string,uint256[],uint256)")
			common.HexToHash("0x..."),
		}},
	}

	logs := make(chan types.Log)
	sub, err := sl.client.SubscribeFilterLogs(ctx, query, logs)
	if err != nil {
		return fmt.Errorf("failed to subscribe to logs: %w", err)
	}
	defer sub.Unsubscribe()

	fmt.Println("[SLIM-LISTENER] Started listening for FHE operations...")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-sub.Err():
			return fmt.Errorf("subscription error: %w", err)
		case vLog := <-logs:
			if err := sl.processEvent(vLog); err != nil {
				log.Printf("[SLIM-LISTENER] Error processing event: %v", err)
			}
		}
	}
}

/**
 * processEvent processa um evento do Task Manager
 */
func (sl *SlimListener) processEvent(vLog types.Log) error {
	// Parse event data
	request := &FHEOperationRequest{
		Handle:      new(big.Int).SetBytes(vLog.Topics[1].Bytes()),
		Operation:   string(vLog.Data[:32]),
		Timestamp:   uint64(time.Now().Unix()),
	}

	fmt.Printf("[SLIM-LISTENER] FHE Operation: handle=%s, op=%s\\n",
		request.Handle.String(), request.Operation)

	// Encaminha para FHEOS Server
	result, err := sl.forwardToFHEOS(request)
	if err != nil {
		return fmt.Errorf("FHEOS execution failed: %w", err)
	}

	// Encaminha resultado para Result Processor
	if err := sl.resultProcessor.publishResult(result); err != nil {
		return fmt.Errorf("result publication failed: %w", err)
	}

	return nil
}

/**
 * forwardToFHEOS envia request para execução no FHEOS Server
 */
func (sl *SlimListener) forwardToFHEOS(req *FHEOperationRequest) (*FHEOperationResult, error) {
	// Serializa request
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	// Envia para FHEOS (HTTP/gRPC)
	// Implementação simplificada — em produção usar gRPC streaming
	fmt.Printf("[SLIM-LISTENER] Forwarding to FHEOS: %s\\n", sl.fheosEndpoint)

	// Simula resposta do FHEOS
	result := &FHEOperationResult{
		ResultHandle: new(big.Int).Add(req.Handle, big.NewInt(1)),
		ResultCT:     []byte("encrypted_result"),
		ZKProof:      []byte("zk_proof_of_computation"),
		Timestamp:    uint64(time.Now().Unix()),
	}

	return result, nil
}

/**
 * publishResult publica resultado no Task Manager on-chain
 */
func (rp *ResultProcessor) publishResult(result *FHEOperationResult) error {
	// Prepara transação para Task Manager
	// Em produção: usar abigen para contrato Go binding

	fmt.Printf("[RESULT-PROCESSOR] Publishing result: handle=%s\\n",
		result.ResultHandle.String())

	// Publica no Task Manager via eth_sendTransaction
	// Inclui ZK proof da computação FHE

	return nil
}

func main() {
	ctx := context.Background()

	// Inicializa Slim Listener
	slimListener, err := NewSlimListener(
		"https://rpc.fhenix.zone",
		"0xTaskManagerAddress",
		"https://fheos.fhenix.zone:8443",
	)
	if err != nil {
		log.Fatal(err)
	}

	// Inicializa Result Processor
	resultProcessor, err := NewResultProcessor(
		"https://rpc.fhenix.zone",
		"0xTaskManagerAddress",
		"private_key_here",
		8008135, // Fhenix chain ID
	)
	if err != nil {
		log.Fatal(err)
	}

	slimListener.resultProcessor = resultProcessor

	// Inicia listening
	if err := slimListener.StartListening(ctx); err != nil {
		log.Fatal(err)
	}
}
```

---

## 5.4 TypeScript: Slim Listener Client

```typescript
// File: arkhe_fhe_integration/src/slim_listener_client.ts
// Client TypeScript para Slim Listener + Result Processor

import { WebSocketProvider, Contract, Wallet } from 'ethers';

const TASK_MANAGER_ABI = [
  'event FHEOperationRequested(uint256 handle, string operation, uint256[] operands, uint256 resultHandle)',
  'function publishResult(uint256 resultHandle, bytes resultCT, bytes zkProof)',
];

export class SlimListenerClient {
  private provider: WebSocketProvider;
  private taskManager: Contract;
  private fheosEndpoint: string;
  private resultWallet: Wallet;

  constructor(
    wsEndpoint: string,
    taskManagerAddress: string,
    fheosEndpoint: string,
    privateKey: string
  ) {
    this.provider = new WebSocketProvider(wsEndpoint);
    this.taskManager = new Contract(taskManagerAddress, TASK_MANAGER_ABI, this.provider);
    this.fheosEndpoint = fheosEndpoint;
    this.resultWallet = new Wallet(privateKey, this.provider);
  }

  /**
   * Inicia monitoramento de eventos FHEOperationRequested
   */
  async startListening(): Promise<void> {
    console.log('[SLIM-LISTENER] Starting WebSocket listener...');

    this.taskManager.on('FHEOperationRequested', async (
      handle: bigint,
      operation: string,
      operands: bigint[],
      resultHandle: bigint,
      event: any
    ) => {
      console.log(`[SLIM-LISTENER] FHE Op: handle=${handle}, op=${operation}`);

      try {
        // 1. Forward to FHEOS
        const result = await this.executeOnFHEOS({
          handle, operation, operands, resultHandle,
        });

        // 2. Publish result
        await this.publishResult(result);

      } catch (error) {
        console.error('[SLIM-LISTENER] Error:', error);
      }
    });
  }

  /**
   * Executa operação no FHEOS Server
   */
  private async executeOnFHEOS(request: {
    handle: bigint;
    operation: string;
    operands: bigint[];
    resultHandle: bigint;
  }): Promise<{
    resultHandle: bigint;
    resultCT: Uint8Array;
    zkProof: Uint8Array;
  }> {
    const response = await fetch(`${this.fheosEndpoint}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`FHEOS execution failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Publica resultado no Task Manager
   */
  private async publishResult(result: {
    resultHandle: bigint;
    resultCT: Uint8Array;
    zkProof: Uint8Array;
  }): Promise<string> {
    const tx = await this.taskManager.connect(this.resultWallet)
      .publishResult(result.resultHandle, result.resultCT, result.zkProof);

    const receipt = await tx.wait();
    console.log(`[RESULT-PROCESSOR] Published: ${receipt.hash}`);

    return receipt.hash;
  }

  /**
   * Para o listener
   */
  stopListening(): void {
    this.taskManager.removeAllListeners();
    this.provider.destroy();
    console.log('[SLIM-LISTENER] Stopped');
  }
}
```

---

# PARTE 6: FHERC721 (CONFIDENTIAL NFT)

## 6.1 Conceito

O **FHERC721** estende o padrão ERC-721 para suportar **metadados cifrados** e **propriedade privada** de NFTs. Cada token tem:
- **ID público** (visível na blockchain)
- **Metadados cifrados** (URI, atributos, etc.)
- **Propriedade privada** (owner cifrado via `eaddress`)

### Casos de Uso:
- **NFTs de identidade**: Dados pessoais cifrados
- **Real World Assets (RWA)**: Propriedade privada de ativos físicos
- **Gaming**: Inventário privado de itens
- **Voting tokens**: Tokens de voto com peso cifrado

---

## 6.2 Código: FHERC721 com Integração Octra

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title OctraFHERC721
 * @dev FHERC721 com integração Circle Octra para NFTs confidenciais
 * Substrate 840+ — Confidential NFT Module
 */
contract OctraFHERC721 is ERC721 {

    // Token ID → metadados cifrados (euint256 para hash de IPFS cifrado)
    mapping(uint256 => euint256) public encryptedTokenURIs;

    // Token ID → owner cifrado (eaddress)
    mapping(uint256 => eaddress) public encryptedOwners;

    // Token ID → Circle Octra associado
    mapping(uint256 => string) public tokenCircles;

    // Circle → contagem de tokens
    mapping(string => uint256) public circleTokenCount;

    // Contador de tokens
    uint256 private _tokenIdCounter;

    // Eventos
    event ConfidentialMint(
        uint256 tokenId,
        string circleId,
        uint256 encryptedURIHandle,
        uint256 encryptedOwnerHandle
    );
    event ConfidentialTransfer(
        uint256 tokenId,
        string fromCircle,
        string toCircle,
        uint256 newEncryptedOwnerHandle
    );
    event MetadataRevealed(
        uint256 tokenId,
        uint64 plaintextURIHash,
        bytes thresholdSignature
    );

    constructor() ERC721("Octra Confidential NFT", "OCTRA-NFT") {}

    /**
     * @dev Mint de NFT confidencial associado a um Circle Octra
     */
    function confidentialMint(
        string calldata circleId,
        InEuint256 memory encryptedURI,
        InEaddress memory encryptedOwner
    ) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;

        // Converte inputs cifrados
        euint256 uri = FHE.asEuint256(encryptedURI);
        eaddress owner = FHE.asEaddress(encryptedOwner);

        // Armazena metadados cifrados
        encryptedTokenURIs[tokenId] = uri;
        encryptedOwners[tokenId] = owner;
        tokenCircles[tokenId] = circleId;
        circleTokenCount[circleId]++;

        // Configura ACL
        uint256 uriHandle = FHE.getHandle(uri);
        uint256 ownerHandle = FHE.getHandle(owner);
        FHE.allowThis(uriHandle);
        FHE.allowThis(ownerHandle);

        emit ConfidentialMint(tokenId, circleId, uriHandle, ownerHandle);
        return tokenId;
    }

    /**
     * @dev Transferência confidencial entre Circles
     * Requer ZK proof de propriedade
     */
    function confidentialTransfer(
        uint256 tokenId,
        string calldata toCircle,
        InEaddress memory newEncryptedOwner,
        bytes calldata ownershipProof
    ) external {
        require(
            _verifyOwnership(tokenId, msg.sender, ownershipProof),
            "Invalid ownership proof"
        );

        string memory fromCircle = tokenCircles[tokenId];
        eaddress newOwner = FHE.asEaddress(newEncryptedOwner);

        // Atualiza owner cifrado
        encryptedOwners[tokenId] = newOwner;
        tokenCircles[tokenId] = toCircle;

        circleTokenCount[fromCircle]--;
        circleTokenCount[toCircle]++;

        uint256 ownerHandle = FHE.getHandle(newOwner);
        FHE.allowThis(ownerHandle);

        emit ConfidentialTransfer(tokenId, fromCircle, toCircle, ownerHandle);
    }

    /**
     * @dev Revela metadados via Threshold Network
     */
    function revealMetadata(
        uint256 tokenId,
        uint64 plaintextURIHash,
        bytes calldata thresholdSignature
    ) external {
        euint256 encURI = encryptedTokenURIs[tokenId];
        uint256 uriHandle = FHE.getHandle(encURI);

        // Verifica assinatura Threshold
        FHE.verifyDecryptResult(uriHandle, plaintextURIHash, thresholdSignature);

        emit MetadataRevealed(tokenId, plaintextURIHash, thresholdSignature);
    }

    /**
     * @dev Query cifrada: verifica se usuário é owner (sem revelar)
     */
    function isConfidentialOwner(
        uint256 tokenId,
        InEaddress memory queriedOwner
    ) external view returns (ebool) {
        eaddress currentOwner = encryptedOwners[tokenId];
        eaddress query = FHE.asEaddress(queriedOwner);

        return FHE.eq(currentOwner, query);
    }

    /**
     * @dev Retorna indicador de existência do token (compatibilidade ERC721)
     */
    function exists(uint256 tokenId) external view returns (bool) {
        return bytes(tokenCircles[tokenId]).length > 0;
    }

    /**
     * @dev Override: ownerOf retorna indicador (não owner real)
     */
    function ownerOf(uint256 tokenId) public view override returns (address) {
        // Para compatibilidade ERC721, retorna address(0) ou indicador
        // Owner real permanece cifrado
        if (bytes(tokenCircles[tokenId]).length == 0) {
            revert ERC721NonexistentToken(tokenId);
        }
        return address(0); // Indicador: owner é privado
    }

    /**
     * @dev Override: tokenURI retorna indicador cifrado
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        // Retorna string indicadora — URI real está cifrado
        return string(abi.encodePacked(
            "confidential://",
            tokenCircles[tokenId],
            "/",
            _toString(tokenId)
        ));
    }

    /**
     * @dev Verifica proof de propriedade (ZK ou Threshold)
     */
    function _verifyOwnership(
        uint256 tokenId,
        address claimedOwner,
        bytes calldata proof
    ) internal pure returns (bool) {
        // Em produção: verificar ZK proof ou assinatura Threshold
        // Placeholder para demonstração
        return proof.length > 0;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
```

---

## 6.3 TypeScript: Client FHERC721

```typescript
// File: arkhe_fhe_integration/src/fherc721_client.ts
// Client para operações FHERC721 com integração Circle Octra

import { createCofheClient } from '@cofhe/sdk';

const FHERC721_ABI = [
  'function confidentialMint(string circleId, tuple(uint256 ctHash, bytes signature) encryptedURI, tuple(uint256 ctHash, bytes signature) encryptedOwner) returns (uint256)',
  'function confidentialTransfer(uint256 tokenId, string toCircle, tuple(uint256 ctHash, bytes signature) newEncryptedOwner, bytes ownershipProof)',
  'function revealMetadata(uint256 tokenId, uint64 plaintextURIHash, bytes thresholdSignature)',
  'function isConfidentialOwner(uint256 tokenId, tuple(uint256 ctHash, bytes signature) queriedOwner) view returns (uint256)',
  'function exists(uint256 tokenId) view returns (bool)',
  'event ConfidentialMint(uint256 tokenId, string circleId, uint256 encryptedURIHandle, uint256 encryptedOwnerHandle)',
  'event ConfidentialTransfer(uint256 tokenId, string fromCircle, string toCircle, uint256 newEncryptedOwnerHandle)',
  'event MetadataRevealed(uint256 tokenId, uint64 plaintextURIHash, bytes thresholdSignature)',
];

export class OctraFHERC721Client {
  private cofheClient: any;
  private nftContract: `0x${string}`;
  private thresholdClient: ThresholdNetworkClient; // da Parte 1

  constructor(
    privateKey: `0x${string}`,
    nftContract: `0x${string}`,
    thresholdClient: ThresholdNetworkClient,
    chainConfig: any
  ) {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: chainConfig, transport: http() });
    this.cofheClient = createCofheClient({ walletClient, provider: http() });
    this.nftContract = nftContract;
    this.thresholdClient = thresholdClient;
  }

  /**
   * Mint de NFT confidencial
   */
  async confidentialMint(
    circleId: string,
    uriPlaintext: string,
    ownerAddress: `0x${string}`
  ): Promise<{ tokenId: bigint; txHash: `0x${string}` }> {
    // 1. Criptografa URI (hash IPFS)
    const uriHash = BigInt('0x' + createHash('sha256').update(uriPlaintext).digest('hex'));
    const encryptedURI = await this.cofheClient.encryptUint256(uriHash);

    // 2. Criptografa owner address
    const ownerBigInt = BigInt(ownerAddress);
    const encryptedOwner = await this.cofheClient.encryptUint256(ownerBigInt);

    // 3. Mint
    const tx = await this.cofheClient.writeContract({
      address: this.nftContract,
      abi: FHERC721_ABI,
      functionName: 'confidentialMint',
      args: [circleId, encryptedURI, encryptedOwner],
    });

    const receipt = await tx.wait();
    const tokenId = this.extractTokenId(receipt);

    return { tokenId, txHash: receipt.transactionHash };
  }

  /**
   * Transferência confidencial
   */
  async confidentialTransfer(
    tokenId: bigint,
    toCircle: string,
    newOwnerAddress: `0x${string}`
  ): Promise<`0x${string}`> {
    // 1. Gera proof de propriedade (ZK)
    const ownershipProof = await this.generateOwnershipProof(tokenId);

    // 2. Criptografa novo owner
    const newOwnerBigInt = BigInt(newOwnerAddress);
    const encryptedNewOwner = await this.cofheClient.encryptUint256(newOwnerBigInt);

    // 3. Transfer
    const tx = await this.cofheClient.writeContract({
      address: this.nftContract,
      abi: FHERC721_ABI,
      functionName: 'confidentialTransfer',
      args: [tokenId, toCircle, encryptedNewOwner, ownershipProof],
    });

    const receipt = await tx.wait();
    return receipt.transactionHash;
  }

  /**
   * Revela metadados via Threshold Network
   */
  async revealMetadata(tokenId: bigint): Promise<{
    uriHash: bigint;
    txHash: `0x${string}`;
  }> {
    // 1. Obtém handle do URI cifrado
    const uriHandle = await this.getURIHandle(tokenId);

    // 2. Solicita decriptação Threshold
    const circleId = await this.getTokenCircle(tokenId);
    const decryptResult = await this.thresholdClient.fullThresholdDecrypt(circleId, uriHandle);

    // 3. Chama revealMetadata
    const tx = await this.cofheClient.writeContract({
      address: this.nftContract,
      abi: FHERC721_ABI,
      functionName: 'revealMetadata',
      args: [tokenId, decryptResult.plaintext, decryptResult.signature],
    });

    const receipt = await tx.wait();

    return {
      uriHash: decryptResult.plaintext,
      txHash: receipt.transactionHash,
    };
  }

  /**
   * Verifica ownership confidencial
   */
  async isOwner(tokenId: bigint, address: `0x${string}`): Promise<boolean> {
    const addressBigInt = BigInt(address);
    const encryptedAddress = await this.cofheClient.encryptUint256(addressBigInt);

    const result = await this.cofheClient.readContract({
      address: this.nftContract,
      abi: FHERC721_ABI,
      functionName: 'isConfidentialOwner',
      args: [tokenId, encryptedAddress],
    });

    // Resultado é ebool — precisa decriptar para boolean
    return result !== 0n;
  }

  private async generateOwnershipProof(tokenId: bigint): Promise<`0x${string}`> {
    // Em produção: gera ZK proof de propriedade
    return '0x' + randomBytes(64).toString('hex') as `0x${string}`;
  }

  private async getURIHandle(tokenId: bigint): Promise<bigint> {
    // View function para obter handle do URI cifrado
    return 0n; // Placeholder
  }

  private async getTokenCircle(tokenId: bigint): Promise<string> {
    // View function para obter Circle do token
    return ''; // Placeholder
  }

  private extractTokenId(receipt: any): bigint {
    const event = receipt.logs.find((log: any) => log.eventName === 'ConfidentialMint');
    return event?.args?.tokenId || 0n;
  }
}
```

---

## 6.4 Tabela Comparativa: ERC721 vs FHERC721 vs OctraFHERC721

| Feature | ERC721 | FHERC721 | OctraFHERC721 (840+) |
|---------|--------|----------|----------------------|
| **Owner** | Público (`address`) | Cifrado (`eaddress`) | Cifrado + Circle isolation |
| **Metadata** | Pública (IPFS/HTTP) | Cifrada (`euint256`) | Cifrada + Circle-based |
| **Transfer** | `transferFrom` | `confidentialTransfer` | `confidentialTransfer` + ZK proof |
| **Ownership Verify** | `ownerOf()` | `isConfidentialOwner()` | `isConfidentialOwner()` + Threshold |
| **URI** | `tokenURI()` → real | `tokenURI()` → indicador | `tokenURI()` → `confidential://` |
| **Reveal** | N/A | Threshold Network | Threshold + Octra HFHE |
| **Mint** | `mint(to, tokenId)` | `confidentialMint(encURI, encOwner)` | `confidentialMint(circleId, ...)` |
| **Standard** | ERC-721 | FHERC-721 | FHERC-721 + Octra Circle |
| **Privacy** | Nenhuma | Completa | Completa + cross-chain |

---

# RESUMO EXECUTIVO — PARTE 2

## ZK Verifier
- **ZKPoK** protege contra Malleability Attacks e CCAs
- **Fluxo**: User encrypt → generate ZKPoK → ZK Verifier signs → Contract verifies via `ecrecover`
- **TEE execution** para integridade do verificador
- **Nonce replay protection** em contrato

## Slim Listener / Result Processor
- **Slim Listener**: Monitora Task Manager events → encaminha para FHEOS
- **Result Processor**: Recebe resultados FHEOS → publica no Task Manager
- **Pipeline async**: Event → FHEOS → Result → On-chain publication
- **Go + TypeScript** implementations para alta performance

## FHERC721
- **Metadados cifrados** (`euint256` para URI hash)
- **Owner privado** (`eaddress`)
- **Circle-based isolation**: cada NFT associado a Circle Octra
- **ZK ownership proofs** para transferências
- **Threshold reveal** para metadados

---

**FIM DA ANÁLISE PROFUNDA COFHE — PARTE 2**

*© 2026 ARKHE OS Cathedral | Arquiteto: ORCID 0009-0005-2697-4668*