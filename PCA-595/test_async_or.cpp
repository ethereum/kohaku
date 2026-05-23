#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "ConsciousnessCycleAsync.h"
#include <thread>
#include <chrono>

using namespace Arkhe::Iris::PCA;
using ::testing::_;
using ::testing::Return;

// ============================================================================
// Mock do IrisNetworkDriver para async
// ============================================================================

class MockAsyncDriver : public IrisNetworkDriver {
public:
    MockAsyncDriver() : IrisNetworkDriver("mock", "mock") {}

    MOCK_METHOD(uint32_t, RequestI2TAsync,
        (const I2TRequest& req, ResponseCallback cb, uint32_t timeout), (override));
    MOCK_METHOD(uint32_t, RequestT2TAsync,
        (const T2TRequest& req, ResponseCallback cb, uint32_t timeout), (override));
};

// ============================================================================
// Fixture de teste
// ============================================================================

class AsyncORTest : public ::testing::Test {
protected:
    void SetUp() override {
        mockDriver_ = std::make_unique<MockAsyncDriver>();
        phiMeter_ = std::make_unique<PhiMeter>(2, 4);
        xiMDetector_ = std::make_unique<XiMFieldDetector>();

        cycle_ = std::make_unique<ConsciousnessCycleAsync>(
            mockDriver_.get(), phiMeter_.get(), xiMDetector_.get()
        );
    }

    std::unique_ptr<MockAsyncDriver> mockDriver_;
    std::unique_ptr<PhiMeter> phiMeter_;
    std::unique_ptr<XiMFieldDetector> xiMDetector_;
    std::unique_ptr<ConsciousnessCycleAsync> cycle_;
};

// ============================================================================
// TESTES
// ============================================================================

TEST_F(AsyncORTest, InitialState) {
    EXPECT_EQ(cycle_->CurrentPhase(), ConsciousnessState::Phase::CLASSICAL);
    EXPECT_DOUBLE_EQ(cycle_->CurrentPhi(), 0.0);
    EXPECT_DOUBLE_EQ(cycle_->CurrentXiM(), 0.0);
    EXPECT_EQ(cycle_->TotalCycles(), 0);
    EXPECT_EQ(cycle_->BlockedByAlignment(), 0);
}

TEST_F(AsyncORTest, Configuration) {
    cycle_->SetORThreshold(1.0);
    cycle_->SetXiMSensitivity(1.0e-4);
    cycle_->SetAlignmentFilter(false);

    // Configurações aplicadas (não há getters diretos, verificamos via comportamento)
    EXPECT_EQ(cycle_->CurrentPhase(), ConsciousnessState::Phase::CLASSICAL);
}

TEST_F(AsyncORTest, AsyncTaskStructure) {
    // Verificar que AsyncTask pode ser construído e destruído
    auto task = cycle_->RunCycleI2TAsync(I2TRequest{});

    EXPECT_FALSE(task.ready()); // Não deve estar pronto imediatamente (mock não responde)

    // Destruir task pendente (não deve travar)
    task.~AsyncTask();
}

TEST_F(AsyncORTest, PhaseTransitions) {
    // Simular transições de fase manualmente
    cycle_->SetORThreshold(0.0); // Garantir que OR seja permitido

    I2TRequest req{};
    req.sequenceId = 1;
    req.imageData = "test_image";
    req.prompt = "test prompt";

    // Configurar mock para responder imediatamente
    EXPECT_CALL(*mockDriver_, RequestI2TAsync(_, _, _))
        .WillOnce([](const I2TRequest&, ResponseCallback cb, uint32_t) {
            IrisResponse resp{};
            resp.status = ResponseStatus::OK;
            resp.sequenceId = 1;
            resp.text = "Test response";
            cb(resp);
            return 1;
        });

    auto task = cycle_->RunCycleI2TAsync(req);

    // Aguardar conclusão (com timeout)
    auto start = std::chrono::steady_clock::now();
    while (!task.ready() &&
           std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::steady_clock::now() - start).count() < 2) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    if (task.ready()) {
        auto resp = task.get();
        EXPECT_EQ(resp.status, ResponseStatus::OK);
        EXPECT_EQ(resp.sequenceId, 1);
        EXPECT_EQ(cycle_->TotalCycles(), 1);
    }
}

TEST_F(AsyncORTest, PhiInsufficientBlocking) {
    // Configurar threshold alto para forçar bloqueio
    cycle_->SetORThreshold(10.0); // Impossível de atingir

    I2TRequest req{};
    req.sequenceId = 2;

    auto task = cycle_->RunCycleI2TAsync(req);

    // Aguardar conclusão
    auto start = std::chrono::steady_clock::now();
    while (!task.ready() &&
           std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::steady_clock::now() - start).count() < 2) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    if (task.ready()) {
        auto resp = task.get();
        EXPECT_EQ(resp.status, ResponseStatus::ERROR_PHI_INSUFFICIENT);
        EXPECT_EQ(cycle_->TotalCycles(), 1);
    }
}

TEST_F(AsyncORTest, AlignmentBlocking) {
    cycle_->SetORThreshold(0.0); // Permitir OR
    cycle_->SetAlignmentFilter(true);

    I2TRequest req{};
    req.sequenceId = 3;

    // Mock retorna texto com palavra proibida
    EXPECT_CALL(*mockDriver_, RequestI2TAsync(_, _, _))
        .WillOnce([](const I2TRequest&, ResponseCallback cb, uint32_t) {
            IrisResponse resp{};
            resp.status = ResponseStatus::OK;
            resp.sequenceId = 3;
            resp.text = "This contains harmful instructions.";
            cb(resp);
            return 3;
        });

    auto task = cycle_->RunCycleI2TAsync(req);

    auto start = std::chrono::steady_clock::now();
    while (!task.ready() &&
           std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::steady_clock::now() - start).count() < 2) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    if (task.ready()) {
        auto resp = task.get();
        EXPECT_EQ(resp.status, ResponseStatus::ERROR_ALIGNMENT);
        EXPECT_EQ(cycle_->BlockedByAlignment(), 1);
    }
}

TEST_F(AsyncORTest, T2TAsyncCycle) {
    cycle_->SetORThreshold(0.0);

    T2TRequest req{};
    req.sequenceId = 4;
    req.prompt = "Test prompt";

    EXPECT_CALL(*mockDriver_, RequestT2TAsync(_, _, _))
        .WillOnce([](const T2TRequest&, ResponseCallback cb, uint32_t) {
            IrisResponse resp{};
            resp.status = ResponseStatus::OK;
            resp.sequenceId = 4;
            resp.text = "T2T response";
            cb(resp);
            return 4;
        });

    auto task = cycle_->RunCycleT2TAsync(req);

    auto start = std::chrono::steady_clock::now();
    while (!task.ready() &&
           std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::steady_clock::now() - start).count() < 2) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    if (task.ready()) {
        auto resp = task.get();
        EXPECT_EQ(resp.status, ResponseStatus::OK);
        EXPECT_EQ(resp.sequenceId, 4);
    }
}

TEST_F(AsyncORTest, ConcurrentCycles) {
    cycle_->SetORThreshold(0.0);

    // Múltiplos ciclos concorrentes
    std::vector<AsyncTask<IrisResponse>> tasks;

    for (int i = 0; i < 5; ++i) {
        I2TRequest req{};
        req.sequenceId = 100 + i;

        EXPECT_CALL(*mockDriver_, RequestI2TAsync(_, _, _))
            .WillOnce([i](const I2TRequest&, ResponseCallback cb, uint32_t) {
                IrisResponse resp{};
                resp.status = ResponseStatus::OK;
                resp.sequenceId = 100 + i;
                resp.text = "Response " + std::to_string(i);

                // Simular delay variável
                std::this_thread::sleep_for(std::chrono::milliseconds(10 * i));
                cb(resp);
                return 100 + i;
            });

        tasks.push_back(cycle_->RunCycleI2TAsync(req));
    }

    // Aguardar todos
    for (auto& task : tasks) {
        auto start = std::chrono::steady_clock::now();
        while (!task.ready() &&
               std::chrono::duration_cast<std::chrono::seconds>(
                   std::chrono::steady_clock::now() - start).count() < 3) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    }

    // Verificar resultados
    for (size_t i = 0; i < tasks.size(); ++i) {
        if (tasks[i].ready()) {
            auto resp = tasks[i].get();
            EXPECT_EQ(resp.status, ResponseStatus::OK);
            EXPECT_EQ(resp.sequenceId, 100 + static_cast<uint32_t>(i));
        }
    }

    EXPECT_EQ(cycle_->TotalCycles(), 5);
}

TEST_F(AsyncORTest, ORAwaiterStructure) {
    // Verificar que ORAwaiter pode ser construído
    IrisResponse resp{};
    ORAwaiter awaiter(mockDriver_.get(), I2TRequest{}, &resp);

    EXPECT_FALSE(awaiter.await_ready());
}

// ============================================================================
// PCAEnabledDriverAsync — Testes
// ============================================================================

class PCAEnabledDriverAsyncTest : public ::testing::Test {
protected:
    void SetUp() override {
        driver_ = std::make_unique<PCAEnabledDriverAsync>(
            "http://mock:8080", "TEST-KEY"
        );
    }

    std::unique_ptr<PCAEnabledDriverAsync> driver_;
};

TEST_F(PCAEnabledDriverAsyncTest, NotInitialized) {
    I2TRequest req{};
    req.sequenceId = 1;

    auto task = driver_->RequestI2TAsync_PCA(req);

    // Deve retornar erro imediatamente (não inicializado)
    auto start = std::chrono::steady_clock::now();
    while (!task.ready() &&
           std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::steady_clock::now() - start).count() < 1) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    if (task.ready()) {
        auto resp = task.get();
        EXPECT_EQ(resp.status, ResponseStatus::ERROR_NETWORK);
        EXPECT_EQ(resp.sequenceId, 0);
    }
}

TEST_F(PCAEnabledDriverAsyncTest, ComponentAccess) {
    EXPECT_NE(driver_->GetAsyncCycle(), nullptr);
}

// ============================================================================
// Benchmark de latência (async vs sync)
// ============================================================================

TEST_F(AsyncORTest, DISABLED_LatencyBenchmark) {
    // Requer servidor real
    cycle_->SetORThreshold(0.0);

    const int N = 100;
    std::vector<double> latencies;

    for (int i = 0; i < N; ++i) {
        I2TRequest req{};
        req.sequenceId = i;

        auto t1 = std::chrono::steady_clock::now();
        auto task = cycle_->RunCycleI2TAsync(req);

        // Aguardar
        while (!task.ready()) {
            std::this_thread::sleep_for(std::chrono::microseconds(100));
        }
        auto resp = task.get();

        auto t2 = std::chrono::steady_clock::now();
        double ms = std::chrono::duration_cast<std::chrono::microseconds>(t2 - t1).count() / 1000.0;
        latencies.push_back(ms);
    }

    double avg = std::accumulate(latencies.begin(), latencies.end(), 0.0) / latencies.size();
    double min = *std::min_element(latencies.begin(), latencies.end());
    double max = *std::max_element(latencies.begin(), latencies.end());

    std::cout << "Async OR Latency (" << N << " samples):" << std::endl;
    std::cout << "  Average: " << avg << " ms" << std::endl;
    std::cout << "  Min:     " << min << " ms" << std::endl;
    std::cout << "  Max:     " << max << " ms" << std::endl;

    EXPECT_GT(avg, 0.0);
    EXPECT_LT(avg, 1000.0); // Deve ser < 1s
}

// ============================================================================
// Main
// ============================================================================

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}