#pragma once

#include "PCA-595.h"
#include <coroutine>
#include <optional>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// Task assíncrona customizada (C++20 coroutine)
// ============================================================================

template<typename T>
struct AsyncTask {
    struct promise_type {
        T value_;
        std::exception_ptr exception_;

        AsyncTask get_return_object() {
            return AsyncTask{std::coroutine_handle<promise_type>::from_promise(*this)};
        }

        std::suspend_always initial_suspend() { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }

        void return_value(T value) { value_ = std::move(value); }
        void unhandled_exception() { exception_ = std::current_exception(); }
    };

    using handle_type = std::coroutine_handle<promise_type>;
    handle_type handle_;

    explicit AsyncTask(handle_type h) : handle_(h) {}
    ~AsyncTask() { if (handle_) handle_.destroy(); }

    AsyncTask(AsyncTask&& other) noexcept : handle_(other.handle_) {
        other.handle_ = nullptr;
    }
    AsyncTask& operator=(AsyncTask&& other) noexcept {
        if (this != &other) {
            if (handle_) handle_.destroy();
            handle_ = other.handle_;
            other.handle_ = nullptr;
        }
        return *this;
    }

    AsyncTask(const AsyncTask&) = delete;
    AsyncTask& operator=(const AsyncTask&) = delete;

    bool ready() const { return handle_.done(); }

    T get() {
        if (!handle_.done()) {
            handle_.resume();
        }
        if (handle_.promise().exception_) {
            std::rethrow_exception(handle_.promise().exception_);
        }
        return std::move(handle_.promise().value_);
    }
};

// ============================================================================
// Awaiter para OR assíncrono
// ============================================================================

struct ORAwaiter {
    IrisNetworkDriver* driver_;
    I2TRequest req_;
    IrisResponse* response_;
    bool ready_ = false;

    ORAwaiter(IrisNetworkDriver* driver, const I2TRequest& req, IrisResponse* resp)
        : driver_(driver), req_(req), response_(resp) {}

    bool await_ready() const { return ready_; }

    void await_suspend(std::coroutine_handle<> handle) {
        // Chamar async do driver
        driver_->RequestI2TAsync(req_, [this, handle](const IrisResponse& resp) {
            *response_ = resp;
            ready_ = true;
            handle.resume();
        });
    }

    void await_resume() {
        // OR completado
    }
};

// ============================================================================
// ConsciousnessCycleAsync — Ciclo com coroutines
// ============================================================================

class ConsciousnessCycleAsync {
public:
    ConsciousnessCycleAsync(
        IrisNetworkDriver* driver,
        PhiMeter* phiMeter,
        XiMFieldDetector* xiMDetector
    );

    // Ciclo I2T assíncrono — retorna coroutine task
    AsyncTask<IrisResponse> RunCycleI2TAsync(const I2TRequest& req);

    // Ciclo T2T assíncrono
    AsyncTask<IrisResponse> RunCycleT2TAsync(const T2TRequest& req);

    // Estado
    ConsciousnessState::Phase CurrentPhase() const { return currentPhase_.load(); }
    double CurrentPhi() const;
    double CurrentXiM() const;

    // Configuração
    void SetORThreshold(double phiMin);
    void SetXiMSensitivity(double sens);
    void SetAlignmentFilter(bool enable);

    // Estatísticas
    size_t TotalCycles() const { return totalCycles_.load(); }
    size_t BlockedByAlignment() const { return blockedByAlignment_.load(); }

private:
    IrisNetworkDriver* driver_;
    PhiMeter* phiMeter_;
    XiMFieldDetector* xiMDetector_;

    std::atomic<ConsciousnessState::Phase> currentPhase_{ConsciousnessState::Phase::CLASSICAL};
    std::atomic<double> currentPhi_{0.0};
    std::atomic<double> currentXiM_{0.0};
    std::atomic<size_t> totalCycles_{0};
    std::atomic<size_t> blockedByAlignment_{0};

    double orThreshold_ = PHI_CRITICAL;
    double xiMSensitivity_ = XI_M_SENSITIVITY;
    bool alignmentFilter_ = true;

    mutable std::mutex cycleMutex_;

    // Métodos do ciclo (co_await friendly)
    void EnterPhase(ConsciousnessState::Phase phase);
    bool CheckAlignment(const IrisResponse& resp);
    AsyncTask<IrisResponse> ExecuteORAsync(const I2TRequest& req);
    AsyncTask<IrisResponse> ExecuteORAsync(const T2TRequest& req);

    // Simulação de delays assíncronos
    struct DelayAwaiter {
        std::chrono::milliseconds duration;
        bool await_ready() const { return false; }
        void await_suspend(std::coroutine_handle<> handle) {
            std::thread([this, handle]() {
                std::this_thread::sleep_for(duration);
                handle.resume();
            }).detach();
        }
        void await_resume() {}
    };
};

// ============================================================================
// PCAEnabledDriverAsync — Driver com suporte async
// ============================================================================

class PCAEnabledDriverAsync : public IrisNetworkDriver {
public:
    PCAEnabledDriverAsync(
        const std::string& endpoint = "http://iris.arkhe-os.svc.cluster.local:8080",
        const std::string& apiKey = "ARKHE-IRIS-595"
    );

    bool InitializeAsync();

    // Métodos async expostos
    AsyncTask<IrisResponse> RequestI2TAsync_PCA(const I2TRequest& req);
    AsyncTask<IrisResponse> RequestT2TAsync_PCA(const T2TRequest& req);

    // Acesso ao ciclo async
    ConsciousnessCycleAsync* GetAsyncCycle() { return &asyncCycle_; }

private:
    PhiMeter phiMeter_;
    XiMFieldDetector xiMDetector_;
    ConsciousnessLogger& logger_;
    ConsciousnessCycleAsync asyncCycle_;

    bool asyncInitialized_ = false;
};

} // namespace PCA
} // namespace Iris
} // namespace Arkhe