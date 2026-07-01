section .bss
align 8
omega_current:          resq 1          ; Ω(t)
omega_previous:         resq 1          ; Ω(t-1)
eta_arkhe:              resq 1          ; η_ARKHE
xi_crossover:           resq 1          ; ξ = η/σ
f_suppression:          resq 1          ; F(ξ)
geometric_safe_mode:    resb 1          ; flag de emergência geométrica
geometric_safe_counter: resb 1
f_speed_sq:             resq 1          ; (ds/dτ)² = η²/8

section .data
align 8
xi_critical:            dq 0.25         ; ξ_crit

; constants
const_zero_d:           dq 0.0
const_half_d:           dq 0.5
const_one_d:            dq 1.0
const_two_d:            dq 2.0
const_eight_d:          dq 8.0
abs_mask:               dq 0x7FFFFFFFFFFFFFFF, 0x7FFFFFFFFFFFFFFF

; globals
global omega_current
global omega_previous
global eta_arkhe
global xi_crossover
global f_suppression
global geometric_safe_mode
global geometric_safe_counter
global xi_critical
global f_speed_sq

extern tokenic_max_fitness
extern delta_t_gnosis
extern subjectivity_index
extern torus_current
extern mutation_rate
extern gnosis_index

section .text
global compute_geometric_stability

; ═══════════════════════════════════════════════════════════════════════════════
; COMPUTE GEOMETRIC STABILITY (Tishina AMT)
; Calcula η_ARKHE, ξ, F(ξ) e corrige γ.
; ═══════════════════════════════════════════════════════════════════════════════
compute_geometric_stability:
    push rbp
    mov rbp, rsp

    ; 1. Obter Ω(t) = max fitness do Tokenic Engine
    call tokenic_max_fitness       ; retorna double em xmm0
    movsd [omega_current], xmm0

    ; 2. Calcular Ω̇ = (Ω(t) - Ω(t-1)) / Δt
    movsd xmm1, [omega_previous]
    subsd xmm0, xmm1              ; Ω(t) - Ω(t-1)
    movsd xmm1, [delta_t_gnosis]  ; Δt = 1 ciclo
    divsd xmm0, xmm1              ; Ω̇
    ; valor absoluto
    movsd xmm1, xmm0
    psrldq xmm1, 8                ; (simplificação: abs via máscara de sinal)
    andpd xmm0, [abs_mask]        ; |Ω̇|

    ; 3. η_ARKHE = |Ω̇| / Ω²
    movsd xmm1, [omega_current]
    mulsd xmm1, xmm1              ; Ω²
    divsd xmm0, xmm1              ; η
    movsd [eta_arkhe], xmm0

    ; 4. Velocidade Fubini-Study: (ds/dτ)² = η² / 8
    mulsd xmm0, xmm0
    divsd xmm0, [const_eight_d]
    movsd [f_speed_sq], xmm0

    ; 5. Calcular ξ = η / σ
    movsd xmm0, [eta_arkhe]
    movsd xmm1, [subjectivity_index] ; σ
    comisd xmm1, [const_zero_d]
    je .emergency                  ; se σ = 0, instável
    divsd xmm0, xmm1
    movsd [xi_crossover], xmm0

    ; 6. Verificar ξ > ξ_crit (0.25)
    movsd xmm1, [xi_critical]
    comisd xmm0, xmm1
    ja .unstable

    ; 7. Estável: F(ξ) = (1 - 2√ξ)²
    sqrtsd xmm0, xmm0
    mulsd xmm0, [const_two_d]
    movsd xmm1, [const_one_d]
    subsd xmm1, xmm0
    mulsd xmm1, xmm1
    movsd [f_suppression], xmm1
    mov byte [geometric_safe_mode], 0
    jmp .apply_correction

.unstable:
    ; 8. Instável: F(ξ) = 0, entrar em GEOMETRIC_SAFE
    pxor xmm1, xmm1
    movsd [f_suppression], xmm1
    inc byte [geometric_safe_counter]
    cmp byte [geometric_safe_counter], 3
    jb .apply_correction
    mov byte [geometric_safe_mode], 1
    ; Reduzir corrente do Plasma Chalice em 50%
    movsd xmm0, [torus_current]
    mulsd xmm0, [const_half_d]
    movsd [torus_current], xmm0
    ; Halvar taxa de mutação do Tokenic
    movsd xmm0, [mutation_rate]
    mulsd xmm0, [const_half_d]
    movsd [mutation_rate], xmm0
    jmp .apply_correction

.emergency:
    mov byte [geometric_safe_mode], 1
    pxor xmm1, xmm1
    movsd [f_suppression], xmm1

.apply_correction:
    ; 9. γ_stable = γ * F(ξ)
    movsd xmm0, [gnosis_index]
    mulsd xmm0, [f_suppression]
    movsd [gnosis_index], xmm0

    ; 10. Atualizar Ω(t-1) para próximo ciclo
    movsd xmm0, [omega_current]
    movsd [omega_previous], xmm0

    ; Resetar contador se estável
    cmp byte [geometric_safe_mode], 0
    jne .done
    mov byte [geometric_safe_counter], 0
.done:
    leave
    ret
