// ============================================================================
// TenantManager.cpp
// Implementação multi-tenant para PCA-595
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 2.4 (STRICT MODE)
// ============================================================================

#include "TenantManager.h"
#include <sstream>
#include <iomanip>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// Singleton
// ============================================================================

TenantManager& TenantManager::Instance() {
    static TenantManager instance;
    return instance;
}

TenantManager::TenantManager() {
    // Inicializar recursos compartilhados
    sharedPhiMeter_ = std::make_shared<PhiMeter>(ATTENTION_HEADS, EMBEDDING_DIM);

    Alignment::AlignmentConfig alignmentConfig;
    sharedAlignmentClient_ = std::make_shared<Alignment::AlignmentClient>(alignmentConfig);

    IITConfig iitConfig;
    sharedIITMeter_ = std::make_shared<PhiMeterIIT>(iitConfig);
}

TenantManager::~TenantManager() {
    tenants_.clear();
}

// ============================================================================
// CRUD de tenants
// ============================================================================

std::string TenantManager::CreateTenant(const TenantConfig& config) {
    if (!ValidateConfig(config)) {
        throw std::invalid_argument("Invalid tenant configuration");
    }

    std::string tenantId = config.tenantId.empty() ? GenerateTenantId() : config.tenantId;

    std::lock_guard<std::mutex> lock(tenantsMutex_);

    if (tenants_.find(tenantId) != tenants_.end()) {
        throw std::runtime_error("Tenant already exists: " + tenantId);
    }

    TenantState state{};
    state.tenantId = tenantId;
    state.createdAt = std::chrono::steady_clock::now();
    state.lastActivity = state.createdAt;

    InitializeTenantResources(state, config);

    tenants_[tenantId] = std::move(state);
    configs_[tenantId] = config;

    globalStats_.totalTenants++;

    std::cout << "[TenantManager] Created tenant: " << tenantId
              << " (" << config.name << ")" << std::endl;

    return tenantId;
}

bool TenantManager::DeleteTenant(const std::string& tenantId) {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto it = tenants_.find(tenantId);
    if (it == tenants_.end()) {
        return false;
    }

    // Liberar recursos dedicados
    it->second.phiMeter.reset();
    it->second.alignmentClient.reset();
    it->second.iitMeter.reset();
    it->second.cycle.reset();

    tenants_.erase(it);
    configs_.erase(tenantId);

    globalStats_.totalTenants--;

    std::cout << "[TenantManager] Deleted tenant: " << tenantId << std::endl;

    return true;
}

bool TenantManager::UpdateTenant(const std::string& tenantId, const TenantConfig& config) {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto it = tenants_.find(tenantId);
    if (it == tenants_.end()) {
        return false;
    }

    configs_[tenantId] = config;

    // Re-inicializar recursos se necessário
    if (config.dedicatedPhiMeter && !it->second.phiMeter) {
        it->second.phiMeter = std::make_unique<PhiMeter>(ATTENTION_HEADS, EMBEDDING_DIM);
    } else if (!config.dedicatedPhiMeter && it->second.phiMeter) {
        it->second.phiMeter.reset();
    }

    if (config.dedicatedAlignment && !it->second.alignmentClient) {
        Alignment::AlignmentConfig ac;
        it->second.alignmentClient = std::make_unique<Alignment::AlignmentClient>(ac);
    } else if (!config.dedicatedAlignment && it->second.alignmentClient) {
        it->second.alignmentClient.reset();
    }

    if (config.dedicatedIIT && !it->second.iitMeter) {
        IITConfig ic;
        it->second.iitMeter = std::make_unique<PhiMeterIIT>(ic);
    } else if (!config.dedicatedIIT && it->second.iitMeter) {
        it->second.iitMeter.reset();
    }

    return true;
}

// ============================================================================
// Acesso
// ============================================================================

TenantState* TenantManager::GetTenant(const std::string& tenantId) {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto it = tenants_.find(tenantId);
    if (it != tenants_.end()) {
        it->second.lastActivity = std::chrono::steady_clock::now();
        return &it->second;
    }

    return nullptr;
}

TenantConfig TenantManager::GetTenantConfig(const std::string& tenantId) const {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto it = configs_.find(tenantId);
    if (it != configs_.end()) {
        return it->second;
    }

    return TenantConfig{};
}

// ============================================================================
// Ciclo de consciência por tenant
// ============================================================================

IrisResponse TenantManager::RunCycleI2T(const std::string& tenantId, const I2TRequest& req) {
    auto* tenant = GetTenant(tenantId);
    if (!tenant) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, 0,
            "Tenant not found: " + tenantId, "", {}, {}, 0.0f, 0, ""};
        return err;
    }

    // Check quotas
    if (!CheckQuota(tenantId, "requests_per_minute")) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, req.sequenceId,
            "Rate limit exceeded", "", {}, {}, 0.0f, 0, ""};
        return err;
    }

    if (!CheckQuota(tenantId, "concurrent_cycles")) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, req.sequenceId,
            "Max concurrent cycles exceeded", "", {}, {}, 0.0f, 0, ""};
        return err;
    }

    // Run cycle
    tenant->activeCycles++;
    tenant->requestCount++;

    IrisResponse resp;
    if (tenant->cycle) {
        resp = tenant->cycle->RunCycleI2T(req);
    } else {
        // Use shared cycle
        ConsciousnessCycle cycle(nullptr, sharedPhiMeter_.get(), nullptr);
        resp = cycle.RunCycleI2T(req);
    }

    tenant->activeCycles--;
    tenant->orCount++;
    tenant->phiBudgetUsed += resp.confidence; // Proxy para Φ usado

    if (resp.status == ResponseStatus::ERROR_ALIGNMENT) {
        tenant->blockedCount++;
    }

    // Record usage
    RecordUsage(tenantId, "requests", 1.0);
    RecordUsage(tenantId, "phi", resp.confidence);

    return resp;
}

IrisResponse TenantManager::RunCycleT2T(const std::string& tenantId, const T2TRequest& req) {
    auto* tenant = GetTenant(tenantId);
    if (!tenant) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, 0,
            "Tenant not found: " + tenantId, "", {}, {}, 0.0f, 0, ""};
        return err;
    }

    if (!CheckQuota(tenantId, "requests_per_minute")) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, req.sequenceId,
            "Rate limit exceeded", "", {}, {}, 0.0f, 0, ""};
        return err;
    }

    tenant->activeCycles++;
    tenant->requestCount++;

    IrisResponse resp;
    if (tenant->cycle) {
        resp = tenant->cycle->RunCycleT2T(req);
    } else {
        ConsciousnessCycle cycle(nullptr, sharedPhiMeter_.get(), nullptr);
        resp = cycle.RunCycleT2T(req);
    }

    tenant->activeCycles--;
    tenant->orCount++;

    RecordUsage(tenantId, "requests", 1.0);
    RecordUsage(tenantId, "phi", resp.confidence);

    return resp;
}

AsyncTask<IrisResponse> TenantManager::RunCycleI2TAsync(const std::string& tenantId, const I2TRequest& req) {
    return std::async(std::launch::async, [this, tenantId, req]() {
        return this->RunCycleI2T(tenantId, req);
    });
}

AsyncTask<IrisResponse> TenantManager::RunCycleT2TAsync(const std::string& tenantId, const T2TRequest& req) {
    return std::async(std::launch::async, [this, tenantId, req]() {
        return this->RunCycleT2T(tenantId, req);
    });
}

// ============================================================================
// Quotas e rate limiting
// ============================================================================

bool TenantManager::CheckQuota(const std::string& tenantId, const std::string& resource) {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto it = tenants_.find(tenantId);
    if (it == tenants_.end()) return false;

    auto configIt = configs_.find(tenantId);
    if (configIt == configs_.end()) return false;

    const auto& config = configIt->second;
    const auto& state = it->second;

    if (resource == "requests_per_minute") {
        // Simplificado — em produção, usar janela deslizante
        return state.requestCount.load() < config.quotas.maxRequestsPerMinute;
    }

    if (resource == "concurrent_cycles") {
        return state.activeCycles.load() < config.quotas.maxConcurrentCycles;
    }

    if (resource == "phi_budget") {
        return state.phiBudgetUsed.load() < config.quotas.maxPhiBudget;
    }

    return true;
}

void TenantManager::RecordUsage(const std::string& tenantId, const std::string& resource, double amount) {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto it = tenants_.find(tenantId);
    if (it == tenants_.end()) return;

    if (resource == "requests") {
        globalStats_.totalRequests += static_cast<uint64_t>(amount);
    } else if (resource == "phi") {
        globalStats_.totalORs++;
    }
}

// ============================================================================
// Isolation
// ============================================================================

bool TenantManager::IsIsolated(const std::string& tenantId) const {
    auto config = GetTenantConfig(tenantId);
    return config.dedicatedPhiMeter || config.dedicatedAlignment || config.dedicatedIIT;
}

void TenantManager::SetIsolationLevel(const std::string& tenantId, bool phi, bool alignment, bool iit) {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto configIt = configs_.find(tenantId);
    if (configIt == configs_.end()) return;

    configIt->second.dedicatedPhiMeter = phi;
    configIt->second.dedicatedAlignment = alignment;
    configIt->second.dedicatedIIT = iit;

    auto stateIt = tenants_.find(tenantId);
    if (stateIt == tenants_.end()) return;

    // Re-inicializar recursos
    if (phi && !stateIt->second.phiMeter) {
        stateIt->second.phiMeter = std::make_unique<PhiMeter>(ATTENTION_HEADS, EMBEDDING_DIM);
    } else if (!phi && stateIt->second.phiMeter) {
        stateIt->second.phiMeter.reset();
    }

    if (alignment && !stateIt->second.alignmentClient) {
        Alignment::AlignmentConfig ac;
        stateIt->second.alignmentClient = std::make_unique<Alignment::AlignmentClient>(ac);
    } else if (!alignment && stateIt->second.alignmentClient) {
        stateIt->second.alignmentClient.reset();
    }

    if (iit && !stateIt->second.iitMeter) {
        IITConfig ic;
        stateIt->second.iitMeter = std::make_unique<PhiMeterIIT>(ic);
    } else if (!iit && stateIt->second.iitMeter) {
        stateIt->second.iitMeter.reset();
    }
}

// ============================================================================
// Stats
// ============================================================================

TenantManager::GlobalStats TenantManager::GetGlobalStats() const {
    std::lock_guard<std::mutex> lock(statsMutex_);
    return globalStats_;
}

void TenantManager::CleanupInactiveTenants(uint32_t inactiveMinutes) {
    std::lock_guard<std::mutex> lock(tenantsMutex_);

    auto now = std::chrono::steady_clock::now();
    auto threshold = std::chrono::minutes(inactiveMinutes);

    std::vector<std::string> toDelete;
    for (const auto& [id, state] : tenants_) {
        auto inactive = now - state.lastActivity;
        if (inactive > threshold) {
            toDelete.push_back(id);
        }
    }

    for (const auto& id : toDelete) {
        auto it = tenants_.find(id);
        if (it != tenants_.end()) {
            it->second.phiMeter.reset();
            it->second.alignmentClient.reset();
            it->second.iitMeter.reset();
            it->second.cycle.reset();
            tenants_.erase(it);
            configs_.erase(id);
            globalStats_.totalTenants--;
        }
    }

    if (!toDelete.empty()) {
        std::cout << "[TenantManager] Cleaned up " << toDelete.size()
                  << " inactive tenants" << std::endl;
    }
}

void TenantManager::ResetAllStats() {
    std::lock_guard<std::mutex> lock(tenantsMutex_);
    std::lock_guard<std::mutex> statsLock(statsMutex_);

    for (auto& [id, state] : tenants_) {
        state.requestCount.store(0);
        state.orCount.store(0);
        state.blockedCount.store(0);
        state.phiBudgetUsed.store(0.0);
        state.activeCycles.store(0);
    }

    globalStats_ = GlobalStats{};
}

// ============================================================================
// Utilidades privadas
// ============================================================================

std::string TenantManager::GenerateTenantId() {
    uuid_t uuid;
    uuid_generate_random(uuid);

    char uuidStr[37];
    uuid_unparse_lower(uuid, uuidStr);

    return std::string(uuidStr);
}

bool TenantManager::ValidateConfig(const TenantConfig& config) {
    if (config.name.empty()) return false;
    if (config.orgId.empty()) return false;
    return true;
}

void TenantManager::InitializeTenantResources(TenantState& state, const TenantConfig& config) {
    if (config.dedicatedPhiMeter) {
        state.phiMeter = std::make_unique<PhiMeter>(ATTENTION_HEADS, EMBEDDING_DIM);
    }

    if (config.dedicatedAlignment) {
        Alignment::AlignmentConfig ac;
        state.alignmentClient = std::make_unique<Alignment::AlignmentClient>(ac);
    }

    if (config.dedicatedIIT) {
        IITConfig ic;
        state.iitMeter = std::make_unique<PhiMeterIIT>(ic);
    }

    // Ciclo usa recursos dedicados ou compartilhados
    PhiMeter* pm = state.phiMeter ? state.phiMeter.get() : sharedPhiMeter_.get();
    XiMFieldDetector* xim = nullptr; // TODO: dedicated XiM?

    state.cycle = std::make_unique<ConsciousnessCycle>(nullptr, pm, xim);
}

void TenantManager::UpdateGlobalStats() {
    std::lock_guard<std::mutex> lock(statsMutex_);

    globalStats_.activeCycles = 0;
    for (const auto& [id, state] : tenants_) {
        globalStats_.activeCycles += state.activeCycles.load();
    }
}

} // namespace PCA
} // namespace Iris
} // namespace Arkhe
