// ============================================================================
// PCA-595-Integration.h
// Header unificado para integração de AlignmentClient e PhiMeterIIT
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// ============================================================================

#pragma once

#include "PCA-595.h"

#ifdef PCA_USE_227F
#include "AlignmentClient.h"
#endif

#ifdef PCA_USE_IIT_452
#include "PhiMeterIIT.h"
#endif

namespace Arkhe {
namespace Iris {
namespace PCA {

// ============================================================================
// PCAEnabledDriver v2.1 — Com integração completa
// ============================================================================

class PCAEnabledDriverV21 : public PCAEnabledDriver {
public:
    PCAEnabledDriverV21(
        const std::string& endpoint = "http://iris.arkhe-os.svc.cluster.local:8080",
        const std::string& apiKey = "ARKHE-IRIS-595"
    );

    bool InitializeV21();

#ifdef PCA_USE_227F
    // Acesso ao alignment client
    Alignment::AlignmentClient* GetAlignmentClient() { return alignmentClient_.get(); }
    void SetAlignmentConfig(const Alignment::AlignmentConfig& config);
#endif

#ifdef PCA_USE_IIT_452
    // Acesso ao IIT meter
    PhiMeterIIT* GetIITMeter() { return &iitMeter_; }
    void SetIITConfig(const IITConfig& config);
#endif

    // Estatísticas unificadas
    struct UnifiedStats {
        size_t totalCycles;
        size_t blockedByAlignment;
        size_t blockedByPhi;
        double averagePhi;
        double averagePhiIIT;
        double phiDelta;  // IIT - proxy
        double averageORLatency;
        uint64_t alignmentEvaluations;
        uint64_t iitValidations;
    };
    UnifiedStats GetUnifiedStats() const;

private:
#ifdef PCA_USE_227F
    std::unique_ptr<Alignment::AlignmentClient> alignmentClient_;
#endif

#ifdef PCA_USE_IIT_452
    PhiMeterIIT iitMeter_;
#endif
};

} // namespace PCA
} // namespace Iris
} // namespace Arkhe
