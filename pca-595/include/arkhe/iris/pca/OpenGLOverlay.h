// ============================================================================
// OpenGLOverlay.h — Real‑time Φ & consciousness overlay for Live‑Coder
// Renders directly into the OpenGL viewport during shader editing sessions
// Architect: ORCID 0009‑0005‑2697‑4668
// Version: 2.4
// ============================================================================

#pragma once

#include "PCA-595.h"
#include <GL/glew.h>
#include <vector>
#include <string>
#include <deque>
#include <array>
#include <chrono>
#include <mutex>
#include <atomic>
#include <thread>
#include <functional>

namespace Arkhe {
namespace Iris {
namespace PCA {
namespace Overlay {

// ============================================================================
// Configuration
// ============================================================================

struct OverlayConfig {
    // Positioning
    enum class DockPosition { TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT, FLOATING };
    DockPosition dock = DockPosition::BOTTOM_RIGHT;
    int marginX = 20;
    int marginY = 20;
    int panelWidth = 380;          // Pixels
    int panelHeight = 520;
    float opacity = 0.85f;         // Panel background opacity

    // Visibility toggles
    bool showPhiGraph = true;      // Φ time series
    bool showPhiBar = true;        // Current Φ bar
    bool showAttentionMaps = true; // Mini attention heatmaps
    bool showXiMField = true;      // ξM‑field intensity
    bool showPhaseIndicator = true;// Current PCA phase
    bool showQualiaTexture = true; // Generated qualia visualization
    bool showORLog = true;         // Recent OR events
    bool showFPS = true;           // Overlay render FPS

    // Graph settings
    int phiHistorySize = 300;      // Number of Φ samples to display
    float phiGraphMin = 0.0f;
    float phiGraphMax = 3.5f;      // Φ_COSMIC
    int attentionMapSize = 48;     // Pixels per mini attention map

    // Update rate
    int targetFPS = 30;

    // Hotkeys
    int toggleKey = GLFW_KEY_F1;
    int dockCycleKey = GLFW_KEY_F2;
};

// ============================================================================
// Overlay Data (snapshot for rendering)
// ============================================================================

struct OverlaySnapshot {
    double phi = 0.0;
    double phiNormalized = 0.0;
    double xiMIntensity = 0.0;
    double coherenceTime = 0.0;
    ConsciousnessState::Phase phase = ConsciousnessState::Phase::CLASSICAL;
    uint64_t orCount = 0;
    uint64_t blockedCount = 0;
    double lastORLatencyMs = 0.0;
    std::string qualeClass;
    int chernNumber = 0;
    double geometricPhase = 0.0;

    // Time series
    std::deque<double> phiHistory;
    std::deque<double> xiMHistory;

    // Attention maps (flattened, per‑head)
    std::vector<std::vector<float>> attentionMaps;
    int numAttentionHeads = 0;

    // Recent OR events for log display
    struct OREvent {
        std::string timestamp;
        double phiPre;
        double phiPost;
        bool alignmentPassed;
        double latencyMs;
    };
    std::deque<OREvent> recentORs;
    static constexpr size_t MAX_OR_LOG = 20;
};

// ============================================================================
// OpenGL Resources
// ============================================================================

struct GLResources {
    // Shader program
    GLuint program = 0;

    // Vertex data (full‑screen quad for overlay)
    GLuint vao = 0;
    GLuint vbo = 0;

    // Textures
    GLuint attentionTexture = 0;    // Grid of attention head mini‑maps
    GLuint qualiaTexture = 0;       // Generated qualia visualization
    GLuint phiGraphTexture = 0;     // Φ time series (1D texture)

    // Uniform locations
    GLint uPanelRect = -1;          // vec4(x, y, w, h)
    GLint uOpacity = -1;
    GLint uTime = -1;
    GLint uPhiNormalized = -1;
    GLint uPhaseColor = -1;

    bool initialized = false;
};

// ============================================================================
// Font Renderer (bitmap font for text overlay)
// ============================================================================

class BitmapFontRenderer {
public:
    BitmapFontRenderer();
    ~BitmapFontRenderer();

    bool Initialize(const std::string& fontPath = "");
    void Shutdown();

    void RenderText(const std::string& text, float x, float y, float scale,
                    uint32_t color, int screenW, int screenH);

private:
    GLuint fontTexture_ = 0;
    GLuint fontVAO_ = 0;
    GLuint fontVBO_ = 0;
    GLuint fontProgram_ = 0;
    int charWidth_ = 8;
    int charHeight_ = 14;
    int charsPerRow_ = 16;
};

// ============================================================================
// OpenGL Overlay — Main Class
// ============================================================================

class PhiLiveOverlay {
public:
    explicit PhiLiveOverlay(const OverlayConfig& config = OverlayConfig{});
    ~PhiLiveOverlay();

    // Lifecycle
    bool Initialize(int screenWidth, int screenHeight);
    void Shutdown();
    void Resize(int screenWidth, int screenHeight);

    // Data update (call from PCA‑595 thread)
    void UpdateData(const OverlaySnapshot& snapshot);

    // Render (call from Live‑Coder render loop, after shader output)
    void Render();

    // Input handling
    void OnKeyPress(int key);
    void OnMouseMove(float x, float y);
    void OnMouseClick(int button, int action);

    // Visibility
    bool IsVisible() const { return visible_.load(); }
    void ToggleVisibility();
    void SetVisible(bool visible);

    // Configuration
    void SetConfig(const OverlayConfig& config);
    OverlayConfig GetConfig() const { return config_; }

    // FPS
    float GetRenderFPS() const { return renderFPS_.load(); }

private:
    OverlayConfig config_;
    std::atomic<bool> visible_{true};
    std::atomic<bool> initialized_{false};
    std::atomic<float> renderFPS_{0.0f};

    int screenW_ = 1920;
    int screenH_ = 1080;

    // Data
    OverlaySnapshot snapshot_;
    mutable std::mutex dataMutex_;

    // OpenGL resources
    GLResources gl_;
    std::unique_ptr<BitmapFontRenderer> fontRenderer_;

    // Render helpers
    void SetupShaders();
    void SetupGeometry();
    void UpdateTextures();
    void RenderPanel();
    void RenderPhiBar(float x, float y, float w, float h);
    void RenderPhiGraph(float x, float y, float w, float h);
    void RenderAttentionMaps(float x, float y, float size);
    void RenderXiMField(float x, float y, float w);
    void RenderPhaseIndicator(float x, float y, float radius);
    void RenderORLog(float x, float y, float w, float h);
    void RenderQualiaTexture(float x, float y, float size);

    // Panel coordinates (computed from config + screen size)
    struct PanelRect {
        int x, y, w, h;
    };
    PanelRect ComputePanelRect() const;

    // Color helpers
    std::array<float, 4> PhaseColor(ConsciousnessState::Phase phase) const;
    std::array<float, 3> HeatmapColor(float value) const;
    std::array<float, 4> PhiColor(float normalized) const;

    // FPS tracking
    std::deque<std::chrono::steady_clock::time_point> frameTimes_;
    void UpdateFPS();
};

// ============================================================================
// Overlay Manager — integrates with PCAEnabledDriver
// ============================================================================

class OverlayManager {
public:
    OverlayManager(PCAEnabledDriverAsync* driver, const OverlayConfig& config = OverlayConfig{});
    ~OverlayManager();

    bool Initialize(int screenWidth, int screenHeight);
    void Shutdown();

    // Called each frame by Live‑Coder
    void RenderFrame();

    // Called when PCA cycle completes
    void OnORComplete(const ORRecord& record);

    // Called when attention maps are available
    void OnAttentionMaps(const std::vector<std::vector<float>>& maps);

    // Called when new qualia are classified
    void OnQualiaClassified(const std::string& qualeClass, int chernNumber, double geometricPhase);

    // Input forwarding
    void OnKeyPress(int key);
    void OnMouseMove(float x, float y);

private:
    PCAEnabledDriverAsync* driver_;
    PhiLiveOverlay overlay_;
    std::thread dataThread_;
    std::atomic<bool> running_{false};

    void DataCollectionLoop();
    OverlaySnapshot BuildSnapshot();
};

} // namespace Overlay
} // namespace PCA
} // namespace Iris
} // namespace Arkhe
