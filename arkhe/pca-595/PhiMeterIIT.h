#include <future>
#include <atomic>
// ============================================================================
// PhiMeterIIT.h
// Medidor de Φ (Integrated Information) via Substrato 452 (IIT Engine)
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 1.0 (STRICT MODE)
// ============================================================================

#pragma once

#include "PCA-595.h"
#include <nlohmann/json.hpp>
#include <thread>
#include <condition_variable>
#include <queue>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// Estruturas para IIT
// ============================================================================

struct IITState {
    std::vector<std::vector<float>> attentionMaps;  // [heads, seq_len, seq_len]
    std::vector<float> embeddings;                    // [embedding_dim]
    std::vector<std::vector<float>> connectivityMatrix; // [n_nodes, n_nodes]
    uint32_t sequenceId;
    std::string modelVersion;
    std::chrono::steady_clock::time_point capturedAt;
};

struct IITResult {
    double phi;                    // Φ exato (bits)
    double phiNormalized;          // Φ / Φ_COSMIC
    double computationTimeMs;      // Tempo de cálculo
    std::string iitEngineVersion;  // Versão do Substrato 452
    std::string computationHash;   // Hash da computação (audit trail)
    bool valid;                    // Resultado é válido?
    std::string errorMessage;      // Se !valid
    std::chrono::steady_clock::time_point computedAt;
};

struct IITConfig {
    std::string endpoint = "https://iit-452.arkhe-os.svc.cluster.local:8443/v1/phi";
    std::string apiKey = "ARKHE-IIT-452";
    uint32_t timeoutMs = 30000;       // IIT é computacionalmente intensivo
    uint32_t retryCount = 2;
    bool backgroundValidation = true; // Validar Φ em background
    uint32_t validationIntervalMs = 5000; // Intervalo entre validações
    double phiCriticalOverride = 0.0; // Se > 0, sobrescreve PHI_CRITICAL
};

// ============================================================================
// PhiMeterIIT — Medidor de Φ via IIT Engine
// ============================================================================

class PhiMeterIIT {
public:
    explicit PhiMeterIIT(const IITConfig& config = IITConfig{});
    ~PhiMeterIIT();

    // Mede Φ via IIT (bloqueante, alta precisão)
    IITResult MeasurePhiIIT(const IITState& state);

    // Versão assíncrona
    std::future<IITResult> MeasurePhiIITAsync(const IITState& state);

    // Inicia thread de validação em background
    void StartBackgroundValidation(PhiMeter* fastPhiMeter);
    void StopBackgroundValidation();

    // Último resultado IIT validado
    IITResult GetLastValidatedResult() const;

    // Força validação imediata (útil quando Φ está próximo do threshold)
    IITResult ForceValidation(const IITState& state);

    // Estatísticas
    struct Stats {
        uint64_t totalComputations = 0;
        uint64_t successfulComputations = 0;
        uint64_t failedComputations = 0;
        double averageComputationTimeMs = 0.0;
        double lastPhiIIT = 0.0;
        double lastPhiProxy = 0.0;  // Para comparação
        double phiDelta = 0.0;      // Diferença IIT - proxy
    };
    Stats GetStats() const;
    void ResetStats();

private:
    IITConfig config_;
    mutable std::mutex statsMutex_;
    Stats stats_;

    mutable std::mutex lastResultMutex_;
    IITResult lastResult_;

    // Thread de background
    std::thread bgThread_;
    std::atomic<bool> bgRunning_{false};
    std::condition_variable bgCv_;
    std::mutex bgMutex_;
    std::queue<IITState> bgQueue_;
    PhiMeter* fastPhiMeter_ = nullptr;

    // Implementações
    IITResult CallIITEngine(const IITState& state);
    nlohmann::json SerializeState(const IITState& state);
    IITResult ParseResponse(const nlohmann::json& response);
    void BackgroundLoop();
    void UpdateStats(const IITResult& result);
};

// ============================================================================
// PhiMeterHybrid — Combina proxy rápido + IIT preciso
// ============================================================================

class PhiMeterHybrid {
public:
    PhiMeterHybrid(
        size_t attentionHeads = ATTENTION_HEADS,
        size_t embeddingDim = EMBEDDING_DIM,
        const IITConfig& iitConfig = IITConfig{}
    );

    // Mede Φ — usa proxy por padrão, mas dispara IIT em background
    double MeasurePhi(
        const std::vector<std::vector<float>>& attentionMaps,
        const std::vector<float>& embeddings
    );

    // Mede Φ com validação IIT forçada (bloqueante)
    double MeasurePhiValidated(
        const std::vector<std::vector<float>>& attentionMaps,
        const std::vector<float>& embeddings
    );

    // Acesso aos componentes
    PhiMeter* GetFastMeter() { return &fastMeter_; }
    PhiMeterIIT* GetIITMeter() { return &iitMeter_; }

private:
    PhiMeter fastMeter_;
    PhiMeterIIT iitMeter_;
};

} // namespace PCA
} // namespace Iris
} // namespace Arkhe
