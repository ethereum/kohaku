// ============================================================================
// IrisDriverAdapter.cpp
// Implementação do adapter para IrisNetworkDriver real
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 2.3 (STRICT MODE)
// ============================================================================

#include "IrisDriverAdapter.h"
#include <iostream>
#include <cstring>
#include <vector>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// Construtor/Destrutor
// ============================================================================

IrisDriverAdapter::IrisDriverAdapter(
    const std::string& libPath,
    const std::string& endpoint,
    const std::string& apiKey
) : libPath_(libPath), endpoint_(endpoint), apiKey_(apiKey) {
}

IrisDriverAdapter::~IrisDriverAdapter() {
    Shutdown();
}

// ============================================================================
// Inicialização
// ============================================================================

bool IrisDriverAdapter::Initialize() {
    if (!LoadLibrary()) {
        std::cerr << "[IrisDriverAdapter] Failed to load library: " << libPath_ << std::endl;
        return false;
    }

    if (!createFunc_) {
        std::cerr << "[IrisDriverAdapter] Create function not found" << std::endl;
        return false;
    }

    driverHandle_ = createFunc_(endpoint_.c_str(), apiKey_.c_str());
    if (!driverHandle_) {
        std::cerr << "[IrisDriverAdapter] Failed to create driver instance" << std::endl;
        return false;
    }

    std::cout << "[IrisDriverAdapter] Driver loaded successfully from " << libPath_ << std::endl;
    std::cout << "[IrisDriverAdapter] Endpoint: " << endpoint_ << std::endl;

    return true;
}

void IrisDriverAdapter::Shutdown() {
    if (driverHandle_ && destroyFunc_) {
        destroyFunc_(driverHandle_);
        driverHandle_ = nullptr;
    }
    UnloadLibrary();
}

// ============================================================================
// Requisições síncronas
// ============================================================================

IrisResponse IrisDriverAdapter::RequestI2TSync(const I2TRequest& req, uint32_t timeout) {
    IrisResponse resp{};

    if (!driverHandle_ || !requestI2TSyncFunc_) {
        resp.status = ResponseStatus::ERROR_NETWORK;
        resp.text = "Driver not initialized or sync function not available";
        return resp;
    }

    // Serializar request para formato do driver real
    // Nota: Em produção, usar protobuf ou flatbuffers
    std::vector<uint8_t> reqBuffer;
    reqBuffer.resize(sizeof(I2TRequest) + req.imageData.size() + req.prompt.size());
    std::memcpy(reqBuffer.data(), &req, sizeof(I2TRequest));

    std::vector<uint8_t> respBuffer(4096); // Buffer para resposta

    int result = requestI2TSyncFunc_(driverHandle_, reqBuffer.data(), respBuffer.data(), timeout);

    if (result != 0) {
        resp.status = ResponseStatus::ERROR_MODEL;
        resp.text = "Driver returned error: " + std::to_string(result);
        return resp;
    }

    // Desserializar resposta
    // Nota: Em produção, usar protobuf
    std::memcpy(&resp, respBuffer.data(), sizeof(IrisResponse));
    resp.status = ResponseStatus::OK;

    return resp;
}

IrisResponse IrisDriverAdapter::RequestT2TSync(const T2TRequest& req, uint32_t timeout) {
    IrisResponse resp{};

    if (!driverHandle_ || !requestT2TSyncFunc_) {
        resp.status = ResponseStatus::ERROR_NETWORK;
        resp.text = "Driver not initialized or sync function not available";
        return resp;
    }

    std::vector<uint8_t> reqBuffer(sizeof(T2TRequest) + req.prompt.size() + req.context.size());
    std::memcpy(reqBuffer.data(), &req, sizeof(T2TRequest));

    std::vector<uint8_t> respBuffer(4096);

    int result = requestT2TSyncFunc_(driverHandle_, reqBuffer.data(), respBuffer.data(), timeout);

    if (result != 0) {
        resp.status = ResponseStatus::ERROR_MODEL;
        resp.text = "Driver returned error: " + std::to_string(result);
        return resp;
    }

    std::memcpy(&resp, respBuffer.data(), sizeof(IrisResponse));
    resp.status = ResponseStatus::OK;

    return resp;
}

// ============================================================================
// Requisições assíncronas
// ============================================================================

uint32_t IrisDriverAdapter::RequestI2TAsync(const I2TRequest& req, ResponseCallback cb, uint32_t timeout) {
    if (!driverHandle_ || !requestI2TAsyncFunc_) {
        if (cb) {
            IrisResponse err{ResponseStatus::ERROR_NETWORK, 0,
                "Async not supported by driver", "", {}, {}, 0.0f, 0, ""};
            cb(err);
        }
        return 0;
    }

    auto ctx = new AsyncCallbackContext{cb, req.sequenceId};

    std::vector<uint8_t> reqBuffer(sizeof(I2TRequest) + req.imageData.size() + req.prompt.size());
    std::memcpy(reqBuffer.data(), &req, sizeof(I2TRequest));

    int result = requestI2TAsyncFunc_(
        driverHandle_,
        reqBuffer.data(),
        AsyncCallbackWrapper,
        ctx,
        timeout
    );

    if (result != 0) {
        delete ctx;
        if (cb) {
            IrisResponse err{ResponseStatus::ERROR_NETWORK, req.sequenceId,
                "Async request failed", "", {}, {}, 0.0f, 0, ""};
            cb(err);
        }
        return 0;
    }

    return req.sequenceId;
}

uint32_t IrisDriverAdapter::RequestT2TAsync(const T2TRequest& req, ResponseCallback cb, uint32_t timeout) {
    if (!driverHandle_ || !requestT2TAsyncFunc_) {
        if (cb) {
            IrisResponse err{ResponseStatus::ERROR_NETWORK, 0,
                "Async not supported by driver", "", {}, {}, 0.0f, 0, ""};
            cb(err);
        }
        return 0;
    }

    auto ctx = new AsyncCallbackContext{cb, req.sequenceId};

    std::vector<uint8_t> reqBuffer(sizeof(T2TRequest) + req.prompt.size() + req.context.size());
    std::memcpy(reqBuffer.data(), &req, sizeof(T2TRequest));

    int result = requestT2TAsyncFunc_(
        driverHandle_,
        reqBuffer.data(),
        AsyncCallbackWrapper,
        ctx,
        timeout
    );

    if (result != 0) {
        delete ctx;
        if (cb) {
            IrisResponse err{ResponseStatus::ERROR_NETWORK, req.sequenceId,
                "Async request failed", "", {}, {}, 0.0f, 0, ""};
            cb(err);
        }
        return 0;
    }

    return req.sequenceId;
}

// ============================================================================
// Callback wrapper
// ============================================================================

void IrisDriverAdapter::AsyncCallbackWrapper(void* ctx, const void* resp) {
    auto* context = static_cast<AsyncCallbackContext*>(ctx);

    IrisResponse response{};
    if (resp) {
        std::memcpy(&response, resp, sizeof(IrisResponse));
        response.status = ResponseStatus::OK;
    } else {
        response.status = ResponseStatus::ERROR_NETWORK;
        response.text = "Null response from driver";
    }
    response.sequenceId = context->sequenceId;

    if (context->userCallback) {
        context->userCallback(response);
    }

    delete context;
}

// ============================================================================
// Informações e health check
// ============================================================================

IrisDriverAdapter::DriverInfo IrisDriverAdapter::GetDriverInfo() const {
    DriverInfo info{};
    info.version = "unknown";
    info.supportsAsync = (requestI2TAsyncFunc_ != nullptr);
    info.supportsStreaming = false; // TODO: detectar via driver
    info.maxBatchSize = 1;
    return info;
}

bool IrisDriverAdapter::HealthCheck() {
    if (!driverHandle_) return false;

    // Ping simples via sync request vazio
    I2TRequest pingReq{};
    pingReq.sequenceId = 0;
    pingReq.prompt = "ping";

    auto resp = RequestI2TSync(pingReq, 1000);
    return resp.status == ResponseStatus::OK || resp.status == ResponseStatus::ERROR_MODEL;
}

IrisDriverAdapter::DriverStats IrisDriverAdapter::GetDriverStats() const {
    DriverStats stats{};
    // Em produção, expor via API do driver real
    stats.totalRequests = 0;
    stats.failedRequests = 0;
    stats.averageLatencyMs = 0.0;
    stats.activeConnections = 0;
    return stats;
}

// ============================================================================
// Carregamento dinâmico
// ============================================================================

bool IrisDriverAdapter::LoadLibrary() {
    libHandle_ = dlopen(libPath_.c_str(), RTLD_LAZY | RTLD_LOCAL);
    if (!libHandle_) {
        std::cerr << "[IrisDriverAdapter] dlopen failed: " << dlerror() << std::endl;
        return false;
    }

    createFunc_ = reinterpret_cast<IrisDriverCreateFunc>(dlsym(libHandle_, "iris_driver_create"));
    destroyFunc_ = reinterpret_cast<IrisDriverDestroyFunc>(dlsym(libHandle_, "iris_driver_destroy"));
    requestI2TSyncFunc_ = reinterpret_cast<IrisDriverRequestI2TFunc>(dlsym(libHandle_, "iris_driver_request_i2t_sync"));
    requestT2TSyncFunc_ = reinterpret_cast<IrisDriverRequestT2TFunc>(dlsym(libHandle_, "iris_driver_request_t2t_sync"));
    requestI2TAsyncFunc_ = reinterpret_cast<IrisDriverRequestI2TAsyncFunc>(dlsym(libHandle_, "iris_driver_request_i2t_async"));
    requestT2TAsyncFunc_ = reinterpret_cast<IrisDriverRequestT2TAsyncFunc>(dlsym(libHandle_, "iris_driver_request_t2t_async"));

    char* error = dlerror();
    if (error) {
        std::cerr << "[IrisDriverAdapter] dlsym warning: " << error << std::endl;
        // Não falhar — algumas funções podem ser opcionais
    }

    return createFunc_ != nullptr && destroyFunc_ != nullptr;
}

void IrisDriverAdapter::UnloadLibrary() {
    if (libHandle_) {
        dlclose(libHandle_);
        libHandle_ = nullptr;
    }

    createFunc_ = nullptr;
    destroyFunc_ = nullptr;
    requestI2TSyncFunc_ = nullptr;
    requestT2TSyncFunc_ = nullptr;
    requestI2TAsyncFunc_ = nullptr;
    requestT2TAsyncFunc_ = nullptr;
}

} // namespace PCA
} // namespace Iris
} // namespace Arkhe
