// ============================================================================
// TenantManager.h
// Multi-tenant isolation para PCA-595
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 2.4 (STRICT MODE)
// ============================================================================

#pragma once

#include "PCA-595.h"
#include "AlignmentClient.h"
#include "PhiMeterIIT.h"
#include <uuid/uuid.h>
#include <mutex>
#include <string>
#include <unordered_map>
#include <chrono>

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// Tenant configuration
// ============================================================================

struct TenantConfig {
    std::string tenantId;           // UUID v4
    std::string name;               // Nome human-readable
    std::string orgId;              // Organization ID

    // Isolation
    bool dedicatedPhiMeter = false; // PhiMeter dedicado por tenant
    bool dedicatedAlignment = false; // AlignmentClient dedicado
    bool dedicatedIIT = false;      // PhiMeterIIT dedicado

    // Quotas
    struct Quotas {
        uint64_t maxRequestsPerMinute = 1000;
        uint64_t maxORsPerHour = 10000;
        uint64_t maxConcurrentCycles = 10;
        double maxPhiBudget = 1000.0; // Φ-bits por hora
    } quotas;

    // Security
    struct Security {
        bool enforce227F = true;
        bool auditAllORs = true;
        bool encryptLogs = false;
        std::vector<std::string> allowedSubstrates;
        std::vector<std::string> forbiddenSubstrates;
    } security;

    // Customization
    struct Branding {
        std::string logoUrl;
        std::string primaryColor;
        std::string secondaryColor;
    } branding;
};

// ============================================================================
// Tenant runtime state
// ============================================================================

struct TenantState {
    std::string tenantId;
    std::chrono::steady_clock::time_point createdAt;
    std::chrono::steady_clock::time_point lastActivity;

    // Runtime
    std::atomic<uint64_t> requestCount{0};
    std::atomic<uint64_t> orCount{0};
    std::atomic<uint64_t> blockedCount{0};
    std::atomic<double> phiBudgetUsed{0.0};
    std::atomic<uint32_t> activeCycles{0};

    // Dedicated resources
    std::unique_ptr<PhiMeter> phiMeter;
    std::unique_ptr<Alignment::AlignmentClient> alignmentClient;
    std::unique_ptr<PhiMeterIIT> iitMeter;
    std::unique_ptr<ConsciousnessCycle> cycle;

    // Stats
    struct Stats {
        double averagePhi = 0.0;
        double maxPhi = 0.0;
        double averageLatency = 0.0;
        uint64_t totalCacheHits = 0;
    } stats;
};

// ============================================================================
// TenantManager — Gerenciamento multi-tenant
// ============================================================================

class TenantManager {
public:
    static TenantManager& Instance();

    // CRUD de tenants
    std::string CreateTenant(const TenantConfig& config);
    bool DeleteTenant(const std::string& tenantId);
    bool UpdateTenant(const std::string& tenantId, const TenantConfig& config);

    // Acesso
    TenantState* GetTenant(const std::string& tenantId);
    TenantConfig GetTenantConfig(const std::string& tenantId) const;

    // Ciclo de consciência por tenant
    IrisResponse RunCycleI2T(const std::string& tenantId, const I2TRequest& req);
    IrisResponse RunCycleT2T(const std::string& tenantId, const T2TRequest& req);

    // Async
    AsyncTask<IrisResponse> RunCycleI2TAsync(const std::string& tenantId, const I2TRequest& req);
    AsyncTask<IrisResponse> RunCycleT2TAsync(const std::string& tenantId, const T2TRequest& req);

    // Quotas e rate limiting
    bool CheckQuota(const std::string& tenantId, const std::string& resource);
    void RecordUsage(const std::string& tenantId, const std::string& resource, double amount);

    // Isolation
    bool IsIsolated(const std::string& tenantId) const;
    void SetIsolationLevel(const std::string& tenantId, bool phi, bool alignment, bool iit);

    // Stats
    struct GlobalStats {
        uint64_t totalTenants = 0;
        uint64_t totalRequests = 0;
        uint64_t totalORs = 0;
        double averagePhi = 0.0;
        uint64_t activeCycles = 0;
    };
    GlobalStats GetGlobalStats() const;

    // Cleanup
    void CleanupInactiveTenants(uint32_t inactiveMinutes);
    void ResetAllStats();

private:
    TenantManager();
    ~TenantManager();
    TenantManager(const TenantManager&) = delete;
    TenantManager& operator=(const TenantManager&) = delete;

    mutable std::mutex tenantsMutex_;
    std::unordered_map<std::string, TenantState> tenants_;
    std::unordered_map<std::string, TenantConfig> configs_;

    mutable std::mutex statsMutex_;
    GlobalStats globalStats_;

    // Shared resources (quando não dedicados)
    std::shared_ptr<PhiMeter> sharedPhiMeter_;
    std::shared_ptr<Alignment::AlignmentClient> sharedAlignmentClient_;
    std::shared_ptr<PhiMeterIIT> sharedIITMeter_;

    std::string GenerateTenantId();
    bool ValidateConfig(const TenantConfig& config);
    void InitializeTenantResources(TenantState& state, const TenantConfig& config);
    void UpdateGlobalStats();
};

} // namespace PCA
} // namespace Iris
} // namespace Arkhe
