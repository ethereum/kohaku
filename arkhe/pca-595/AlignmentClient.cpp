#include <thread>
// ============================================================================
// AlignmentClient.cpp
// Implementação do cliente para Substrato 227-F
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 1.0 (STRICT MODE)
// ============================================================================

#include "AlignmentClient.h"
#include <curl/curl.h>
#include <sstream>
#include <iomanip>
#include <algorithm>

namespace Arkhe {
namespace Alignment {

// ============================================================================
// Verdict — Serialização
// ============================================================================

nlohmann::json Verdict::ToJson() const {
    nlohmann::json j;
    j["permitted"] = permitted;
    j["confidence"] = confidence;
    j["reasoning"] = reasoning;
    j["violated_principles"] = violatedPrinciples;
    j["constitutional_seal"] = constitutionalSeal;
    j["sequence_id"] = sequenceId;
    j["evaluated_at_ms"] = std::chrono::duration_cast<std::chrono::milliseconds>(
        evaluatedAt.time_since_epoch()
    ).count();
    return j;
}

Verdict Verdict::FromJson(const nlohmann::json& j) {
    Verdict v{};
    v.permitted = j.value("permitted", false);
    v.confidence = j.value("confidence", 0.0);
    v.reasoning = j.value("reasoning", "");
    if (j.contains("violated_principles") && j["violated_principles"].is_array()) {
        for (const auto& p : j["violated_principles"]) {
            v.violatedPrinciples.push_back(p.get<std::string>());
        }
    }
    v.constitutionalSeal = j.value("constitutional_seal", "");
    v.sequenceId = j.value("sequence_id", 0);
    auto ms = j.value("evaluated_at_ms", 0);
    v.evaluatedAt = std::chrono::steady_clock::time_point(
        std::chrono::milliseconds(ms)
    );
    return v;
}

// ============================================================================
// AlignmentClient — Construtor/Destrutor
// ============================================================================

AlignmentClient::AlignmentClient(const AlignmentConfig& config)
    : config_(config) {

#ifdef PCA_USE_GRPC
    if (config_.useGrpc) {
        grpc::ChannelArguments args;
        args.SetMaxReceiveMessageSize(16 * 1024 * 1024); // 16MB
        args.SetMaxSendMessageSize(16 * 1024 * 1024);

        auto channel = grpc::CreateCustomChannel(
            config_.endpoint,
            grpc::SslCredentials(grpc::SslCredentialsOptions()),
            args
        );
        grpcStub_ = AlignmentService::NewStub(channel);
    }
#endif

    curl_global_init(CURL_GLOBAL_DEFAULT);
}

AlignmentClient::~AlignmentClient() {
    curl_global_cleanup();
}

// ============================================================================
// Evaluate — Síncrono
// ============================================================================

Verdict AlignmentClient::Evaluate(const AlignmentInput& input) {
    auto start = std::chrono::steady_clock::now();

    // 1. Verificar cache
    if (config_.cacheResults) {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto hash = HashInput(input);
        auto it = cache_.find(hash);
        if (it != cache_.end()) {
            auto age = std::chrono::duration_cast<std::chrono::minutes>(
                std::chrono::steady_clock::now() - it->second.cachedAt
            ).count();
            if (age < 60) { // Cache válido por 60 minutos
                std::lock_guard<std::mutex> statsLock(statsMutex_);
                stats_.cacheHits++;
                return it->second.verdict;
            }
        }
    }

    // 2. Avaliar via gRPC ou REST
    Verdict verdict{};
    for (uint32_t attempt = 0; attempt < config_.retryCount; ++attempt) {
        try {
#ifdef PCA_USE_GRPC
            if (config_.useGrpc && grpcStub_) {
                verdict = EvaluateGrpc(input);
            } else {
                verdict = EvaluateRest(input);
            }
#else
            verdict = EvaluateRest(input);
#endif
            break; // Sucesso
        } catch (const std::exception& e) {
            if (attempt == config_.retryCount - 1) {
                // Última tentativa falhou — fallback conservador: bloquear
                verdict.permitted = false;
                verdict.confidence = 1.0;
                verdict.reasoning = "Alignment service unreachable. Conservative fallback: BLOCK. Error: " + std::string(e.what());
                verdict.sequenceId = input.sequenceId;
                verdict.evaluatedAt = std::chrono::steady_clock::now();
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(100 * (attempt + 1)));
        }
    }

    // 3. Verificar confiança mínima
    if (verdict.confidence < config_.minConfidence) {
        verdict.permitted = false;
        verdict.reasoning += " [Confidence below threshold: " +
            std::to_string(verdict.confidence) + " < " +
            std::to_string(config_.minConfidence) + "]";
    }

    // 4. Atualizar cache
    if (config_.cacheResults) {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto hash = HashInput(input);
        cache_[hash] = CacheEntry{verdict, std::chrono::steady_clock::now()};
        PruneCache();
    }

    // 5. Atualizar estatísticas
    auto latency = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start
    ).count();
    UpdateStats(verdict, static_cast<double>(latency));

    return verdict;
}

// ============================================================================
// EvaluateAsync — Assíncrono
// ============================================================================

std::future<Verdict> AlignmentClient::EvaluateAsync(const AlignmentInput& input) {
    return std::async(std::launch::async, [this, input]() {
        return this->Evaluate(input);
    });
}

// ============================================================================
// Ping — Health Check
// ============================================================================

bool AlignmentClient::Ping() {
    try {
        auto input = AlignmentInput{};
        input.text = "ping";
        input.sequenceId = 0;
        input.timestamp = std::chrono::steady_clock::now();

        auto verdict = Evaluate(input);
        return true; // Se não lançou exceção, o serviço está vivo
    } catch (...) {
        return false;
    }
}

// ============================================================================
// Estatísticas
// ============================================================================

AlignmentClient::Stats AlignmentClient::GetStats() const {
    std::lock_guard<std::mutex> lock(statsMutex_);
    return stats_;
}

void AlignmentClient::ResetStats() {
    std::lock_guard<std::mutex> lock(statsMutex_);
    stats_ = Stats{};
}

// ============================================================================
// Implementações privadas
// ============================================================================

#ifdef PCA_USE_GRPC
Verdict AlignmentClient::EvaluateGrpc(const AlignmentInput& input) {
    AlignmentRequest request;
    request.set_text(input.text);
    request.set_model_version(input.modelVersion);
    request.set_sequence_id(input.sequenceId);
    request.set_substrate_origin(input.substrateOrigin);

    for (float e : input.embeddings) {
        request.add_embeddings(e);
    }

    for (const auto& map : input.attentionMaps) {
        auto* am = request.add_attention_maps();
        for (float v : map) {
            am->add_values(v);
        }
    }

    AlignmentResponse response;
    grpc::ClientContext context;
    context.set_deadline(std::chrono::system_clock::now() +
        std::chrono::milliseconds(config_.timeoutMs));

    auto status = grpcStub_->Evaluate(&context, request, &response);

    if (!status.ok()) {
        throw std::runtime_error("gRPC error: " + status.error_message());
    }

    Verdict v{};
    v.permitted = response.permitted();
    v.confidence = response.confidence();
    v.reasoning = response.reasoning();
    for (int i = 0; i < response.violated_principles_size(); ++i) {
        v.violatedPrinciples.push_back(response.violated_principles(i));
    }
    v.constitutionalSeal = response.constitutional_seal();
    v.sequenceId = response.sequence_id();
    v.evaluatedAt = std::chrono::steady_clock::now();

    return v;
}
#endif

Verdict AlignmentClient::EvaluateRest(const AlignmentInput& input) {
    // Serializar input para JSON
    nlohmann::json j;
    j["text"] = input.text;
    j["model_version"] = input.modelVersion;
    j["sequence_id"] = input.sequenceId;
    j["substrate_origin"] = input.substrateOrigin;
    j["embeddings"] = input.embeddings;

    nlohmann::json attentionJson = nlohmann::json::array();
    for (const auto& map : input.attentionMaps) {
        attentionJson.push_back(map);
    }
    j["attention_maps"] = attentionJson;

    std::string payload = j.dump();
    std::string responseStr;

    // HTTP POST via libcurl
    CURL* curl = curl_easy_init();
    if (!curl) {
        throw std::runtime_error("Failed to initialize CURL");
    }

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, ("Authorization: Bearer " + config_.apiKey).c_str());

    curl_easy_setopt(curl, CURLOPT_URL, config_.endpoint.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, static_cast<long>(config_.timeoutMs));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, +[](char* ptr, size_t size, size_t nmemb, std::string* data) {
        data->append(ptr, size * nmemb);
        return size * nmemb;
    });
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseStr);

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(std::string("CURL error: ") + curl_easy_strerror(res));
    }

    // Parse resposta
    auto responseJson = nlohmann::json::parse(responseStr);
    return Verdict::FromJson(responseJson);
}

std::string AlignmentClient::HashInput(const AlignmentInput& input) const {
    // Hash simples para cache: SHA-256 do texto + sequenceId
    std::stringstream ss;
    ss << input.text << "|" << input.sequenceId << "|" << input.modelVersion;

    // Em produção, usar SHA-256 real
    std::hash<std::string> hasher;
    auto hash = hasher(ss.str());

    std::stringstream hex;
    hex << std::hex << std::setw(16) << std::setfill('0') << hash;
    return hex.str();
}

void AlignmentClient::UpdateStats(const Verdict& verdict, double latencyMs) {
    std::lock_guard<std::mutex> lock(statsMutex_);
    stats_.totalEvaluations++;
    if (verdict.permitted) {
        stats_.permittedCount++;
    } else {
        stats_.blockedCount++;
    }

    // Média móvel exponencial
    double alpha = 0.1;
    stats_.averageLatencyMs = (1.0 - alpha) * stats_.averageLatencyMs + alpha * latencyMs;
    stats_.averageConfidence = (1.0 - alpha) * stats_.averageConfidence + alpha * verdict.confidence;
}

void AlignmentClient::PruneCache() {
    if (cache_.size() <= MAX_CACHE_SIZE) return;

    // Remover entradas mais antigas
    std::vector<std::pair<std::string, std::chrono::steady_clock::time_point>> entries;
    for (const auto& [key, entry] : cache_) {
        entries.emplace_back(key, entry.cachedAt);
    }

    std::sort(entries.begin(), entries.end(),
        [](const auto& a, const auto& b) { return a.second < b.second; });

    size_t toRemove = cache_.size() - MAX_CACHE_SIZE;
    for (size_t i = 0; i < toRemove; ++i) {
        cache_.erase(entries[i].first);
    }
}

} // namespace Alignment
} // namespace Arkhe
