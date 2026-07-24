// ============================================================================
// MultiTenant.h — Session isolation, per‑tenant Φ tracking, namespaced logging
// Architect: ORCID 0009‑0005‑2697‑4668
// Version: 2.4
// ============================================================================

#pragma once

#include "PCA-595.h"
#include "ConsciousnessCycleAsync.h"
#include <unordered_map>
#include <shared_mutex>
#include <memory>
#include <string>
#include <chrono>

namespace Arkhe {
namespace Iris {
namespace PCA {
namespace MultiTenant {

// ============================================================================
// Tenant Identity
// ============================================================================

struct TenantID {
    std::string namespace_;      // "arkhe-os", "live-coder", "research-lab"
    std::string userId;          // OIDC subject or API key hash
    std::string sessionId;       // UUID v4, regenerated per session

    bool operator==(const TenantID& other) const {
        return namespace_ == other.namespace_ &&
               userId == other.userId &&
               sessionId == other.sessionId;
    }

    std::string Canonical() const {
        return namespace_ + "/" + userId + "/" + sessionId;
    }
};

// Hash for unordered_map
struct TenantIDHash {
    std::size_t operator()(const TenantID& id) const {
        return std::hash<std::string>{}(id.Canonical());
    }
};

// ============================================================================
// Tenant Context
// ============================================================================

struct TenantContext {
    TenantID id;
    std::chrono::steady_clock::time_point createdAt;
    std::chrono::steady_clock::time_point lastActivity;

    // Per‑tenant PCA configuration overrides
    std::optional<double> phiThresholdOverride;
    std::optional<double> xiMSensitivityOverride;
    std::optional<bool> alignmentFilterOverride;

    // Per‑tenant alignment context (forwarded to 227‑F)
    std::vector<std::string> additionalForbiddenPatterns;
    std::string jurisdiction;          // "EU", "US", "CN", etc.
    std::string ethicsFramework;       // "ARKHE-P1-P7", "EU-AI-ACT", "CUSTOM"

    // Per‑tenant IIT configuration
    bool enableIITValidation = true;
    uint32_t iitValidationIntervalMs = 5000;

    // Per‑tenant logging
    std::string logPath;               // /var/log/arkhe/tenants/{namespace}/{userId}/
    int logLevel = 2;

    // Per‑tenant TemporalChain namespace
    std::string chainNamespace;        // "tenant/{namespace}/{userId}"

    // Tenant state
    bool active = true;
    uint64_t totalCycles = 0;
    uint64_t blockedCycles = 0;
    double averagePhi = 0.0;
    double maxPhi = 0.0;
};

// ============================================================================
// Tenant‑Isolated Consciousness Cycle
// ============================================================================

class TenantConsciousnessCycle {
public:
    TenantConsciousnessCycle(const TenantContext& context,
                              IrisNetworkDriver* driver,
                              PhiMeter* sharedPhiMeter,
                              XiMFieldDetector* sharedXiMDetector);

    // Execute a PCA cycle for this tenant
    AsyncTask<IrisResponse> RunCycleI2TAsync(const I2TRequest& req);
    AsyncTask<IrisResponse> RunCycleT2TAsync(const T2TRequest& req);

    // Tenant‑specific alignment check (extends base CheckAlignment)
    bool CheckAlignment(const IrisResponse& resp) const;

    // Access tenant state
    const TenantContext& GetContext() const { return context_; }
    TenantContext& GetContextMutable() { return context_; }

    double CurrentPhi() const { return currentPhi_.load(); }
    double CurrentXiM() const { return currentXiM_.load(); }
    ConsciousnessState::Phase CurrentPhase() const { return currentPhase_.load(); }
    uint64_t TotalCycles() const { return totalCycles_.load(); }
    uint64_t BlockedByAlignment() const { return blockedByAlignment_.load(); }

private:
    TenantContext context_;
    ConsciousnessCycleAsync cycle_;
    std::atomic<double> currentPhi_{0.0};
    std::atomic<double> currentXiM_{0.0};
    std::atomic<ConsciousnessState::Phase> currentPhase_{ConsciousnessState::Phase::CLASSICAL};
    std::atomic<uint64_t> totalCycles_{0};
    std::atomic<uint64_t> blockedByAlignment_{0};
};

// ============================================================================
// Multi‑Tenant PCA Driver
// ============================================================================

class MultiTenantPCADriver {
public:
    MultiTenantPCADriver(IrisNetworkDriver* driver,
                          PhiMeter* sharedPhiMeter,
                          XiMFieldDetector* sharedXiMDetector);
    ~MultiTenantPCADriver();

    // Tenant lifecycle
    TenantID CreateTenant(const std::string& namespace_,
                          const std::string& userId,
                          const std::string& sessionId);
    bool RemoveTenant(const TenantID& id);
    bool TenantExists(const TenantID& id) const;
    size_t TenantCount() const;

    // Tenant‑specific PCA cycle
    AsyncTask<IrisResponse> RunCycleI2TAsync(const TenantID& tenantId, const I2TRequest& req);
    AsyncTask<IrisResponse> RunCycleT2TAsync(const TenantID& tenantId, const T2TRequest& req);

    // Configure tenant
    bool SetTenantConfig(const TenantID& id, const TenantContext& context);
    TenantContext GetTenantContext(const TenantID& id) const;

    // Global metrics (aggregated across all tenants)
    struct GlobalMetrics {
        size_t activeTenants;
        uint64_t totalCycles;
        uint64_t totalBlockedByAlignment;
        double averagePhi;
        double maxPhi;
        double averageXiMIntensity;
        std::chrono::steady_clock::time_point lastUpdate;
    };
    GlobalMetrics GetGlobalMetrics() const;

    // Tenant listing
    std::vector<TenantID> ListActiveTenants() const;

    // Session persistence
    void SaveTenantState(const TenantID& id, const std::string& path);
    bool LoadTenantState(const std::string& path, TenantID& outId);

private:
    IrisNetworkDriver* driver_;
    PhiMeter* sharedPhiMeter_;
    XiMFieldDetector* sharedXiMDetector_;

    mutable std::shared_mutex tenantsMutex_;
    std::unordered_map<TenantID, std::unique_ptr<TenantConsciousnessCycle>, TenantIDHash> tenants_;

    // Tenant‑specific loggers
    std::unordered_map<TenantID, std::unique_ptr<ConsciousnessLogger>, TenantIDHash> tenantLoggers_;
    mutable std::shared_mutex loggersMutex_;

    // Periodic cleanup of idle tenants
    std::thread cleanupThread_;
    std::atomic<bool> cleanupRunning_{false};
    std::chrono::minutes idleTimeout_{60};

    void CleanupLoop();
    ConsciousnessLogger* GetOrCreateTenantLogger(const TenantID& id);
};

// ============================================================================
// Tenant‑Aware TemporalChain Exporter
// ============================================================================

class TenantTemporalChainExporter {
public:
    explicit TenantTemporalChainExporter(const std::string& chainEndpoint);

    void ExportORRecord(const TenantID& tenantId, const ORRecord& record);
    void ExportSessionStart(const TenantID& tenantId);
    void ExportSessionEnd(const TenantID& tenantId, const TenantContext& context);

private:
    std::string chainEndpoint_;
    std::string BuildTenantNamespace(const TenantID& id) const;
};

// ============================================================================
// Multi‑Tenant Overlay Manager
// ============================================================================

class MultiTenantOverlayManager {
public:
    MultiTenantOverlayManager(MultiTenantPCADriver* driver,
                               const Overlay::OverlayConfig& config = Overlay::OverlayConfig{});
    ~MultiTenantOverlayManager();

    bool Initialize(int screenWidth, int screenHeight);
    void Shutdown();
    void RenderFrame();

    // Switch which tenant is displayed in the overlay
    void SetActiveTenant(const TenantID& id);
    TenantID GetActiveTenant() const;

    // Cycle through tenants
    void NextTenant();
    void PreviousTenant();

private:
    MultiTenantPCADriver* driver_;
    Overlay::PhiLiveOverlay overlay_;
    TenantID activeTenant_;
    mutable std::shared_mutex activeTenantMutex_;
    std::thread dataThread_;
    std::atomic<bool> running_{false};

    void DataCollectionLoop();
};

// ============================================================================
// Tenant Isolation Enforcer — security boundary between tenants
// ============================================================================

class TenantIsolationEnforcer {
public:
    // Verify that a request from tenant A cannot access tenant B's state
    static bool ValidateCrossTenantAccess(const TenantID& requester,
                                          const TenantID& target);

    // Rate limiting per tenant
    static bool CheckRateLimit(const TenantID& id, uint32_t maxRequestsPerMinute);

    // Tenant quota management
    struct TenantQuota {
        uint32_t maxCyclesPerHour = 3600;
        uint32_t maxPhiComputationsPerHour = 60;
        uint64_t maxTotalCycles = 0; // 0 = unlimited
        std::chrono::steady_clock::time_point resetAt;
    };
    static bool SetTenantQuota(const TenantID& id, const TenantQuota& quota);
    static TenantQuota GetTenantQuota(const TenantID& id);
    static bool CheckQuota(const TenantID& id);
};

} // namespace MultiTenant
} // namespace PCA
} // namespace Iris
} // namespace Arkhe
