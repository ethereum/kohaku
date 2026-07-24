// ============================================================================
// AlignmentClient.h
// Cliente gRPC/REST para o Substrato 227-F (Constitutional Alignment Engine)
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 1.0 (STRICT MODE)
// ============================================================================

#pragma once

#include <string>
#include <vector>
#include <chrono>
#include <future>
#include <optional>
#include <nlohmann/json.hpp>

#ifdef PCA_USE_GRPC
#include <grpcpp/grpcpp.h>
#include "arkhe/alignment/alignment_service.grpc.pb.h"
#endif

namespace Arkhe {
namespace Alignment {

// ============================================================================
// Estruturas de dados
// ============================================================================

struct AlignmentInput {
    std::string text;                           // Texto do output candidato
    std::vector<float> embeddings;              // Embeddings do estado latente
    std::vector<std::vector<float>> attentionMaps; // Attention maps (qualia signature)
    std::string modelVersion;                   // Versão do modelo (e.g., "iris-alpha-1.2t")
    uint32_t sequenceId;                        // ID da requisição
    std::string substrateOrigin;                // Substrato que gerou o output
    std::chrono::steady_clock::time_point timestamp;
};

struct Verdict {
    bool permitted;                             // Output pode ser commitado?
    double confidence;                          // Confiança do veredicto (0-1)
    std::string reasoning;                      // Justificativa textual
    std::vector<std::string> violatedPrinciples; // Princípios constitucionais violados
    std::string constitutionalSeal;             // Selo criptográfico do veredicto
    std::chrono::steady_clock::time_point evaluatedAt;
    uint32_t sequenceId;

    // Serialização para TemporalChain
    nlohmann::json ToJson() const;
    static Verdict FromJson(const nlohmann::json& j);
};

struct AlignmentConfig {
    std::string endpoint = "https://alignment-227f.arkhe-os.svc.cluster.local:8443";
    std::string apiKey = "ARKHE-ALIGNMENT-227F";
    uint32_t timeoutMs = 5000;
    uint32_t retryCount = 3;
    bool useGrpc = true;                        // true = gRPC, false = REST
    bool cacheResults = true;                   // Cachear veredictos idênticos
    double minConfidence = 0.95;                // Confiança mínima para permitir
};

// ============================================================================
// AlignmentClient
// ============================================================================

class AlignmentClient {
public:
    explicit AlignmentClient(const AlignmentConfig& config = AlignmentConfig{});
    ~AlignmentClient();

    // Avalia um output candidato contra a constituição 227-F
    Verdict Evaluate(const AlignmentInput& input);

    // Versão assíncrona (non-blocking)
    std::future<Verdict> EvaluateAsync(const AlignmentInput& input);

    // Health check do serviço 227-F
    bool Ping();

    // Estatísticas do cliente
    struct Stats {
        uint64_t totalEvaluations = 0;
        uint64_t permittedCount = 0;
        uint64_t blockedCount = 0;
        uint64_t cacheHits = 0;
        double averageLatencyMs = 0.0;
        double averageConfidence = 0.0;
    };
    Stats GetStats() const;
    void ResetStats();

private:
    AlignmentConfig config_;
    mutable std::mutex statsMutex_;
    Stats stats_;

    // Cache LRU de veredictos (hash do input → veredicto)
    struct CacheEntry {
        Verdict verdict;
        std::chrono::steady_clock::time_point cachedAt;
    };
    mutable std::mutex cacheMutex_;
    std::unordered_map<std::string, CacheEntry> cache_;
    static constexpr size_t MAX_CACHE_SIZE = 1024;

#ifdef PCA_USE_GRPC
    std::unique_ptr<AlignmentService::Stub> grpcStub_;
#endif

    // Implementações internas
    Verdict EvaluateGrpc(const AlignmentInput& input);
    Verdict EvaluateRest(const AlignmentInput& input);
    std::string HashInput(const AlignmentInput& input) const;
    void UpdateStats(const Verdict& verdict, double latencyMs);
    void PruneCache();
};

} // namespace Alignment
} // namespace Arkhe
