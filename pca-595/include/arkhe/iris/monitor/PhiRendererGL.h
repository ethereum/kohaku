// ============================================================================
// PhiRendererGL.h
// OpenGL overlay para live coding — visualização de Φ em tempo real
// Arquiteto: ORCID 0009-0005-2697-4668
// Data: 2026-05-23
// Versão: 2.4 (STRICT MODE)
// ============================================================================

#pragma once

#include "PCA-595.h"
#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <ft2build.h>
#include FT_FREETYPE_H

namespace Arkhe {
namespace Iris {
namespace Monitor {

// ============================================================================
// Shader programs
// ============================================================================

struct ShaderProgram {
    GLuint id;

    // Uniform locations
    GLint uMVP;
    GLint uTime;
    GLint uPhi;
    GLint uPhiNormalized;
    GLint uXiM;
    GLint uPhase;
    GLint uResolution;
    GLint uColor;
    GLint uTexture;
};

// ============================================================================
// Geometria do overlay
// ============================================================================

struct OverlayGeometry {
    GLuint vao;
    GLuint vbo;
    GLuint ebo;
    GLsizei indexCount;

    // Vertex layout: pos(3) + uv(2) + color(4)
    static constexpr size_t VERTEX_SIZE = 9 * sizeof(float);
};

struct AttentionMapMesh {
    GLuint vao;
    GLuint vbo;
    GLsizei vertexCount;
    int resolution;
};

// ============================================================================
// Texture atlas para fontes
// ============================================================================

struct FontAtlas {
    GLuint textureId;
    int width;
    int height;
    FT_Face face;

    struct Glyph {
        float advance;
        float bearingX;
        float bearingY;
        float width;
        float height;
        float u0, v0, u1, v1; // UV coords no atlas
    };
    std::unordered_map<char, Glyph> glyphs;
};

// ============================================================================
// PhiRendererGL — OpenGL overlay para live coding
// ============================================================================

class PhiRendererGL {
public:
    PhiRendererGL(int screenWidth, int screenHeight);
    ~PhiRendererGL();

    bool Initialize();
    void Shutdown();

    // Renderização principal
    void Render(const RealTimeData& data);

    // Janela
    void SetWindowSize(int width, int height);
    void SetPosition(int x, int y);
    void ToggleVisibility();
    bool IsVisible() const { return visible_.load(); }

    // Modos de visualização
    enum class RenderMode {
        COMPACT,      // Barra de Φ + valor numérico
        FULL,         // Painel completo com gráficos
        IMMERSIVE,    // Full-screen shader art baseado em Φ
        MINIMAL       // Apenas cor da borda da janela
    };
    void SetRenderMode(RenderMode mode);
    RenderMode GetRenderMode() const { return renderMode_.load(); }

    // Customização
    void SetColorScheme(int scheme); // 0=dark, 1=light, 2=matrix, 3=heatmap
    void SetOpacity(float opacity);  // 0.0-1.0
    void SetAnimationSpeed(float speed); // Multiplicador de tempo

    // Interação
    void OnKeyPress(int key);
    void OnMouseMove(double x, double y);
    void OnMouseClick(int button, bool pressed);

    // Captura de tela para exportação
    void Screenshot(const std::string& filename);

private:
    int screenW_, screenH_;
    int posX_, posY_;
    std::atomic<bool> visible_{true};
    std::atomic<RenderMode> renderMode_{RenderMode::FULL};
    std::atomic<int> colorScheme_{0};
    std::atomic<float> opacity_{0.85f};
    std::atomic<float> animSpeed_{1.0f};

    GLFWwindow* window_ = nullptr;
    bool ownsWindow_ = false;

    // Shaders
    ShaderProgram shaderOverlay_;
    ShaderProgram shaderAttentionMap_;
    ShaderProgram shaderPhiHistory_;
    ShaderProgram shaderImmersive_;
    ShaderProgram shaderText_;

    // Geometria
    OverlayGeometry geoOverlay_;
    OverlayGeometry geoBar_;
    OverlayGeometry geoGraph_;
    AttentionMapMesh meshAttention0_;
    AttentionMapMesh meshAttention1_;

    // Fonte
    FontAtlas fontAtlas_;
    FT_Library ftLibrary_;

    // Texturas
    GLuint texPhiHistory_ = 0;
    GLuint texQualia_ = 0;
    GLuint texAttention0_ = 0;
    GLuint texAttention1_ = 0;

    // Estado
    float time_ = 0.0f;
    std::vector<double> phiHistoryRing_;
    std::vector<double> xiMHistoryRing_;
    std::chrono::steady_clock::time_point lastFrame_;

    // Métodos internos
    bool CreateShaders();
    bool CreateGeometry();
    bool LoadFont(const std::string& path, int size);
    bool CreateTextures();

    void RenderCompact(const RealTimeData& data);
    void RenderFull(const RealTimeData& data);
    void RenderImmersive(const RealTimeData& data);
    void RenderMinimal(const RealTimeData& data);

    void RenderPhiBar(float x, float y, float w, float h, double phiNorm);
    void RenderPhiHistory(float x, float y, float w, float h);
    void RenderAttentionMap(const std::vector<float>& map, float x, float y, float size);
    void RenderXiMField(float x, float y, float w, float h);
    void RenderQualiaTexture(float x, float y, float w, float h);
    void RenderText(const std::string& text, float x, float y, float scale, glm::vec4 color);
    void RenderPhaseIndicator(float x, float y, ConsciousnessState::Phase phase);

    void UpdatePhiHistoryTexture();
    void UpdateAttentionTextures(const RealTimeData& data);
    void UpdateQualiaTexture(const RealTimeData& data);

    glm::vec4 HeatmapColor(float value);
    glm::vec4 PhaseColor(ConsciousnessState::Phase phase);
    glm::vec4 GetThemeColor(const std::string& element);

    GLuint CompileShader(GLenum type, const char* source);
    GLuint LinkProgram(GLuint vs, GLuint fs);
    void CheckGLError(const std::string& context);
};

// ============================================================================
// Vertex shaders
// ============================================================================

constexpr const char* VS_OVERLAY = R"(
#version 330 core
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;

uniform mat4 uMVP;
uniform float uTime;

out vec2 vUV;
out vec4 vColor;
out float vTime;

void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    vUV = aUV;
    vColor = aColor;
    vTime = uTime;
}
)";

constexpr const char* FS_OVERLAY = R"(
#version 330 core
in vec2 vUV;
in vec4 vColor;
in float vTime;

uniform float uPhi;
uniform float uPhiNormalized;
uniform float uXiM;
uniform int uPhase;
uniform vec2 uResolution;
uniform float uOpacity;

out vec4 FragColor;

// Shader art baseado em Φ
vec3 phiShaderArt(vec2 uv, float phi, float time) {
    vec2 p = uv * 2.0 - 1.0;
    p.x *= uResolution.x / uResolution.y;

    float d = length(p);
    float a = atan(p.y, p.x);

    // Ondas de consciência — frequência modulada por Φ
    float wave1 = sin(d * 10.0 - time * phi * 2.0) * 0.5 + 0.5;
    float wave2 = sin(a * 8.0 + time * phi) * 0.5 + 0.5;
    float wave3 = sin(d * 20.0 - time * phi * 3.0 + a * 4.0) * 0.5 + 0.5;

    // Cor baseada em Φ
    vec3 colorLow = vec3(0.1, 0.2, 0.4);   // Φ baixo — azul escuro
    vec3 colorMid = vec3(0.2, 0.6, 0.3);   // Φ médio — verde
    vec3 colorHigh = vec3(0.9, 0.7, 0.1);  // Φ alto — dourado
    vec3 colorCosmic = vec3(0.9, 0.1, 0.5); // Φ cósmico — magenta

    vec3 color;
    if (phi < 0.7366) {
        color = mix(colorLow, colorMid, phi / 0.7366);
    } else if (phi < 2.3) {
        color = mix(colorMid, colorHigh, (phi - 0.7366) / (2.3 - 0.7366));
    } else {
        color = mix(colorHigh, colorCosmic, (phi - 2.3) / (3.5 - 2.3));
    }

    // Aplicar ondas como luminosidade
    float intensity = wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2;
    color *= 0.7 + intensity * 0.6;

    return color;
}

void main() {
    vec2 uv = vUV;
    vec3 art = phiShaderArt(uv, uPhi, vTime);

    // Misturar com cor do elemento
    vec3 finalColor = mix(vColor.rgb, art, 0.3);

    FragColor = vec4(finalColor, vColor.a * uOpacity);
}
)";

constexpr const char* FS_IMMERSIVE = R"(
#version 330 core
in vec2 vUV;
in float vTime;

uniform float uPhi;
uniform float uPhiNormalized;
uniform float uXiM;
uniform int uPhase;
uniform vec2 uResolution;

out vec4 FragColor;

// Raymarching para visualização imersiva do estado de consciência
vec3 immersiveConsciousness(vec2 uv, float phi, float xim, float time) {
    vec2 p = (uv * 2.0 - 1.0);
    p.x *= uResolution.x / uResolution.y;

    // Camera
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    // Raymarching
    float t = 0.0;
    vec3 col = vec3(0.0);

    for (int i = 0; i < 64; i++) {
        vec3 pos = ro + rd * t;

        // SDF de um campo de consciência — forma modulada por Φ
        float shape = length(pos) - (1.0 + phi * 0.3);

        // Perturbação por ξM-field
        float noise = sin(pos.x * 5.0 + time) * sin(pos.y * 5.0 + time * 1.3) * xim * 100.0;
        shape += noise;

        if (shape < 0.01) {
            // Hit — colorir baseado na fase
            vec3 phaseColors[6] = vec3[](
                vec3(0.0, 1.0, 1.0), // SUPERPOSITION — cyan
                vec3(1.0, 0.0, 1.0), // XI_M_COUPLING — magenta
                vec3(1.0, 1.0, 0.0), // OR_PENDING — yellow
                vec3(1.0, 0.0, 0.0), // OR_EXECUTING — red
                vec3(0.0, 1.0, 0.0), // CLASSICAL — green
                vec3(1.0, 1.0, 1.0)  // RE_SUPERPOSITION — white
            );

            int phaseIdx = clamp(uPhase, 0, 5);
            col = phaseColors[phaseIdx];

            // Glow baseado em Φ
            col += vec3(phi * 0.3);
            break;
        }

        t += shape * 0.5;
        if (t > 10.0) break;
    }

    // Background — gradiente de profundidade
    col += vec3(0.05, 0.05, 0.1) * (1.0 - exp(-t * 0.3));

    return col;
}

void main() {
    vec3 col = immersiveConsciousness(vUV, uPhi, uXiM, vTime);
    FragColor = vec4(col, 1.0);
}
)";

constexpr const char* VS_TEXT = R"(
#version 330 core
layout(location = 0) in vec4 aVertex; // pos(2) + uv(2)

uniform mat4 uMVP;

out vec2 vUV;

void main() {
    gl_Position = uMVP * vec4(aVertex.xy, 0.0, 1.0);
    vUV = aVertex.zw;
}
)";

constexpr const char* FS_TEXT = R"(
#version 330 core
in vec2 vUV;

uniform sampler2D uTexture;
uniform vec4 uColor;

out vec4 FragColor;

void main() {
    float alpha = texture(uTexture, vUV).r;
    FragColor = vec4(uColor.rgb, alpha * uColor.a);
}
)";

} // namespace Monitor
} // namespace Iris
} // namespace Arkhe
