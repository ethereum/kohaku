// ============================================================================
// IrisDriverAdapter.h
// Adapter para linkagem com IrisNetworkDriver real (Substrato 595)
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 2.3 (STRICT MODE)
// ============================================================================

#pragma once

#include "PCA-595.h"
#include <memory>
#include <dlfcn.h>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// Estruturas do driver real (forward declarations)
// ============================================================================

struct IrisDriverHandle;
using IrisDriverCreateFunc = IrisDriverHandle* (*)(const char* endpoint, const char* apiKey);
using IrisDriverDestroyFunc = void (*)(IrisDriverHandle*);
using IrisDriverRequestI2TFunc = int (*)(IrisDriverHandle*, const void* req, void* resp, uint32_t timeout);
using IrisDriverRequestT2TFunc = int (*)(IrisDriverHandle*, const void* req, void* resp, uint32_t timeout);
using IrisDriverRequestI2TAsyncFunc = int (*)(IrisDriverHandle*, const void* req, void (*callback)(void* ctx, const void* resp), void* ctx, uint32_t timeout);
using IrisDriverRequestT2TAsyncFunc = int (*)(IrisDriverHandle*, const void* req, void (*callback)(void* ctx, const void* resp), void* ctx, uint32_t timeout);

// ============================================================================
// IrisDriverAdapter — Carregamento dinâmico do driver real
// ============================================================================

class IrisDriverAdapter : public IrisNetworkDriver {
public:
    explicit IrisDriverAdapter(
        const std::string& libPath = "/usr/lib/arkhe/libiris_network_driver.so",
        const std::string& endpoint = "http://iris.arkhe-os.svc.cluster.local:8080",
        const std::string& apiKey = "ARKHE-IRIS-595"
    );

    ~IrisDriverAdapter() override;

    bool Initialize() override;
    void Shutdown() override;

    // Síncrono
    IrisResponse RequestI2TSync(const I2TRequest& req, uint32_t timeout) override;
    IrisResponse RequestT2TSync(const T2TRequest& req, uint32_t timeout) override;

    // Assíncrono
    uint32_t RequestI2TAsync(const I2TRequest& req, ResponseCallback cb, uint32_t timeout) override;
    uint32_t RequestT2TAsync(const T2TRequest& req, ResponseCallback cb, uint32_t timeout) override;

    // Informações do driver
    struct DriverInfo {
        std::string version;
        std::string buildDate;
        std::string gitCommit;
        bool supportsAsync;
        bool supportsStreaming;
        uint32_t maxBatchSize;
    };
    DriverInfo GetDriverInfo() const;

    // Health check
    bool HealthCheck();

    // Estatísticas do driver
    struct DriverStats {
        uint64_t totalRequests;
        uint64_t failedRequests;
        double averageLatencyMs;
        uint32_t activeConnections;
    };
    DriverStats GetDriverStats() const;

private:
    std::string libPath_;
    std::string endpoint_;
    std::string apiKey_;

    void* libHandle_ = nullptr;
    IrisDriverHandle* driverHandle_ = nullptr;

    // Funções do driver
    IrisDriverCreateFunc createFunc_ = nullptr;
    IrisDriverDestroyFunc destroyFunc_ = nullptr;
    IrisDriverRequestI2TFunc requestI2TSyncFunc_ = nullptr;
    IrisDriverRequestT2TFunc requestT2TSyncFunc_ = nullptr;
    IrisDriverRequestI2TAsyncFunc requestI2TAsyncFunc_ = nullptr;
    IrisDriverRequestT2TAsyncFunc requestT2TAsyncFunc_ = nullptr;

    bool LoadLibrary();
    void UnloadLibrary();

    // Callback wrapper para async
    struct AsyncCallbackContext {
        ResponseCallback userCallback;
        uint32_t sequenceId;
    };
    static void AsyncCallbackWrapper(void* ctx, const void* resp);
};

} // namespace PCA
} // namespace Iris
} // namespace Arkhe
