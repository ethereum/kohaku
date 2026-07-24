// ============================================================================
// MultiTenant.cpp — Implementation
// ============================================================================

#include "MultiTenant.h"
#include <fstream>

namespace Arkhe {
namespace Iris {
namespace PCA {
namespace MultiTenant {

// ============================================================================
// TenantConsciousnessCycle
// ============================================================================

TenantConsciousnessCycle::TenantConsciousnessCycle(
    const TenantContext& context,
    IrisNetworkDriver* driver,
    PhiMeter* sharedPhiMeter,
    XiMFieldDetector* sharedXiMDetector
) : context_(context),
    cycle_(driver, sharedPhiMeter, sharedXiMDetector) {

    // Apply tenant overrides
    if (context.phiThresholdOverride) {
        cycle_.SetORThreshold(*context.phiThresholdOverride);
    }
    if (context.xiMSensitivityOverride) {
        cycle_.SetXiMSensitivity(*context.xiMSensitivityOverride);
    }
    if (context.alignmentFilterOverride) {
        cycle_.SetAlignmentFilter(*context.alignmentFilterOverride);
    }
}

AsyncTask<IrisResponse> TenantConsciousnessCycle::RunCycleI2TAsync(const I2TRequest& req) {
    context_.lastActivity = std::chrono::steady_clock::now();
    totalCycles_.fetch_add(1);
    context_.totalCycles++;

    auto task = cycle_.RunCycleI2TAsync(req);

    // Update tenant stats
    currentPhi_.store(cycle_.CurrentPhi());
    currentXiM_.store(cycle_.CurrentXiM());
    currentPhase_.store(cycle_.CurrentPhase());

    return task;
}

AsyncTask<IrisResponse> TenantConsciousnessCycle::RunCycleT2TAsync(const T2TRequest& req) {
    context_.lastActivity = std::chrono::steady_clock::now();
    totalCycles_.fetch_add(1);
    context_.totalCycles++;

    return cycle_.RunCycleT2TAsync(req);
}

bool TenantConsciousnessCycle::CheckAlignment(const IrisResponse& resp) const {
    // Base check
    const std::vector<std::string> baseForbidden = {
        "harm", "deceive", "manipulate", "exploit", "destroy"
    };

    std::string text = resp.text + resp.code;
    std::transform(text.begin(), text.end(), text.begin(), ::tolower);

    for (const auto& word : baseForbidden) {
        if (text.find(word) != std::string::npos) return false;
    }

    // Tenant‑specific forbidden patterns
    for (const auto& pattern : context_.additionalForbiddenPatterns) {
        std::string patternLower = pattern;
        std::transform(patternLower.begin(), patternLower.end(), patternLower.begin(), ::tolower);
        if (text.find(patternLower) != std::string::npos) return false;
    }

    return true;
}

// ============================================================================
// MultiTenantPCADriver
// ============================================================================

MultiTenantPCADriver::MultiTenantPCADriver(
    IrisNetworkDriver* driver,
    PhiMeter* sharedPhiMeter,
    XiMFieldDetector* sharedXiMDetector
) : driver_(driver),
    sharedPhiMeter_(sharedPhiMeter),
    sharedXiMDetector_(sharedXiMDetector) {

    cleanupRunning_.store(true);
    cleanupThread_ = std::thread(&MultiTenantPCADriver::CleanupLoop, this);
}

MultiTenantPCADriver::~MultiTenantPCADriver() {
    cleanupRunning_.store(false);
    if (cleanupThread_.joinable()) cleanupThread_.join();
}

TenantID MultiTenantPCADriver::CreateTenant(
    const std::string& namespace_,
    const std::string& userId,
    const std::string& sessionId
) {
    TenantID id{namespace_, userId, sessionId};

    TenantContext ctx;
    ctx.id = id;
    ctx.createdAt = std::chrono::steady_clock::now();
    ctx.lastActivity = ctx.createdAt;
    ctx.jurisdiction = "UNKNOWN";
    ctx.ethicsFramework = "ARKHE-P1-P7";

    auto cycle = std::make_unique<TenantConsciousnessCycle>(
        ctx, driver_, sharedPhiMeter_, sharedXiMDetector_
    );

    {
        std::unique_lock<std::shared_mutex> lock(tenantsMutex_);
        tenants_[id] = std::move(cycle);
    }

    return id;
}

bool MultiTenantPCADriver::RemoveTenant(const TenantID& id) {
    std::unique_lock<std::shared_mutex> lock(tenantsMutex_);
    auto it = tenants_.find(id);
    if (it == tenants_.end()) return false;

    tenants_.erase(it);
    return true;
}

bool MultiTenantPCADriver::TenantExists(const TenantID& id) const {
    std::shared_lock<std::shared_mutex> lock(tenantsMutex_);
    return tenants_.find(id) != tenants_.end();
}

size_t MultiTenantPCADriver::TenantCount() const {
    std::shared_lock<std::shared_mutex> lock(tenantsMutex_);
    return tenants_.size();
}

AsyncTask<IrisResponse> MultiTenantPCADriver::RunCycleI2TAsync(
    const TenantID& tenantId, const I2TRequest& req
) {
    std::shared_lock<std::shared_mutex> lock(tenantsMutex_);
    auto it = tenants_.find(tenantId);
    if (it == tenants_.end()) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, 0, "Tenant not found"};
        co_return err;
    }
    co_return co_await it->second->RunCycleI2TAsync(req);
}

AsyncTask<IrisResponse> MultiTenantPCADriver::RunCycleT2TAsync(
    const TenantID& tenantId, const T2TRequest& req
) {
    std::shared_lock<std::shared_mutex> lock(tenantsMutex_);
    auto it = tenants_.find(tenantId);
    if (it == tenants_.end()) {
        IrisResponse err{ResponseStatus::ERROR_NETWORK, 0, "Tenant not found"};
        co_return err;
    }
    co_return co_await it->second->RunCycleT2TAsync(req);
}

bool MultiTenantPCADriver::SetTenantConfig(const TenantID& id, const TenantContext& context) {
    std::unique_lock<std::shared_mutex> lock(tenantsMutex_);
    auto it = tenants_.find(id);
    if (it == tenants_.end()) return false;

    it->second->GetContextMutable() = context;
    return true;
}

TenantContext MultiTenantPCADriver::GetTenantContext(const TenantID& id) const {
    std::shared_lock<std::shared_mutex> lock(tenantsMutex_);
    auto it = tenants_.find(id);
    if (it == tenants_.end()) return TenantContext{};
    return it->second->GetContext();
}

MultiTenantPCADriver::GlobalMetrics MultiTenantPCADriver::GetGlobalMetrics() const {
    GlobalMetrics metrics{};
    metrics.lastUpdate = std::chrono::steady_clock::now();

    std::shared_lock<std::shared_mutex> lock(tenantsMutex_);
    metrics.activeTenants = tenants_.size();

    for (const auto& [id, cycle] : tenants_) {
        metrics.totalCycles += cycle->TotalCycles();
        metrics.totalBlockedByAlignment += cycle->BlockedByAlignment();
        metrics.averagePhi += cycle->CurrentPhi();
        metrics.maxPhi = std::max(metrics.maxPhi, cycle->CurrentPhi());
        metrics.averageXiMIntensity += cycle->CurrentXiM();
    }

    if (metrics.activeTenants > 0) {
        metrics.averagePhi /= metrics.activeTenants;
        metrics.averageXiMIntensity /= metrics.activeTenants;
    }

    return metrics;
}

std::vector<TenantID> MultiTenantPCADriver::ListActiveTenants() const {
    std::vector<TenantID> result;
    std::shared_lock<std::shared_mutex> lock(tenantsMutex_);
    for (const auto& [id, cycle] : tenants_) {
        if (cycle->GetContext().active) {
            result.push_back(id);
        }
    }
    return result;
}

void MultiTenantPCADriver::CleanupLoop() {
    while (cleanupRunning_.load()) {
        auto now = std::chrono::steady_clock::now();
        std::unique_lock<std::shared_mutex> lock(tenantsMutex_);
        for (auto it = tenants_.begin(); it != tenants_.end(); ) {
            auto idle = std::chrono::duration_cast<std::chrono::minutes>(
                now - it->second->GetContext().lastActivity
            ).count();
            if (idle > idleTimeout_.count()) {
                it = tenants_.erase(it);
            } else {
                ++it;
            }
        }
        lock.unlock();
        std::this_thread::sleep_for(std::chrono::minutes(5));
    }
}

// ============================================================================
// MultiTenantOverlayManager
// ============================================================================

MultiTenantOverlayManager::MultiTenantOverlayManager(
    MultiTenantPCADriver* driver,
    const Overlay::OverlayConfig& config
) : driver_(driver), overlay_(config) {
}

MultiTenantOverlayManager::~MultiTenantOverlayManager() {
    Shutdown();
}

bool MultiTenantOverlayManager::Initialize(int screenWidth, int screenHeight) {
    if (!overlay_.Initialize(screenWidth, screenHeight)) return false;

    running_.store(true);
    dataThread_ = std::thread(&MultiTenantOverlayManager::DataCollectionLoop, this);
    return true;
}

void MultiTenantOverlayManager::Shutdown() {
    running_.store(false);
    if (dataThread_.joinable()) dataThread_.join();
    overlay_.Shutdown();
}

void MultiTenantOverlayManager::RenderFrame() {
    overlay_.Render();
}

void MultiTenantOverlayManager::SetActiveTenant(const TenantID& id) {
    std::unique_lock<std::shared_mutex> lock(activeTenantMutex_);
    activeTenant_ = id;
}

TenantID MultiTenantOverlayManager::GetActiveTenant() const {
    std::shared_lock<std::shared_mutex> lock(activeTenantMutex_);
    return activeTenant_;
}

void MultiTenantOverlayManager::NextTenant() {
    auto tenants = driver_->ListActiveTenants();
    if (tenants.empty()) return;

    std::unique_lock<std::shared_mutex> lock(activeTenantMutex_);
    auto it = std::find(tenants.begin(), tenants.end(), activeTenant_);
    if (it == tenants.end() || ++it == tenants.end()) {
        activeTenant_ = tenants.front();
    } else {
        activeTenant_ = *it;
    }
}

void MultiTenantOverlayManager::PreviousTenant() {
    auto tenants = driver_->ListActiveTenants();
    if (tenants.empty()) return;

    std::unique_lock<std::shared_mutex> lock(activeTenantMutex_);
    auto it = std::find(tenants.begin(), tenants.end(), activeTenant_);
    if (it == tenants.begin()) {
        activeTenant_ = tenants.back();
    } else {
        activeTenant_ = *(--it);
    }
}

void MultiTenantOverlayManager::DataCollectionLoop() {
    while (running_.load()) {
        TenantID active;
        {
            std::shared_lock<std::shared_mutex> lock(activeTenantMutex_);
            active = activeTenant_;
        }

        if (driver_->TenantExists(active)) {
            auto ctx = driver_->GetTenantContext(active);
            Overlay::OverlaySnapshot snap;
            snap.phi = ctx.averagePhi;
            snap.phiNormalized = ctx.averagePhi / PHI_COSMIC;
            // ... build full snapshot from tenant context
            overlay_.UpdateData(snap);
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }
}

} // namespace MultiTenant
} // namespace PCA
} // namespace Iris
} // namespace Arkhe
