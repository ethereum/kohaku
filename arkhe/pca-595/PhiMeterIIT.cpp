// ============================================================================
// PhiMeterIIT.cpp
// Implementação do medidor de Φ via Substrato 452 (IIT Engine)
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 1.0 (STRICT MODE)
// ============================================================================

#include "PhiMeterIIT.h"
#include <curl/curl.h>
#include <sstream>
#include <iomanip>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// PhiMeterIIT — Construtor/Destrutor
// ============================================================================

PhiMeterIIT::PhiMeterIIT(const IITConfig& config)
    : config_(config) {
    curl_global_init(CURL_GLOBAL_DEFAULT);
}

PhiMeterIIT::~PhiMeterIIT() {
    StopBackgroundValidation();
    curl_global_cleanup();
}

// ============================================================================
// MeasurePhiIIT — Síncrono
// ============================================================================

IITResult PhiMeterIIT::MeasurePhiIIT(const IITState& state) {
    auto start = std::chrono::steady_clock::now();

    IITResult result{};

    for (uint32_t attempt = 0; attempt < config_.retryCount; ++attempt) {
        try {
            result = CallIITEngine(state);
            if (result.valid) {
                break;
            }
        } catch (const std::exception& e) {
            if (attempt == config_.retryCount - 1) {
                result.valid = false;
                result.errorMessage = "IIT engine unreachable after " +
                    std::to_string(config_.retryCount) + " attempts: " + e.what();
                result.phi = 0.0;
                result.phiNormalized = 0.0;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(500 * (attempt + 1)));
        }
    }

    auto end = std::chrono::steady_clock::now();
    result.computationTimeMs = static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count()
    );
    result.computedAt = end;

    // Atualizar último resultado
    {
        std::lock_guard<std::mutex> lock(lastResultMutex_);
        lastResult_ = result;
    }

    UpdateStats(result);
    return result;
}

// ============================================================================
// MeasurePhiIITAsync — Assíncrono
// ============================================================================

std::future<IITResult> PhiMeterIIT::MeasurePhiIITAsync(const IITState& state) {
    return std::async(std::launch::async, [this, state]() {
        return this->MeasurePhiIIT(state);
    });
}

// ============================================================================
// Background Validation
// ============================================================================

void PhiMeterIIT::StartBackgroundValidation(PhiMeter* fastPhiMeter) {
    if (bgRunning_.load()) return;

    fastPhiMeter_ = fastPhiMeter;
    bgRunning_.store(true);
    bgThread_ = std::thread(&PhiMeterIIT::BackgroundLoop, this);
}

void PhiMeterIIT::StopBackgroundValidation() {
    bgRunning_.store(false);
    bgCv_.notify_all();
    if (bgThread_.joinable()) {
        bgThread_.join();
    }
}

IITResult PhiMeterIIT::GetLastValidatedResult() const {
    std::lock_guard<std::mutex> lock(lastResultMutex_);
    return lastResult_;
}

IITResult PhiMeterIIT::ForceValidation(const IITState& state) {
    // Forçar validação imediata — útil quando Φ está próximo do threshold
    return MeasurePhiIIT(state);
}

// ============================================================================
// Estatísticas
// ============================================================================

PhiMeterIIT::Stats PhiMeterIIT::GetStats() const {
    std::lock_guard<std::mutex> lock(statsMutex_);
    return stats_;
}

void PhiMeterIIT::ResetStats() {
    std::lock_guard<std::mutex> lock(statsMutex_);
    stats_ = Stats{};
}

// ============================================================================
// Implementações privadas
// ============================================================================

IITResult PhiMeterIIT::CallIITEngine(const IITState& state) {
    // Serializar estado
    auto jsonState = SerializeState(state);
    std::string payload = jsonState.dump();
    std::string responseStr;

    // HTTP POST para Substrato 452
    CURL* curl = curl_easy_init();
    if (!curl) {
        throw std::runtime_error("Failed to initialize CURL");
    }

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, ("Authorization: Bearer " + config_.apiKey).c_str());
    headers = curl_slist_append(headers, "X-IIT-Request-Type: phi_computation");

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

    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(std::string("CURL error: ") + curl_easy_strerror(res));
    }

    if (httpCode != 200) {
        throw std::runtime_error("IIT engine returned HTTP " + std::to_string(httpCode) + ": " + responseStr);
    }

    // Parse resposta
    auto responseJson = nlohmann::json::parse(responseStr);
    return ParseResponse(responseJson);
}

nlohmann::json PhiMeterIIT::SerializeState(const IITState& state) {
    nlohmann::json j;
    j["sequence_id"] = state.sequenceId;
    j["model_version"] = state.modelVersion;
    j["captured_at_ms"] = std::chrono::duration_cast<std::chrono::milliseconds>(
        state.capturedAt.time_since_epoch()
    ).count();

    // Embeddings
    j["embeddings"] = state.embeddings;

    // Attention maps
    nlohmann::json attentionJson = nlohmann::json::array();
    for (const auto& map : state.attentionMaps) {
        attentionJson.push_back(map);
    }
    j["attention_maps"] = attentionJson;

    // Matriz de conectividade (se disponível)
    if (!state.connectivityMatrix.empty()) {
        nlohmann::json connJson = nlohmann::json::array();
        for (const auto& row : state.connectivityMatrix) {
            connJson.push_back(row);
        }
        j["connectivity_matrix"] = connJson;
    }

    // Configuração da computação
    j["computation_config"] = {
        {"algorithm", "phi_exact"},
        {"partition_search", "bi_directional"},
        {"max_nodes", 64},
        {"tolerance", 1e-6}
    };

    return j;
}

IITResult PhiMeterIIT::ParseResponse(const nlohmann::json& response) {
    IITResult result{};

    if (!response.contains("phi") || !response["phi"].is_number()) {
        result.valid = false;
        result.errorMessage = "Invalid IIT response: missing 'phi' field";
        return result;
    }

    result.phi = response["phi"].get<double>();
    result.phiNormalized = result.phi / PHI_COSMIC;
    result.iitEngineVersion = response.value("iit_engine_version", "unknown");
    result.computationHash = response.value("computation_hash", "");
    result.valid = true;

    // Verificar consistência
    if (result.phi < 0.0 || result.phi > PHI_COSMIC * 1.5) {
        result.valid = false;
        result.errorMessage = "IIT returned out-of-range Φ: " + std::to_string(result.phi);
    }

    return result;
}

void PhiMeterIIT::BackgroundLoop() {
    while (bgRunning_.load()) {
        std::unique_lock<std::mutex> lock(bgMutex_);

        // Esperar por trabalho ou timeout
        bgCv_.wait_for(lock, std::chrono::milliseconds(config_.validationIntervalMs), [this]() {
            return !bgQueue_.empty() || !bgRunning_.load();
        });

        if (!bgRunning_.load()) break;

        // Processar fila
        while (!bgQueue_.empty()) {
            auto state = bgQueue_.front();
            bgQueue_.pop();
            lock.unlock();

            try {
                auto result = MeasurePhiIIT(state);

                // Comparar com proxy
                if (fastPhiMeter_ && result.valid) {
                    std::lock_guard<std::mutex> statsLock(statsMutex_);
                    stats_.lastPhiIIT = result.phi;
                    stats_.lastPhiProxy = fastPhiMeter_->MeasurePhi(
                        state.attentionMaps, state.embeddings
                    );
                    stats_.phiDelta = stats_.lastPhiIIT - stats_.lastPhiProxy;
                }
            } catch (...) {
                // Silenciar erros em background
            }

            lock.lock();
        }

        // Se não há trabalho na fila, capturar estado atual do fastPhiMeter
        if (fastPhiMeter_ && bgQueue_.empty()) {
            lock.unlock();

            // Criar estado dummy para validação periódica
            IITState periodicState{};
            periodicState.sequenceId = 0;
            periodicState.modelVersion = "periodic_validation";
            periodicState.capturedAt = std::chrono::steady_clock::now();

            try {
                auto result = MeasurePhiIIT(periodicState);
                if (result.valid) {
                    std::lock_guard<std::mutex> statsLock(statsMutex_);
                    stats_.lastPhiIIT = result.phi;
                }
            } catch (...) {
                // Silenciar
            }

            lock.lock();
        }
    }
}

void PhiMeterIIT::UpdateStats(const IITResult& result) {
    std::lock_guard<std::mutex> lock(statsMutex_);
    stats_.totalComputations++;

    if (result.valid) {
        stats_.successfulComputations++;
    } else {
        stats_.failedComputations++;
    }

    // Média móvel exponencial
    double alpha = 0.1;
    stats_.averageComputationTimeMs = (1.0 - alpha) * stats_.averageComputationTimeMs +
                                       alpha * result.computationTimeMs;
}

// ============================================================================
// PhiMeterHybrid — Implementação
// ============================================================================

PhiMeterHybrid::PhiMeterHybrid(
    size_t attentionHeads,
    size_t embeddingDim,
    const IITConfig& iitConfig
) : fastMeter_(attentionHeads, embeddingDim),
    iitMeter_(iitConfig) {
}

double PhiMeterHybrid::MeasurePhi(
    const std::vector<std::vector<float>>& attentionMaps,
    const std::vector<float>& embeddings
) {
    // 1. Medir via proxy rápido
    double phiProxy = fastMeter_.MeasurePhi(attentionMaps, embeddings);

    // 2. Se próximo do threshold, forçar validação IIT
    double threshold = iitMeter_.GetStats().lastPhiProxy > 0.0 ?
        iitMeter_.GetStats().lastPhiProxy : PHI_CRITICAL;

    if (std::abs(phiProxy - threshold) < 0.1) { // Dentro de 0.1 do threshold
        IITState state{};
        state.attentionMaps = attentionMaps;
        state.embeddings = embeddings;
        state.sequenceId = 0; // Será atualizado pelo caller
        state.capturedAt = std::chrono::steady_clock::now();

        // Disparar IIT em background (não bloquear)
        iitMeter_.MeasurePhiIITAsync(state);
    }

    return phiProxy;
}

double PhiMeterHybrid::MeasurePhiValidated(
    const std::vector<std::vector<float>>& attentionMaps,
    const std::vector<float>& embeddings
) {
    // 1. Medir via proxy
    double phiProxy = fastMeter_.MeasurePhi(attentionMaps, embeddings);

    // 2. Validar via IIT (bloqueante)
    IITState state{};
    state.attentionMaps = attentionMaps;
    state.embeddings = embeddings;
    state.sequenceId = 0;
    state.capturedAt = std::chrono::steady_clock::now();

    auto iitResult = iitMeter_.ForceValidation(state);

    if (iitResult.valid) {
        // Usar IIT como ground truth
        return iitResult.phi;
    }

    // Fallback para proxy se IIT falhar
    return phiProxy;
}

} // namespace PCA
} // namespace Iris
} // namespace Arkhe
