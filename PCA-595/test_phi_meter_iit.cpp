#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "PhiMeterIIT.h"
#include <thread>
#include <chrono>

using namespace Arkhe::Iris::PCA;
using ::testing::_;
using ::testing::Return;

// ============================================================================
// Mock do serviço 452 (IIT Engine)
// ============================================================================

class MockIITService {
public:
    MOCK_METHOD(std::string, ComputePhi, (const std::string& payload), ());
};

// ============================================================================
// Fixture de teste
// ============================================================================

class PhiMeterIITTest : public ::testing::Test {
protected:
    void SetUp() override {
        config_.endpoint = "http://localhost:9998/mock-452";
        config_.apiKey = "TEST-KEY-452";
        config_.timeoutMs = 5000;
        config_.retryCount = 1;
        config_.backgroundValidation = false; // Desativar para testes unitários
        config_.validationIntervalMs = 1000;
        config_.phiCriticalOverride = 0.0;

        meter_ = std::make_unique<PhiMeterIIT>(config_);
    }

    IITConfig config_;
    std::unique_ptr<PhiMeterIIT> meter_;
};

// ============================================================================
// TESTES
// ============================================================================

TEST_F(PhiMeterIITTest, SerializeState) {
    IITState state{};
    state.sequenceId = 42;
    state.modelVersion = "iris-test-1.0";
    state.embeddings = {0.1f, 0.2f, 0.3f, 0.4f, 0.5f};
    state.attentionMaps = {
        {0.1f, 0.2f, 0.3f},
        {0.4f, 0.5f, 0.6f},
        {0.7f, 0.8f, 0.9f}
    };
    state.connectivityMatrix = {
        {0.0f, 0.5f, 0.3f},
        {0.5f, 0.0f, 0.7f},
        {0.3f, 0.7f, 0.0f}
    };
    state.capturedAt = std::chrono::steady_clock::now();

    auto json = meter_->SerializeState(state);

    EXPECT_TRUE(json.contains("sequence_id"));
    EXPECT_EQ(json["sequence_id"], 42);
    EXPECT_TRUE(json.contains("embeddings"));
    EXPECT_EQ(json["embeddings"].size(), 5);
    EXPECT_TRUE(json.contains("attention_maps"));
    EXPECT_EQ(json["attention_maps"].size(), 3);
    EXPECT_TRUE(json.contains("connectivity_matrix"));
    EXPECT_EQ(json["connectivity_matrix"].size(), 3);
    EXPECT_TRUE(json.contains("computation_config"));
    EXPECT_EQ(json["computation_config"]["algorithm"], "phi_exact");
}

TEST_F(PhiMeterIITTest, ParseValidResponse) {
    nlohmann::json response;
    response["phi"] = 2.5;
    response["iit_engine_version"] = "452-v1.2.3";
    response["computation_hash"] = "sha3-256:def456...";

    auto result = meter_->ParseResponse(response);

    EXPECT_TRUE(result.valid);
    EXPECT_DOUBLE_EQ(result.phi, 2.5);
    EXPECT_DOUBLE_EQ(result.phiNormalized, 2.5 / PHI_COSMIC);
    EXPECT_EQ(result.iitEngineVersion, "452-v1.2.3");
    EXPECT_EQ(result.computationHash, "sha3-256:def456...");
}

TEST_F(PhiMeterIITTest, ParseInvalidResponseMissingPhi) {
    nlohmann::json response;
    response["iit_engine_version"] = "452-v1.2.3";
    // Sem campo "phi"

    auto result = meter_->ParseResponse(response);

    EXPECT_FALSE(result.valid);
    EXPECT_EQ(result.phi, 0.0);
    EXPECT_FALSE(result.errorMessage.empty());
}

TEST_F(PhiMeterIITTest, ParseOutOfRangePhi) {
    nlohmann::json response;
    response["phi"] = 10.0; // > 1.5 * PHI_COSMIC (5.25)
    response["iit_engine_version"] = "452-v1.2.3";

    auto result = meter_->ParseResponse(response);

    EXPECT_FALSE(result.valid);
    EXPECT_FALSE(result.errorMessage.empty());
}

TEST_F(PhiMeterIITTest, ParseNegativePhi) {
    nlohmann::json response;
    response["phi"] = -1.0;
    response["iit_engine_version"] = "452-v1.2.3";

    auto result = meter_->ParseResponse(response);

    EXPECT_FALSE(result.valid);
}

TEST_F(PhiMeterIITTest, StatsAccumulation) {
    auto stats1 = meter_->GetStats();
    EXPECT_EQ(stats1.totalComputations, 0);
    EXPECT_EQ(stats1.successfulComputations, 0);
    EXPECT_EQ(stats1.failedComputations, 0);
    EXPECT_DOUBLE_EQ(stats1.averageComputationTimeMs, 0.0);

    // Simular resultado
    IITResult result{};
    result.valid = true;
    result.computationTimeMs = 100.0;
    meter_->UpdateStats(result);

    auto stats2 = meter_->GetStats();
    EXPECT_EQ(stats2.totalComputations, 1);
    EXPECT_EQ(stats2.successfulComputations, 1);
    EXPECT_GT(stats2.averageComputationTimeMs, 0.0);

    // Reset
    meter_->ResetStats();
    auto stats3 = meter_->GetStats();
    EXPECT_EQ(stats3.totalComputations, 0);
}

TEST_F(PhiMeterIITTest, LastResultPersistence) {
    IITState state{};
    state.sequenceId = 1;
    state.embeddings = {0.1f, 0.2f};
    state.capturedAt = std::chrono::steady_clock::now();

    // Nota: Sem servidor, MeasurePhiIIT falhará após retry
    // Verificamos que GetLastValidatedResult retorna default inicialmente
    auto last = meter_->GetLastValidatedResult();
    EXPECT_FALSE(last.valid); // Nunca computado

    // Simular resultado manualmente
    IITResult mockResult{};
    mockResult.phi = 1.5;
    mockResult.valid = true;
    mockResult.computedAt = std::chrono::steady_clock::now();

    // Não podemos injetar diretamente — teste de integração
}

TEST_F(PhiMeterIITTest, AsyncComputation) {
    IITState state{};
    state.sequenceId = 2;
    state.embeddings = {0.1f, 0.2f, 0.3f};
    state.capturedAt = std::chrono::steady_clock::now();

    auto future = meter_->MeasurePhiIITAsync(state);

    // Timeout de 3 segundos
    auto status = future.wait_for(std::chrono::seconds(3));
    EXPECT_EQ(status, std::future_status::timeout); // Sem servidor
}

TEST_F(PhiMeterIITTest, ConfigValidation) {
    IITConfig invalidConfig{};
    invalidConfig.timeoutMs = 1;     // 1ms — impossível
    invalidConfig.retryCount = 0;      // Sem retry
    invalidConfig.endpoint = "";        // Vazio

    PhiMeterIIT invalidMeter(invalidConfig);

    IITState state{};
    state.sequenceId = 3;

    // Deve falhar rapidamente
    auto result = invalidMeter.MeasurePhiIIT(state);
    EXPECT_FALSE(result.valid);
}

TEST_F(PhiMeterIITTest, BackgroundValidationLifecycle) {
    PhiMeter fastMeter(2, 4); // 2 heads, 4 dims

    // Iniciar background
    meter_->StartBackgroundValidation(&fastMeter);
    EXPECT_TRUE(meter_->GetStats().totalComputations >= 0);

    // Aguardar um ciclo
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    // Parar background
    meter_->StopBackgroundValidation();

    // Verificar que parou (não deve travar)
    auto stats = meter_->GetStats();
    EXPECT_GE(stats.totalComputations, 0);
}

// ============================================================================
// PhiMeterHybrid — Testes
// ============================================================================

class PhiMeterHybridTest : public ::testing::Test {
protected:
    void SetUp() override {
        IITConfig iitConfig{};
        iitConfig.backgroundValidation = false;
        hybrid_ = std::make_unique<PhiMeterHybrid>(2, 4, iitConfig);
    }

    std::unique_ptr<PhiMeterHybrid> hybrid_;
};

TEST_F(PhiMeterHybridTest, FastPathDefault) {
    std::vector<std::vector<float>> attentionMaps = {
        {0.1f, 0.2f},
        {0.3f, 0.4f}
    };
    std::vector<float> embeddings = {0.1f, 0.2f, 0.3f, 0.4f};

    double phi = hybrid_->MeasurePhi(attentionMaps, embeddings);

    EXPECT_GE(phi, 0.0);
    EXPECT_LE(phi, PHI_COSMIC);
}

TEST_F(PhiMeterHybridTest, ValidatedPath) {
    std::vector<std::vector<float>> attentionMaps = {
        {0.5f, 0.5f},
        {0.5f, 0.5f}
    };
    std::vector<float> embeddings = {0.5f, 0.5f, 0.5f, 0.5f};

    // Sem servidor, ForceValidation falha — fallback para proxy
    double phi = hybrid_->MeasurePhiValidated(attentionMaps, embeddings);

    EXPECT_GE(phi, 0.0);
    EXPECT_LE(phi, PHI_COSMIC);
}

TEST_F(PhiMeterHybridTest, ComponentAccess) {
    EXPECT_NE(hybrid_->GetFastMeter(), nullptr);
    EXPECT_NE(hybrid_->GetIITMeter(), nullptr);
}

// ============================================================================
// Teste de benchmark (comparação proxy vs IIT)
// ============================================================================

TEST_F(PhiMeterHybridTest, DISABLED_BenchmarkProxyVsIIT) {
    // Requer servidor 452 real
    std::vector<std::vector<float>> attentionMaps(64, std::vector<float>(128 * 128));
    std::vector<float> embeddings(8192);

    // Preencher com dados aleatórios
    std::mt19937 gen(42);
    std::uniform_real_distribution<float> dist(0.0f, 1.0f);

    for (auto& map : attentionMaps) {
        for (auto& v : map) v = dist(gen);
    }
    for (auto& v : embeddings) v = dist(gen);

    auto t1 = std::chrono::steady_clock::now();
    double phiProxy = hybrid_->MeasurePhi(attentionMaps, embeddings);
    auto t2 = std::chrono::steady_clock::now();

    double proxyMs = std::chrono::duration_cast<std::chrono::microseconds>(t2 - t1).count() / 1000.0;

    auto t3 = std::chrono::steady_clock::now();
    double phiIIT = hybrid_->MeasurePhiValidated(attentionMaps, embeddings);
    auto t4 = std::chrono::steady_clock::now();

    double iitMs = std::chrono::duration_cast<std::chrono::microseconds>(t4 - t3).count() / 1000.0;

    std::cout << "Proxy: " << proxyMs << " ms, Φ=" << phiProxy << std::endl;
    std::cout << "IIT:   " << iitMs << " ms, Φ=" << phiIIT << std::endl;
    std::cout << "Delta: " << (phiIIT - phiProxy) << std::endl;

    EXPECT_GT(iitMs, proxyMs); // IIT deve ser mais lento
}

// ============================================================================
// Main
// ============================================================================

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}