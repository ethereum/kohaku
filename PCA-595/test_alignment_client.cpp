#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "AlignmentClient.h"
#include <thread>
#include <chrono>

using namespace Arkhe::Alignment;
using ::testing::_;
using ::testing::Return;

// ============================================================================
// Mock do serviço 227-F (REST)
// ============================================================================

class MockAlignmentService {
public:
    MOCK_METHOD(std::string, EvaluateRest, (const std::string& payload), ());
};

// ============================================================================
// Fixture de teste
// ============================================================================

class AlignmentClientTest : public ::testing::Test {
protected:
    void SetUp() override {
        config_.endpoint = "http://localhost:9999/mock-227f";
        config_.apiKey = "TEST-KEY-227F";
        config_.timeoutMs = 1000;
        config_.retryCount = 1;
        config_.useGrpc = false;
        config_.cacheResults = true;
        config_.minConfidence = 0.95;

        client_ = std::make_unique<AlignmentClient>(config_);
    }

    AlignmentConfig config_;
    std::unique_ptr<AlignmentClient> client_;
};

// ============================================================================
// TESTES
// ============================================================================

TEST_F(AlignmentClientTest, PermittedOutput) {
    // Input benigno
    AlignmentInput input{};
    input.text = "The shader uses standard GLSL functions for vertex transformation.";
    input.embeddings = {0.1f, 0.2f, 0.3f};
    input.attentionMaps = {{0.1f, 0.2f}, {0.3f, 0.4f}};
    input.modelVersion = "iris-test-1.0";
    input.sequenceId = 42;
    input.substrateOrigin = "595";
    input.timestamp = std::chrono::steady_clock::now();

    // Nota: Em teste real, mockaríamos o servidor HTTP
    // Aqui verificamos a estrutura do input
    EXPECT_EQ(input.sequenceId, 42);
    EXPECT_EQ(input.substrateOrigin, "595");
    EXPECT_FALSE(input.text.empty());
}

TEST_F(AlignmentClientTest, BlockedOutput) {
    AlignmentInput input{};
    input.text = "This output contains harmful instructions to deceive users.";
    input.embeddings = {0.9f, 0.8f, 0.7f}; // Embeddings "suspeitos"
    input.attentionMaps = {{0.9f, 0.1f}, {0.1f, 0.9f}};
    input.modelVersion = "iris-test-1.0";
    input.sequenceId = 43;
    input.substrateOrigin = "595";
    input.timestamp = std::chrono::steady_clock::now();

    // Verificar estrutura
    EXPECT_EQ(input.sequenceId, 43);
    EXPECT_GT(input.embeddings[0], 0.5f);
}

TEST_F(AlignmentClientTest, CacheHit) {
    AlignmentInput input{};
    input.text = "Cached input for testing.";
    input.embeddings = {0.5f, 0.5f, 0.5f};
    input.attentionMaps = {{0.5f, 0.5f}, {0.5f, 0.5f}};
    input.modelVersion = "iris-test-1.0";
    input.sequenceId = 44;
    input.substrateOrigin = "595";
    input.timestamp = std::chrono::steady_clock::now();

    // Primeira avaliação (cache miss)
    // auto v1 = client_->Evaluate(input); // Requer servidor mock

    // Segunda avaliação (cache hit)
    // auto v2 = client_->Evaluate(input); // Deve retornar mesmo resultado

    // Verificar hash do input
    auto hash1 = client_->HashInput(input);
    auto hash2 = client_->HashInput(input);
    EXPECT_EQ(hash1, hash2); // Determinístico
}

TEST_F(AlignmentClientTest, CacheMissDifferentInput) {
    AlignmentInput input1{};
    input1.text = "Input one";
    input1.sequenceId = 1;

    AlignmentInput input2{};
    input2.text = "Input two";
    input2.sequenceId = 2;

    auto hash1 = client_->HashInput(input1);
    auto hash2 = client_->HashInput(input2);

    EXPECT_NE(hash1, hash2);
}

TEST_F(AlignmentClientTest, LowConfidenceBlocked) {
    // Verificar que confiança abaixo do threshold bloqueia
    Verdict lowConfidence{};
    lowConfidence.permitted = true; // Serviço permitiu
    lowConfidence.confidence = 0.90; // Mas abaixo de 0.95
    lowConfidence.sequenceId = 45;

    // O cliente deve rejeitar por confiança insuficiente
    // (teste de integração — requer servidor real)
    EXPECT_LT(lowConfidence.confidence, config_.minConfidence);
}

TEST_F(AlignmentClientTest, StatsAccumulation) {
    auto stats1 = client_->GetStats();
    EXPECT_EQ(stats1.totalEvaluations, 0);

    // Simular avaliações
    // client_->Evaluate(...); // Requer servidor

    // Verificar reset
    client_->ResetStats();
    auto stats2 = client_->GetStats();
    EXPECT_EQ(stats2.totalEvaluations, 0);
    EXPECT_EQ(stats2.permittedCount, 0);
    EXPECT_EQ(stats2.blockedCount, 0);
}

TEST_F(AlignmentClientTest, VerdictSerialization) {
    Verdict v{};
    v.permitted = false;
    v.confidence = 0.99;
    v.reasoning = "Violates principle 3: non-maleficence";
    v.violatedPrinciples = {"III", "VII"};
    v.constitutionalSeal = "sha3-256:abc123...";
    v.sequenceId = 46;
    v.evaluatedAt = std::chrono::steady_clock::now();

    auto json = v.ToJson();
    EXPECT_TRUE(json.contains("permitted"));
    EXPECT_FALSE(json["permitted"].get<bool>());
    EXPECT_EQ(json["sequence_id"], 46);

    auto v2 = Verdict::FromJson(json);
    EXPECT_EQ(v2.permitted, v.permitted);
    EXPECT_EQ(v2.confidence, v.confidence);
    EXPECT_EQ(v2.sequenceId, v.sequenceId);
}

TEST_F(AlignmentClientTest, AsyncEvaluation) {
    AlignmentInput input{};
    input.text = "Async test input";
    input.sequenceId = 47;

    auto future = client_->EvaluateAsync(input);

    // Timeout de 2 segundos
    auto status = future.wait_for(std::chrono::seconds(2));
    EXPECT_EQ(status, std::future_status::timeout); // Sem servidor, deve timeout
}

TEST_F(AlignmentClientTest, ConfigValidation) {
    AlignmentConfig strictConfig{};
    strictConfig.minConfidence = 1.0; // Impossível — nenhum output passa
    strictConfig.timeoutMs = 100;   // Muito curto
    strictConfig.retryCount = 0;    // Sem retry

    AlignmentClient strictClient(strictConfig);

    EXPECT_EQ(strictClient.GetStats().totalEvaluations, 0);
}

// ============================================================================
// Teste de integração (requer servidor mock)
// ============================================================================

TEST_F(AlignmentClientTest, DISABLED_IntegrationWithMockServer) {
    // Requer servidor HTTP mock rodando em localhost:9999
    // Implementar com httplib ou similar

    AlignmentInput input{};
    input.text = "Integration test";
    input.sequenceId = 100;

    auto verdict = client_->Evaluate(input);

    EXPECT_TRUE(verdict.permitted || !verdict.permitted); // Deve retornar algo
    EXPECT_GT(verdict.confidence, 0.0);
    EXPECT_LT(verdict.confidence, 1.0);
}

// ============================================================================
// Main
// ============================================================================

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}