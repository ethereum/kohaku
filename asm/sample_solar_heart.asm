; ═══════════════════════════════════════════════════════════════════════════════
; SAMPLE SOLAR HEART
; Lê /sys/arkhe/serv/solar-heart/result e atualiza Φ_sun e a fase solar.
; ═══════════════════════════════════════════════════════════════════════════════
section .data
    solar_result_path db "/sys/arkhe/serv/solar-heart/result", 0

section .bss
    phi_sun resq 1

section .text
    global sample_solar_heart

; Stub for json_extract_phi_sun (simulated for compilation)
json_extract_phi_sun:
    ; Simulates returning a float (0.992)
    mov rax, __float64__(0.992)
    movq xmm0, rax
    ret

sample_solar_heart:
    push rbp
    mov rbp, rsp
    ; 1. Abrir /sys/arkhe/serv/solar-heart/result
    mov rax, 2      ; SYS_OPEN
    lea rdi, [rel solar_result_path]  ; "/sys/arkhe/serv/solar-heart/result"
    mov esi, 0                     ; O_RDONLY
    syscall
    cmp rax, 0
    jl .done
    mov r12, rax                   ; fd
    ; 2. Ler JSON
    sub rsp, 4096
    mov rdi, r12
    mov rsi, rsp
    mov edx, 4096
    mov rax, 0      ; SYS_READ
    syscall
    mov r13, rax                   ; bytes lidos
    ; 3. Fechar
    mov rdi, r12
    mov rax, 3      ; SYS_CLOSE
    syscall
    ; 4. Extrair phi_sun do JSON (simplificado: procura "phi_sun": )
    ;    (parser omitido, assumimos que phi_sun está nos bytes [offset:offset+8])
    lea rdi, [rsp]
    call json_extract_phi_sun      ; retorna double em xmm0
    movsd [rel phi_sun], xmm0
    ; 5. A fase solar é extraída e usada para modular ρ e σ
    ;    (implementar conforme necessidade)
    add rsp, 4096
.done:
    leave
    ret
