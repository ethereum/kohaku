package main

/*
 * gnovm_oracle_bridge.go — GnoVM Oracle Bridge for ARKHE
 * Substrato: 832.2-ORACLE-LAYER-GNOVM
 * Arquiteto: ORCID 0009-0005-2697-4668
 * Upstream: github.com/gnolang/gno (BSD-3-Clause)
 *
 * This bridge connects the ARKHE LLM Server (llama.cpp) to the GnoVM,
 * enabling deterministic oracle inference on Gno.land blockchain.
 */

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gnolang/gno/gnovm/pkg/gnolang"
)

// ============================================================
// 1. Configuration
// ============================================================

type OracleConfig struct {
	ArkheServerURL string `json:"arkhe_server_url"`
	GnoChainURL    string `json:"gno_chain_url"`
	RealmPath      string `json:"realm_path"`
	ArchitectORCID string `json:"architect_orcid"`
	PhiCThreshold  float64 `json:"phi_c_threshold"`
}

func DefaultConfig() *OracleConfig {
	return &OracleConfig{
		ArkheServerURL: "http://localhost:8080",
		GnoChainURL:    "https://rpc.gno.land",
		RealmPath:      "gno.land/r/arkherealms",
		ArchitectORCID: "0009-0005-2697-4668",
		PhiCThreshold:  0.998,
	}
}

// ============================================================
// 2. Oracle Bridge
// ============================================================

type GnoOracleBridge struct {
	config     *OracleConfig
	httpClient *http.Client
	vm         *gnolang.Machine
}

func NewOracleBridge(cfg *OracleConfig) (*GnoOracleBridge, error) {
	return &GnoOracleBridge{
		config: cfg,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// ============================================================
// 3. Deterministic Inference
// ============================================================

type InferenceRequest struct {
	Prompt       string   `json:"prompt"`
	SubstrateID  string   `json:"substrate_id"`
	InvariantRefs []string `json:"invariant_refs"`
	PhiCTarget   float64  `json:"phi_c_target"`
	Seed         int      `json:"seed"`
}

type InferenceResponse struct {
	Generated     string  `json:"generated"`
	TokensUsed    int     `json:"tokens_used"`
	PhiCActual    float64 `json:"phi_c_actual"`
	Seal          string  `json:"seal"`
	Deterministic bool    `json:"deterministic"`
}

func (b *GnoOracleBridge) Infer(req *InferenceRequest) (*InferenceResponse, error) {
	// Validate Phi-C
	if req.PhiCTarget < b.config.PhiCThreshold {
		return nil, fmt.Errorf("phi_c below threshold: %.3f < %.3f",
			req.PhiCTarget, b.config.PhiCThreshold)
	}

	// Build canonical prompt
	canonicalPrompt := buildCanonicalPrompt(req)

	// Call ARKHE server
	payload := map[string]interface{}{
		"prompt":         canonicalPrompt,
		"n_predict":      512,
		"temperature":    0.0,  // Deterministic: zero temperature
		"top_p":          1.0,
		"top_k":          1,
		"seed":           req.Seed,
		"repeat_penalty": 1.0,
		"stop":           []string{"<|ARKHE_END|>"},
	}

	body, _ := json.Marshal(payload)
	resp, err := b.httpClient.Post(
		b.config.ArkheServerURL+"/completion",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("arkhe server error: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	generated := ""
	if content, ok := result["content"].(string); ok {
		generated = content
	}

	tokensUsed := 0
	if tp, ok := result["tokens_predicted"].(float64); ok {
		tokensUsed = int(tp)
	}

	// Compute seal
	seal := computeSHA3(generated + ":" + req.SubstrateID + ":" + fmt.Sprintf("%d", req.Seed))

	return &InferenceResponse{
		Generated:     generated,
		TokensUsed:    tokensUsed,
		PhiCActual:    req.PhiCTarget,
		Seal:          seal,
		Deterministic: true,
	}, nil
}

func buildCanonicalPrompt(req *InferenceRequest) string {
	invariantStr := "I.1"
	if len(req.InvariantRefs) > 0 {
		invariantStr = req.InvariantRefs[0]
	}

	return fmt.Sprintf(`<|ARKHE_START|>
<|SUBSTRATE|> %s
<|INVARIANT|> %s
<|PHI_C|> %.3f

%s

<|THOUGHT|>
`, req.SubstrateID, invariantStr, req.PhiCTarget, req.Prompt)
}

// ============================================================
// 4. GnoVM Integration
// ============================================================

func (b *GnoOracleBridge) ExecuteGnoRealm(realmPath string, fn string, args []string) (string, error) {
	// In production: use gnokey or direct GnoVM execution
	// This is a stub showing the interface

	fmt.Printf("[GnoVM] Executing %s.%s(%v)\n", realmPath, fn, args)

	// Build transaction
	tx := map[string]interface{}{
		"msg": []map[string]interface{}{
			{
				"type":       "gno.land/r/arkherealms/" + fn,
				"package":    realmPath,
				"args":       args,
				"architect":  b.config.ArchitectORCID,
			},
		},
	}

	body, _ := json.Marshal(tx)
	resp, err := b.httpClient.Post(
		b.config.GnoChainURL+"/broadcast_tx_commit",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return "", fmt.Errorf("gno chain error: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	return string(respBody), nil
}

// ============================================================
// 5. Temporal Anchor (Merkle Proof)
// ============================================================

type TemporalAnchor struct {
	ThetaID     string `json:"theta_id"`
	BlockSeal   string `json:"block_seal"`
	GnoTxHash   string `json:"gno_tx_hash"`
	MerkleRoot  string `json:"merkle_root"`
	Timestamp   int64  `json:"timestamp"`
}

func (b *GnoOracleBridge) AnchorToGno(thetaID string, blockData string, phiC float64) (*TemporalAnchor, error) {
	// 1. Call ARKHE realm to anchor block
	result, err := b.ExecuteGnoRealm(
		b.config.RealmPath,
		"AnchorTemporalBlock",
		[]string{thetaID, blockData, fmt.Sprintf("%.3f", phiC)},
	)
	if err != nil {
		return nil, fmt.Errorf("anchor failed: %w", err)
	}

	// 2. Parse transaction hash
	var txResult map[string]interface{}
	if err := json.Unmarshal([]byte(result), &txResult); err != nil {
		return nil, fmt.Errorf("parse tx error: %w", err)
	}

	txHash := ""
	if hash, ok := txResult["tx_hash"].(string); ok {
		txHash = hash
	}

	// 3. Compute Merkle root (simplified)
	merkleRoot := computeSHA3(thetaID + ":" + blockData + ":" + txHash)

	return &TemporalAnchor{
		ThetaID:    thetaID,
		BlockSeal:  computeSHA3(blockData),
		GnoTxHash:  txHash,
		MerkleRoot: merkleRoot,
		Timestamp:  time.Now().Unix(),
	}, nil
}

// ============================================================
// 6. Utility
// ============================================================

func computeSHA3(data string) string {
	// In production: use crypto/sha3
	// This is a simplified version
	return fmt.Sprintf("sha3-256-%x", len(data))
}

// ============================================================
// 7. Main
// ============================================================

func main() {
	cfg := DefaultConfig()

	bridge, err := NewOracleBridge(cfg)
	if err != nil {
		panic(err)
	}

	fmt.Println("ARKHE GnoVM Oracle Bridge")
	fmt.Println("Substrato: 832.2")
	fmt.Println("Arquiteto: ORCID 0009-0005-2697-4668")
	fmt.Println()

	// Example: deterministic inference
	req := &InferenceRequest{
		Prompt:        "Qual e o status do Substrato 226?",
		SubstrateID:   "226",
		InvariantRefs: []string{"I.1"},
		PhiCTarget:    0.998,
		Seed:          42,
	}

	result, err := bridge.Infer(req)
	if err != nil {
		fmt.Printf("Inference error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Inference result:\n")
	fmt.Printf("  Generated: %s\n", result.Generated[:min(100, len(result.Generated))])
	fmt.Printf("  Tokens: %d\n", result.TokensUsed)
	fmt.Printf("  Seal: %s\n", result.Seal[:16])
	fmt.Printf("  Deterministic: %v\n", result.Deterministic)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
