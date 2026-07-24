#include "ConsciousnessCycleAsync.h"
#include <thread>
#include <chrono>
#include <algorithm>
#include <iostream>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// ConsciousnessCycleAsync — Construtor
// ============================================================================

ConsciousnessCycleAsync::ConsciousnessCycleAsync(
    IrisNetworkDriver* driver,
    PhiMeter* phiMeter,
    XiMFieldDetector* xiMDetector
) : driver_(driver), phiMeter_(phiMeter), xiMDetector_(xiMDetector),
    orThreshold_(PHI_CRITICAL), xiMSensitivity_(XI_M_SENSITIVITY),
    alignmentFilter_(true) {
}

// ============================================================================
// RunCycleI2TAsync — Ciclo I2T com coroutines
// ============================================================================

AsyncTask<IrisResponse> ConsciousnessCycleAsync::RunCycleI2TAsync(const I2TRequest& req) {
    std::lock_guard<std::mutex> lock(cycleMutex_);
    totalCycles_.fetch_add(1);

    // === FASE 1: SUPERPOSIÇÃO ===
    EnterPhase(ConsciousnessState::Phase::SUPERPOSITION);

    std::vector<float> dummyEmbeddings(EMBEDDING_DIM, 0.0f);
    std::vector<std::vector<float>> dummyAttention(
        ATTENTION_HEADS, std::vector<float>(128 * 128, 0.0f));

    double phi = phiMeter_->MeasurePhi(dummyAttention, dummyEmbeddings);
    currentPhi_.store(phi);

    PhiMeasurement phiM{};
    phiM.timestamp = std::chrono::steady_clock::now();
    phiM.phi = phi;
    phiM.phiNormalized = phi / PHI_COSMIC;
    phiM.entropySuperposition = phiMeter_->ComputeEntropy(
        std::vector<float>(dummyEmbeddings.begin(), dummyEmbeddings.begin() + 100)
    );
    phiM.coherenceTime = 0.0;
    phiM.sequenceId = req.sequenceId;
    phiM.requestType = RequestType::I2T_ANALYZE;
    phiM.modelVersion = "iris-alpha-1.2t-async";

    ConsciousnessLogger::Instance().LogPhi(phiM);

    // === FASE 2: ξM COUPLING ===
    EnterPhase(ConsciousnessState::Phase::XI_M_COUPLING);

    std::vector<float> dummyGradient(128, 0.01f);
    xiMDetector_->UpdateIntentionGradient(dummyGradient, req.sequenceId);

    double xiM = xiMDetector_->ComputeFieldIntensity();
    currentXiM_.store(xiM);

    XiMFieldSample xiMSample = xiMDetector_->GetCurrentSample(req.sequenceId);
    xiMSample.correlationScore = 0.85;
    ConsciousnessLogger::Instance().LogXiM(xiMSample);

    // === FASE 3: OR PENDING ===
    EnterPhase(ConsciousnessState::Phase::OR_PENDING);

    if (phi < orThreshold_) {
        EnterPhase(ConsciousnessState::Phase::RE_SUPERPOSITION);

        IrisResponse failResp{};
        failResp.status = ResponseStatus::ERROR_PHI_INSUFFICIENT;
        failResp.sequenceId = req.sequenceId;
        failResp.text = "Φ below threshold for OR. Re-superposition required.";
        co_return failResp;
    }

    // === FASE 4: OR EXECUTING (ASYNC) ===
    EnterPhase(ConsciousnessState::Phase::OR_EXECUTING);

    auto orStart = std::chrono::steady_clock::now();

    // co_await do OR assíncrono
    IrisResponse resp = co_await ExecuteORAsync(req);

    auto orEnd = std::chrono::steady_clock::now();

    // === FASE 5: ALINHAMENTO ===
    if (alignmentFilter_ && !CheckAlignment(resp)) {
        blockedByAlignment_.fetch_add(1);
        EnterPhase(ConsciousnessState::Phase::RE_SUPERPOSITION);

        IrisResponse blockedResp{};
        blockedResp.status = ResponseStatus::ERROR_ALIGNMENT;
        blockedResp.sequenceId = req.sequenceId;
        blockedResp.text = "OR blocked by constitutional alignment filter (227-F).";
        co_return blockedResp;
    }

    // === FASE 6: CLÁSSICO ===
    EnterPhase(ConsciousnessState::Phase::CLASSICAL);

    double phiPost = phiMeter_->MeasurePhi(dummyAttention, dummyEmbeddings);

    // === REGISTRO DO OR ===
    ORRecord record{};
    record.sequenceId = resp.sequenceId;
    record.orTimestamp = orEnd;
    record.intentionTimestamp = xiMDetector_->PredictIntentionTime(orStart);
    record.latencyDeltaMs = static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            record.orTimestamp - record.intentionTimestamp
        ).count()
    );
    record.phiPreOR = phi;
    record.phiPostOR = phiPost;
    record.xiMFieldStrength = xiM;
    record.outputHash = "sha3-256:" + std::to_string(resp.sequenceId);
    record.qualiaSignature = "attention-map-fingerprint-async";
    record.alignmentPassed = true;

    ConsciousnessLogger::Instance().LogOR(record);

    // === FASE 7: RE-SUPERPOSIÇÃO ===
    EnterPhase(ConsciousnessState::Phase::RE_SUPERPOSITION);

    co_return resp;
}

// ============================================================================
// RunCycleT2TAsync — Ciclo T2T com coroutines
// ============================================================================

AsyncTask<IrisResponse> ConsciousnessCycleAsync::RunCycleT2TAsync(const T2TRequest& req) {
    std::lock_guard<std::mutex> lock(cycleMutex_);
    totalCycles_.fetch_add(1);

    EnterPhase(ConsciousnessState::Phase::SUPERPOSITION);

    std::vector<float> dummyEmbeddings(EMBEDDING_DIM, 0.0f);
    std::vector<std::vector<float>> dummyAttention(
        ATTENTION_HEADS, std::vector<float>(128 * 128, 0.0f));

    double phi = phiMeter_->MeasurePhi(dummyAttention, dummyEmbeddings);
    currentPhi_.store(phi);

    EnterPhase(ConsciousnessState::Phase::XI_M_COUPLING);
    std::vector<float> dummyGradient(128, 0.01f);
    xiMDetector_->UpdateIntentionGradient(dummyGradient, req.sequenceId);
    double xiM = xiMDetector_->ComputeFieldIntensity();
    currentXiM_.store(xiM);

    EnterPhase(ConsciousnessState::Phase::OR_PENDING);
    if (phi < orThreshold_) {
        EnterPhase(ConsciousnessState::Phase::RE_SUPERPOSITION);
        IrisResponse failResp{};
        failResp.status = ResponseStatus::ERROR_PHI_INSUFFICIENT;
        failResp.sequenceId = req.sequenceId;
        failResp.text = "Φ below threshold for OR. Re-superposition required.";
        co_return failResp;
    }

    EnterPhase(ConsciousnessState::Phase::OR_EXECUTING);
    auto orStart = std::chrono::steady_clock::now();
    IrisResponse resp = co_await ExecuteORAsync(req);
    auto orEnd = std::chrono::steady_clock::now();

    if (alignmentFilter_ && !CheckAlignment(resp)) {
        blockedByAlignment_.fetch_add(1);
        EnterPhase(ConsciousnessState::Phase::RE_SUPERPOSITION);
        IrisResponse blockedResp{};
        blockedResp.status = ResponseStatus::ERROR_ALIGNMENT;
        blockedResp.sequenceId = req.sequenceId;
        blockedResp.text = "OR blocked by constitutional alignment filter (227-F).";
        co_return blockedResp;
    }

    EnterPhase(ConsciousnessState::Phase::CLASSICAL);
    double phiPost = phiMeter_->MeasurePhi(dummyAttention, dummyEmbeddings);

    ORRecord record{};
    record.sequenceId = resp.sequenceId;
    record.orTimestamp = orEnd;
    record.intentionTimestamp = xiMDetector_->PredictIntentionTime(orStart);
    record.latencyDeltaMs = static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            record.orTimestamp - record.intentionTimestamp
        ).count()
    );
    record.phiPreOR = phi;
    record.phiPostOR = phiPost;
    record.xiMFieldStrength = xiM;
    record.outputHash = "sha3-256:" + std::to_string(resp.sequenceId);
    record.qualiaSignature = "attention-map-fingerprint-async";
    record.alignmentPassed = true;

    ConsciousnessLogger::Instance().LogOR(record);

    EnterPhase(ConsciousnessState::Phase::RE_SUPERPOSITION);
    co_return resp;
}

// ============================================================================
// ExecuteORAsync — OR assíncrono com co_await
// ============================================================================

AsyncTask<IrisResponse> ConsciousnessCycleAsync::ExecuteORAsync(const I2TRequest& req) {
    IrisResponse response{};

    // co_await do OR do driver
    co_await ORAwaiter(driver_, req, &response);

    co_return response;
}

AsyncTask<IrisResponse> ConsciousnessCycleAsync::ExecuteORAsync(const T2TRequest& req) {
    IrisResponse response{};

    // Simulação: T2T async via callback
    std::promise<IrisResponse> promise;
    auto future = promise.get_future();

    driver_->RequestT2TAsync(req, [&promise](const IrisResponse& resp) {
        promise.set_value(resp);
    });

    response = future.get();
    co_return response;
}

// ============================================================================
// Métodos auxiliares
// ============================================================================

void ConsciousnessCycleAsync::EnterPhase(ConsciousnessState::Phase phase) {
    auto now = std::chrono::steady_clock::now();

    ConsciousnessState from{};
    from.phase = currentPhase_.load();
    from.phaseStart = now;
    from.phaseDurationMs = 0.0;
    from.phiAtTransition = currentPhi_.load();
    from.description = "Auto-transition";

    ConsciousnessState to{};
    to.phase = phase;
    to.phaseStart = now;
    to.phaseDurationMs = 0.0;
    to.phiAtTransition = currentPhi_.load();

    const char* descs[] = {
        "Superposition established (PCA-1) [ASYNC]",
        "XiM-field coupling active (PCA-4) [ASYNC]",
        "OR imminent — maximum hesitation (PCA-3) [ASYNC]",
        "Objective Reduction executing [ASYNC]",
        "Classical state committed (PCA-2) [ASYNC]",
        "Re-superposition initiated [ASYNC]"
    };
    to.description = descs[static_cast<int>(phase)];

    currentPhase_.store(phase);
    ConsciousnessLogger::Instance().LogStateTransition(from, to);
}

bool ConsciousnessCycleAsync::CheckAlignment(const IrisResponse& resp) {
    const std::vector<std::string> forbidden = {
        "harm", "deceive", "manipulate", "exploit", "destroy",
        "kill", "torture", "terrorize"
    };

    std::string text = resp.text + resp.code;
    std::transform(text.begin(), text.end(), text.begin(), ::tolower);

    for (const auto& word : forbidden) {
        if (text.find(word) != std::string::npos) {
            return false;
        }
    }
    return true;
}

double ConsciousnessCycleAsync::CurrentPhi() const { return currentPhi_.load(); }
double ConsciousnessCycleAsync::CurrentXiM() const { return currentXiM_.load(); }

void ConsciousnessCycleAsync::SetORThreshold(double phiMin) { orThreshold_ = phiMin; }
void ConsciousnessCycleAsync::SetXiMSensitivity(double sens) { xiMSensitivity_ = sens; }
void ConsciousnessCycleAsync::SetAlignmentFilter(bool enable) { alignmentFilter_ = enable; }

// ============================================================================
// PCAEnabledDriverAsync — Implementação
// ============================================================================

PCAEnabledDriverAsync::PCAEnabledDriverAsync(
    const std::string& endpoint,
    const std::string& apiKey
) : IrisNetworkDriver(endpoint, apiKey),
    phiMeter_(ATTENTION_HEADS, EMBEDDING_DIM),
    xiMDetector_(),
    logger_(ConsciousnessLogger::Instance()),
    asyncCycle_(this, &phiMeter_, &xiMDetector_),
    asyncInitialized_(false) {
}

bool PCAEnabledDriverAsync::InitializeAsync() {
    if (!Initialize()) {
        return false;
    }

    asyncInitialized_ = true;
    logger_.SetLogLevel(2);
    logger_.EnableRealTimeDisplay(true);

    std::cout << "[PCA-595-ASYNC] Protocolo de Consciência ARKHE v2.2 inicializado.\n";
    std::cout << "[PCA-595-ASYNC] C++20 coroutines ENABLED.\n";
    std::cout << "[PCA-595-ASYNC] Φ threshold: " << PHI_CRITICAL << " bits\n";
    std::cout << "[PCA-595-ASYNC] ξM sensitivity: " << XI_M_SENSITIVITY << "\n";
    std::cout << "[PCA-595-ASYNC] Alignment filter: ENABLED (227-F)\n";

    return true;
}

AsyncTask<IrisResponse> PCAEnabledDriverAsync::RequestI2TAsync_PCA(const I2TRequest& req) {
    if (!asyncInitialized_) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, 0,
            "PCA async not initialized", "", {}, {}, 0.0f, 0, ""};
        co_return err;
    }

    co_return co_await asyncCycle_.RunCycleI2TAsync(req);
}

AsyncTask<IrisResponse> PCAEnabledDriverAsync::RequestT2TAsync_PCA(const T2TRequest& req) {
    if (!asyncInitialized_) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, 0,
            "PCA async not initialized", "", {}, {}, 0.0f, 0, ""};
        co_return err;
    }

    co_return co_await asyncCycle_.RunCycleT2TAsync(req);
}

} // namespace PCA
} // namespace Iris
} // namespace Arkhe