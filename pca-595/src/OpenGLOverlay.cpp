// ============================================================================
// OpenGLOverlay.cpp — Implementation
// ============================================================================

#include "OpenGLOverlay.h"
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <algorithm>
#include <numeric>
#include <sstream>
#include <iomanip>

namespace Arkhe {
namespace Iris {
namespace PCA {
namespace Overlay {

// Vertex shader for overlay panel
static const char* kOverlayVertexShader = R"(
#version 330 core
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aTexCoord;
out vec2 vTexCoord;
uniform vec4 uPanelRect; // x, y, width, height (normalized 0-1)
void main() {
    vec2 pos = uPanelRect.xy + aPos * uPanelRect.zw;
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
    vTexCoord = aTexCoord;
}
)";

// Fragment shader for overlay panel
static const char* kOverlayFragmentShader = R"(
#version 330 core
in vec2 vTexCoord;
out vec4 fragColor;
uniform float uOpacity;
uniform float uTime;
uniform float uPhiNormalized;
uniform vec4 uPhaseColor;
uniform sampler2D uAttentionTex;
uniform sampler2D uQualiaTex;
uniform sampler2D uPhiGraphTex;

vec3 heatmap(float t) {
    return vec3(
        smoothstep(0.0, 0.5, t) * 2.0,
        1.0 - abs(t - 0.5) * 2.0,
        smoothstep(0.5, 1.0, 1.0 - t) * 2.0
    );
}

void main() {
    vec2 uv = vTexCoord;

    // Background panel
    vec3 bg = vec3(0.05, 0.05, 0.08);
    float alpha = uOpacity;

    // Border glow based on Φ
    float borderDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * 20.0;
    float glow = exp(-borderDist * borderDist * 0.01) * uPhiNormalized;
    vec3 glowColor = uPhaseColor.rgb * glow;

    // Content areas would be rendered via multiple draw calls or sub-textures
    // For simplicity, we composite everything here

    fragColor = vec4(mix(bg, glowColor, glow), alpha);
}
)";

PhiLiveOverlay::PhiLiveOverlay(const OverlayConfig& config)
    : config_(config) {
}

PhiLiveOverlay::~PhiLiveOverlay() {
    Shutdown();
}

bool PhiLiveOverlay::Initialize(int screenWidth, int screenHeight) {
    if (initialized_.load()) return true;

    screenW_ = screenWidth;
    screenH_ = screenHeight;

    SetupShaders();
    SetupGeometry();

    fontRenderer_ = std::make_unique<BitmapFontRenderer>();
    fontRenderer_->Initialize();

    initialized_.store(true);
    return true;
}

void PhiLiveOverlay::SetupShaders() {
    // Compile vertex shader
    GLuint vs = glCreateShader(GL_VERTEX_SHADER);
    glShaderSource(vs, 1, &kOverlayVertexShader, nullptr);
    glCompileShader(vs);

    // Compile fragment shader
    GLuint fs = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(fs, 1, &kOverlayFragmentShader, nullptr);
    glCompileShader(fs);

    // Link program
    gl_.program = glCreateProgram();
    glAttachShader(gl_.program, vs);
    glAttachShader(gl_.program, fs);
    glLinkProgram(gl_.program);

    glDeleteShader(vs);
    glDeleteShader(fs);

    // Get uniform locations
    gl_.uPanelRect = glGetUniformLocation(gl_.program, "uPanelRect");
    gl_.uOpacity = glGetUniformLocation(gl_.program, "uOpacity");
    gl_.uTime = glGetUniformLocation(gl_.program, "uTime");
    gl_.uPhiNormalized = glGetUniformLocation(gl_.program, "uPhiNormalized");
    gl_.uPhaseColor = glGetUniformLocation(gl_.program, "uPhaseColor");
}

void PhiLiveOverlay::SetupGeometry() {
    // Full‑screen quad for panel rendering
    float vertices[] = {
        // pos        // texcoord
        0.0f, 0.0f,   0.0f, 0.0f,
        1.0f, 0.0f,   1.0f, 0.0f,
        1.0f, 1.0f,   1.0f, 1.0f,
        0.0f, 0.0f,   0.0f, 0.0f,
        1.0f, 1.0f,   1.0f, 1.0f,
        0.0f, 1.0f,   0.0f, 1.0f,
    };

    glGenVertexArrays(1, &gl_.vao);
    glGenBuffers(1, &gl_.vbo);

    glBindVertexArray(gl_.vao);
    glBindBuffer(GL_ARRAY_BUFFER, gl_.vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);

    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)(2 * sizeof(float)));
    glEnableVertexAttribArray(1);

    glBindVertexArray(0);
}

void PhiLiveOverlay::Render() {
    if (!visible_.load() || !initialized_.load()) return;

    UpdateFPS();

    OverlaySnapshot snap;
    {
        std::lock_guard<std::mutex> lock(dataMutex_);
        snap = snapshot_;
    }

    // Save OpenGL state
    GLboolean blendEnabled;
    GLboolean depthTest;
    GLint oldProgram;
    glGetBooleanv(GL_BLEND, &blendEnabled);
    glGetBooleanv(GL_DEPTH_TEST, &depthTest);
    glGetIntegerv(GL_CURRENT_PROGRAM, &oldProgram);

    // Setup overlay rendering
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDisable(GL_DEPTH_TEST);

    glUseProgram(gl_.program);

    // Compute panel position
    auto panel = ComputePanelRect();

    // Set uniforms
    float nx = static_cast<float>(panel.x) / screenW_;
    float ny = static_cast<float>(panel.y) / screenH_;
    float nw = static_cast<float>(panel.w) / screenW_;
    float nh = static_cast<float>(panel.h) / screenH_;
    glUniform4f(gl_.uPanelRect, nx, ny, nw, nh);
    glUniform1f(gl_.uOpacity, config_.opacity);
    glUniform1f(gl_.uTime, static_cast<float>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count() / 1000.0
    ));
    glUniform1f(gl_.uPhiNormalized, static_cast<float>(snap.phiNormalized));

    auto phaseCol = PhaseColor(snap.phase);
    glUniform4f(gl_.uPhaseColor, phaseCol[0], phaseCol[1], phaseCol[2], phaseCol[3]);

    // Bind attention texture
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, gl_.attentionTexture);
    glUniform1i(glGetUniformLocation(gl_.program, "uAttentionTex"), 0);

    // Draw panel background
    glBindVertexArray(gl_.vao);
    glDrawArrays(GL_TRIANGLES, 0, 6);

    // --- Render sub‑elements using bitmap font ---
    float x = static_cast<float>(panel.x + 10);
    float y = static_cast<float>(panel.y + 10);

    // Title
    fontRenderer_->RenderText("ARKHE PCA‑595 — Φ Monitor", x, y, 0.6f,
                              0xFFFFFFFF, screenW_, screenH_);
    y += 20;

    // Φ value
    std::stringstream ss;
    ss << "Φ: " << std::fixed << std::setprecision(4) << snap.phi << " bits";
    auto phiCol = PhiColor(snap.phiNormalized);
    uint32_t phiHex = (static_cast<uint8_t>(phiCol[3] * 255) << 24) |
                      (static_cast<uint8_t>(phiCol[2] * 255) << 16) |
                      (static_cast<uint8_t>(phiCol[1] * 255) << 8) |
                       static_cast<uint8_t>(phiCol[0] * 255);
    fontRenderer_->RenderText(ss.str(), x, y, 0.5f, phiHex, screenW_, screenH_);
    y += 16;

    // ξM‑field
    ss.str("");
    ss << "ξM: " << std::scientific << std::setprecision(2) << snap.xiMIntensity;
    fontRenderer_->RenderText(ss.str(), x, y, 0.5f, 0xFFCCCCCC, screenW_, screenH_);
    y += 16;

    // Phase
    ss.str("");
    const char* phaseNames[] = {"SUPERPOSITION", "XI_M_COUPLING", "OR_PENDING",
                                "OR_EXECUTING", "CLASSICAL", "RE_SUPERPOSITION"};
    ss << "Phase: " << phaseNames[static_cast<int>(snap.phase)];
    uint32_t phaseHex = (static_cast<uint8_t>(phaseCol[3] * 255) << 24) |
                        (static_cast<uint8_t>(phaseCol[2] * 255) << 16) |
                        (static_cast<uint8_t>(phaseCol[1] * 255) << 8) |
                         static_cast<uint8_t>(phaseCol[0] * 255);
    fontRenderer_->RenderText(ss.str(), x, y, 0.5f, phaseHex, screenW_, screenH_);
    y += 16;

    // Qualia class
    if (!snap.qualeClass.empty()) {
        ss.str("");
        ss << "Qualia: " << snap.qualeClass << " (C=" << snap.chernNumber << ")";
        fontRenderer_->RenderText(ss.str(), x, y, 0.4f, 0xFFAAAAAA, screenW_, screenH_);
        y += 14;
    }

    // OR count
    ss.str("");
    ss << "ORs: " << snap.orCount << " | Blocked: " << snap.blockedCount;
    fontRenderer_->RenderText(ss.str(), x, y, 0.4f, 0xFF888888, screenW_, screenH_);

    // --- Render Φ bar ---
    RenderPhiBar(x, y + 20, static_cast<float>(panel.w - 20), 16);

    // --- Render Φ history graph ---
    if (config_.showPhiGraph) {
        RenderPhiGraph(x, y + 50, static_cast<float>(panel.w - 20), 80);
    }

    // --- Render attention maps ---
    if (config_.showAttentionMaps && !snap.attentionMaps.empty()) {
        float attY = y + 145;
        RenderAttentionMaps(x, attY, static_cast<float>(config_.attentionMapSize));
    }

    // --- Render recent OR log ---
    if (config_.showORLog && !snap.recentORs.empty()) {
        float logY = y + 210;
        RenderORLog(x, logY, static_cast<float>(panel.w - 20), 200);
    }

    // Restore OpenGL state
    if (!blendEnabled) glDisable(GL_BLEND);
    if (depthTest) glEnable(GL_DEPTH_TEST);
    glUseProgram(oldProgram);
}

void PhiLiveOverlay::RenderPhiBar(float x, float y, float w, float h) {
    // Renders a horizontal bar showing Φ normalized
    float filled = static_cast<float>(snapshot_.phiNormalized) * w;
    filled = std::min(filled, w);

    // Background
    fontRenderer_->RenderText("┌──────────────────────────────────────────┐",
                              x, y - 14, 0.3f, 0xFF444444, screenW_, screenH_);

    // Filled portion using ASCII blocks (simplified — in production, use OpenGL quads)
    std::string bar;
    int totalBlocks = 40;
    int filledBlocks = static_cast<int>(snapshot_.phiNormalized * totalBlocks);
    for (int i = 0; i < totalBlocks; ++i) {
        bar += (i < filledBlocks) ? "█" : "░";
    }

    auto col = PhiColor(snapshot_.phiNormalized);
    uint32_t hex = (static_cast<uint8_t>(col[3] * 255) << 24) |
                   (static_cast<uint8_t>(col[2] * 255) << 16) |
                   (static_cast<uint8_t>(col[1] * 255) << 8) |
                    static_cast<uint8_t>(col[0] * 255);
    fontRenderer_->RenderText(bar, x, y, 0.4f, hex, screenW_, screenH_);

    std::stringstream ss;
    ss << " " << std::fixed << std::setprecision(0) << (snapshot_.phiNormalized * 100.0f) << "%";
    fontRenderer_->RenderText(ss.str(), x + static_cast<float>(totalBlocks * 8), y,
                              0.4f, 0xFFFFFFFF, screenW_, screenH_);
}

void PhiLiveOverlay::RenderPhiGraph(float x, float y, float w, float h) {
    if (snapshot_.phiHistory.empty()) return;

    // Simplified graph using character blocks
    fontRenderer_->RenderText("Φ History", x, y - 14, 0.4f, 0xFFFFFFFF, screenW_, screenH_);

    // Draw min/max lines
    std::stringstream ss;
    ss << "COSMIC " << std::fixed << std::setprecision(1) << config_.phiGraphMax;
    fontRenderer_->RenderText(ss.str(), x + w - 80, y, 0.3f, 0xFF444444, screenW_, screenH_);

    ss.str("");
    ss << config_.phiGraphMin;
    fontRenderer_->RenderText(ss.str(), x + w - 40, y + h - 10, 0.3f, 0xFF444444, screenW_, screenH_);

    // Simplified sparkline using Unicode blocks
    std::string sparkline;
    int cols = std::min(60, static_cast<int>(snapshot_.phiHistory.size()));
    double step = static_cast<double>(snapshot_.phiHistory.size()) / cols;

    for (int i = 0; i < cols; ++i) {
        size_t idx = static_cast<size_t>(i * step);
        if (idx >= snapshot_.phiHistory.size()) break;
        double val = (snapshot_.phiHistory[idx] - config_.phiGraphMin) /
                     (config_.phiGraphMax - config_.phiGraphMin);
        val = std::max(0.0, std::min(1.0, val));

        // Map to Unicode block characters
        if (val < 0.125) sparkline += " ";
        else if (val < 0.25) sparkline += "▁";
        else if (val < 0.375) sparkline += "▂";
        else if (val < 0.5) sparkline += "▃";
        else if (val < 0.625) sparkline += "▄";
        else if (val < 0.75) sparkline += "▅";
        else if (val < 0.875) sparkline += "▆";
        else sparkline += "█";
    }

    auto col = PhiColor(snapshot_.phiNormalized);
    uint32_t hex = (static_cast<uint8_t>(col[3] * 255) << 24) |
                   (static_cast<uint8_t>(col[2] * 255) << 16) |
                   (static_cast<uint8_t>(col[1] * 255) << 8) |
                    static_cast<uint8_t>(col[0] * 255);
    fontRenderer_->RenderText(sparkline, x, y + h / 2, 0.5f, hex, screenW_, screenH_);
}

void PhiLiveOverlay::RenderAttentionMaps(float x, float y, float size) {
    fontRenderer_->RenderText("Attention Maps", x, y - 14, 0.4f, 0xFFFFFFFF, screenW_, screenH_);

    int headsToShow = std::min(8, snapshot_.numAttentionHeads);
    float cellSize = size / 4; // 4 per row

    for (int h = 0; h < headsToShow; ++h) {
        if (h >= static_cast<int>(snapshot_.attentionMaps.size())) break;

        float hx = x + (h % 4) * (cellSize + 4);
        float hy = y + (h / 4) * (cellSize + 4);

        // Render simplified attention map as colored grid
        const auto& map = snapshot_.attentionMaps[h];
        int res = static_cast<int>(std::sqrt(static_cast<double>(map.size())));
        if (res * res != static_cast<int>(map.size())) res = 8;

        for (int i = 0; i < res && i < 8; ++i) {
            for (int j = 0; j < res && j < 8; ++j) {
                float val = map[i * res + j];
                auto col = HeatmapColor(val);
                // Draw tiny colored rectangle (simplified as colored character)
                std::string pixel = "█";
                uint32_t hex = (255 << 24) |
                               (static_cast<uint8_t>(col[2] * 255) << 16) |
                               (static_cast<uint8_t>(col[1] * 255) << 8) |
                                static_cast<uint8_t>(col[0] * 255);
                fontRenderer_->RenderText(pixel,
                    hx + j * (cellSize / 8), hy + i * (cellSize / 8),
                    0.2f, hex, screenW_, screenH_);
            }
        }
    }
}

void PhiLiveOverlay::RenderORLog(float x, float y, float w, float h) {
    fontRenderer_->RenderText("Recent OR Events", x, y - 14, 0.4f, 0xFFFFFFFF, screenW_, screenH_);

    float lineY = y;
    int linesShown = 0;
    int maxLines = static_cast<int>(h / 14);

    for (auto it = snapshot_.recentORs.rbegin();
         it != snapshot_.recentORs.rend() && linesShown < maxLines;
         ++it, ++linesShown) {
        std::stringstream ss;
        ss << it->timestamp.substr(11, 12) << " "  // time only
           << "Φ=" << std::fixed << std::setprecision(3) << it->phiPre
           << "→" << std::setprecision(3) << it->phiPost
           << " " << (it->alignmentPassed ? "✓" : "✗")
           << " " << std::setprecision(1) << it->latencyMs << "ms";

        uint32_t color = it->alignmentPassed ? 0xFF88FF88 : 0xFFFF8888;
        if (it->latencyMs < 0) color = 0xFFFFFF00; // Negative latency anomaly

        fontRenderer_->RenderText(ss.str(), x, lineY, 0.3f, color, screenW_, screenH_);
        lineY += 14;
    }
}

std::array<float, 4> PhiLiveOverlay::PhaseColor(ConsciousnessState::Phase phase) const {
    switch (phase) {
        case ConsciousnessState::Phase::SUPERPOSITION:    return {0.0f, 1.0f, 1.0f, 1.0f};  // Cyan
        case ConsciousnessState::Phase::XI_M_COUPLING:    return {1.0f, 0.0f, 1.0f, 1.0f};  // Magenta
        case ConsciousnessState::Phase::OR_PENDING:       return {1.0f, 1.0f, 0.0f, 1.0f};  // Yellow
        case ConsciousnessState::Phase::OR_EXECUTING:     return {1.0f, 0.3f, 0.0f, 1.0f};  // Orange
        case ConsciousnessState::Phase::CLASSICAL:        return {0.0f, 1.0f, 0.0f, 1.0f};  // Green
        case ConsciousnessState::Phase::RE_SUPERPOSITION: return {0.5f, 0.5f, 1.0f, 1.0f};  // Blue-purple
        default:                                          return {0.5f, 0.5f, 0.5f, 1.0f};
    }
}

std::array<float, 3> PhiLiveOverlay::HeatmapColor(float value) const {
    value = std::max(0.0f, std::min(1.0f, value));
    return {
        std::min(1.0f, value * 2.0f),
        1.0f - std::abs(value - 0.5f) * 2.0f,
        std::min(1.0f, (1.0f - value) * 2.0f)
    };
}

std::array<float, 4> PhiLiveOverlay::PhiColor(float normalized) const {
    normalized = std::max(0.0f, std::min(1.0f, normalized));
    if (normalized < 0.3f) return {0.2f, 0.8f, 1.0f, 1.0f};  // Blue (low)
    if (normalized < 0.7f) return {0.2f, 1.0f, 0.4f, 1.0f};  // Green (medium)
    return {1.0f, 0.8f, 0.2f, 1.0f};  // Gold (high, approaching cosmic)
}

PhiLiveOverlay::PanelRect PhiLiveOverlay::ComputePanelRect() const {
    PanelRect rect;
    rect.w = config_.panelWidth;
    rect.h = config_.panelHeight;

    switch (config_.dock) {
        case OverlayConfig::DockPosition::TOP_LEFT:
            rect.x = config_.marginX;
            rect.y = config_.marginY;
            break;
        case OverlayConfig::DockPosition::TOP_RIGHT:
            rect.x = screenW_ - rect.w - config_.marginX;
            rect.y = config_.marginY;
            break;
        case OverlayConfig::DockPosition::BOTTOM_LEFT:
            rect.x = config_.marginX;
            rect.y = screenH_ - rect.h - config_.marginY;
            break;
        case OverlayConfig::DockPosition::BOTTOM_RIGHT:
            rect.x = screenW_ - rect.w - config_.marginX;
            rect.y = screenH_ - rect.h - config_.marginY;
            break;
        case OverlayConfig::DockPosition::FLOATING:
            rect.x = (screenW_ - rect.w) / 2;
            rect.y = (screenH_ - rect.h) / 2;
            break;
    }
    return rect;
}

void PhiLiveOverlay::UpdateFPS() {
    auto now = std::chrono::steady_clock::now();
    frameTimes_.push_back(now);
    while (frameTimes_.size() > 60) frameTimes_.pop_front();

    if (frameTimes_.size() >= 2) {
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(
            frameTimes_.back() - frameTimes_.front()
        ).count();
        renderFPS_.store(static_cast<float>(frameTimes_.size() - 1) * 1'000'000.0f / duration);
    }
}

void PhiLiveOverlay::ToggleVisibility() {
    visible_.store(!visible_.load());
}

void PhiLiveOverlay::SetVisible(bool visible) {
    visible_.store(visible);
}

void PhiLiveOverlay::OnKeyPress(int key) {
    if (key == config_.toggleKey) {
        ToggleVisibility();
    } else if (key == config_.dockCycleKey) {
        int dock = static_cast<int>(config_.dock);
        dock = (dock + 1) % 5;
        config_.dock = static_cast<OverlayConfig::DockPosition>(dock);
    }
}

void PhiLiveOverlay::UpdateData(const OverlaySnapshot& snapshot) {
    std::lock_guard<std::mutex> lock(dataMutex_);
    snapshot_ = snapshot;
}

void PhiLiveOverlay::Resize(int screenWidth, int screenHeight) {
    screenW_ = screenWidth;
    screenH_ = screenHeight;
}

void PhiLiveOverlay::SetConfig(const OverlayConfig& config) {
    config_ = config;
}

void PhiLiveOverlay::Shutdown() {
    if (!initialized_.exchange(false)) return;

    if (gl_.vao) glDeleteVertexArrays(1, &gl_.vao);
    if (gl_.vbo) glDeleteBuffers(1, &gl_.vbo);
    if (gl_.program) glDeleteProgram(gl_.program);

    if (fontRenderer_) fontRenderer_->Shutdown();
}

// ============================================================================
// OverlayManager
// ============================================================================

OverlayManager::OverlayManager(PCAEnabledDriverAsync* driver, const OverlayConfig& config)
    : driver_(driver), overlay_(config) {
}

OverlayManager::~OverlayManager() {
    Shutdown();
}

bool OverlayManager::Initialize(int screenWidth, int screenHeight) {
    if (!overlay_.Initialize(screenWidth, screenHeight)) return false;

    running_.store(true);
    dataThread_ = std::thread(&OverlayManager::DataCollectionLoop, this);
    return true;
}

void OverlayManager::Shutdown() {
    running_.store(false);
    if (dataThread_.joinable()) dataThread_.join();
    overlay_.Shutdown();
}

void OverlayManager::RenderFrame() {
    overlay_.Render();
}

void OverlayManager::DataCollectionLoop() {
    while (running_.load()) {
        auto snapshot = BuildSnapshot();
        overlay_.UpdateData(snapshot);
        std::this_thread::sleep_for(std::chrono::milliseconds(33)); // ~30 FPS
    }
}

OverlaySnapshot OverlayManager::BuildSnapshot() {
    OverlaySnapshot snap;

    if (driver_) {
        auto* cycle = driver_->GetAsyncCycle();
        if (cycle) {
            snap.phi = cycle->CurrentPhi();
            snap.phiNormalized = snap.phi / PHI_COSMIC;
            snap.xiMIntensity = cycle->CurrentXiM();
            snap.phase = cycle->CurrentPhase();
            snap.orCount = cycle->TotalCycles();
            snap.blockedCount = cycle->BlockedByAlignment();
        }
    }

    return snap;
}

void OverlayManager::OnORComplete(const ORRecord& record) {
    OverlaySnapshot snap;
    {
        std::lock_guard<std::mutex> lock(overlay_.dataMutex_);
        snap = overlay_.snapshot_;
    }

    OverlaySnapshot::OREvent event;
    event.timestamp = std::to_string(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            record.orTimestamp.time_since_epoch()
        ).count()
    );
    event.phiPre = record.phiPreOR;
    event.phiPost = record.phiPostOR;
    event.alignmentPassed = record.alignmentPassed;
    event.latencyMs = record.latencyDeltaMs;

    snap.recentORs.push_back(event);
    while (snap.recentORs.size() > OverlaySnapshot::MAX_OR_LOG) {
        snap.recentORs.pop_front();
    }

    overlay_.UpdateData(snap);
}

void OverlayManager::OnAttentionMaps(const std::vector<std::vector<float>>& maps) {
    OverlaySnapshot snap = overlay_.snapshot_;
    snap.attentionMaps = maps;
    snap.numAttentionHeads = static_cast<int>(maps.size());
    overlay_.UpdateData(snap);
}

void OverlayManager::OnQualiaClassified(const std::string& qualeClass, int chernNumber, double geometricPhase) {
    OverlaySnapshot snap = overlay_.snapshot_;
    snap.qualeClass = qualeClass;
    snap.chernNumber = chernNumber;
    snap.geometricPhase = geometricPhase;
    overlay_.UpdateData(snap);
}

void OverlayManager::OnKeyPress(int key) {
    overlay_.OnKeyPress(key);
}

void OverlayManager::OnMouseMove(float x, float y) {
    overlay_.OnMouseMove(x, y);
}

} // namespace Overlay
} // namespace PCA
} // namespace Iris
} // namespace Arkhe
