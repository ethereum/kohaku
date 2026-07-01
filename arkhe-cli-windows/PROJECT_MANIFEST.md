# ARKHE CLI Windows Project Manifest

## Substrate 584-ARKHE-CLI-WINDOWS-BINARY v1.0

### Project Structure
```
arkhe-cli-windows/
├── Cargo.toml              # Rust manifest (28 dependencies)
├── build.rs                # Windows resource compiler
├── src/
│   ├── main.rs             # Entry point (18 categories + OSSI)
│   ├── cli/
│   │   ├── mod.rs
│   │   ├── commands.rs       # 100+ command handlers (1,800+ lines)
│   │   ├── parser.rs
│   │   └── completions.rs
│   ├── substrates/         # 227-F, 470, 524, 525
│   ├── quantum/            # 557, 562, 563, 569
│   ├── codec/              # 576, 577, 582
│   ├── render/             # 450, 485
│   ├── sim/                # 484, 507, 536, 551, 571, 583
│   ├── cortex/             # 491, 511, 512, 575
│   ├── theo/               # 227-F, 556
│   ├── mesh/               # 375, 561
│   ├── security/           # 521, 531, 558, 560
│   ├── deploy/             # 449, 562, 566, 572
│   ├── mcp/                # 564
│   ├── bridge/             # 522, 523, 527, 570
│   ├── crypto/             # 473, 537
│   ├── telemetry/          # 470, 474
│   └── lib/                # seal, phi_c, invariant, config
├── assets/
│   ├── icon.ico
│   └── manifest.xml        # UAC requireAdministrator
├── scripts/
│   ├── launcher.bat        # Windows wrapper
│   └── build.ps1           # PowerShell pipeline
├── wix/
│   ├── arkhe.wxs           # Main WiX source
│   ├── heat.bat            # Harvesting script
│   └── build-msi.bat       # MSI builder
├── docs/
│   ├── LICENSE.rtf         # AGPL-3.0 + Royaltes
│   └── ARKHE_CLI_REFERENCE.md
└── tests/
    ├── integration_tests.rs
    ├── constitutional_tests.rs
    └── ossi_integration_tests.rs  # 584↔583 tests
```

### Commands (18 + 1 OSSI = 19 categories)
1. Constitution & Verification (verify, constitution, seal, invariant, phi-c, healthcheck)
2. Substrate Management (substrate)
3. Boot & Runtime (boot, service, container)
4. Mesh Network (mesh, node)
5. Quantum Operations (quantum)
6. Codecs (codec mp3, codec jpeg)
7. Rendering (render)
8. Simulation (sim)
9. AGI & Consciousness (cortex, consciousness)
10. Theology & Ethics (theo, ethics)
11. Legal & Economic (legal, economic, governance)
12. Provenance & Security (prove, security)
13. Deployment (deploy, mcp, bridge)
14. Skills & Autonomy (skill, autonomy, singularity)
15. Cryptography (crypto, math)
16. Monitoring (monitor, telemetry, log)
17. System (version, help, status, config, update, backup, restore, completion, license, credits)
18. **OSSI** (ossi verify, ossi render, ossi task, ossi stress, ossi registry, ossi sim)

### Cross-Substrate Integration
- **583-OSSI-STACK**: `arkhe ossi` command category (6 subcommands)
- **576-MP3-XI**: `arkhe codec mp3` (encode/decode/analyze/stream)
- **564-MCP**: `arkhe mcp` (connect/discover/tool)
- **573-NEURAL-LATTICE**: `arkhe consciousness bci` (connect/sync)
- **556-ΘΕΟΣΙΣ**: `arkhe theo` (monitor/reason/apophatic)

### Build
```powershell
# Development
cargo run -- --help

# Release (Windows)
cargo build --release --target x86_64-pc-windows-msvc

# MSI Installer
.\wix\heat.bat
.\wix\build-msi.bat
```

### Φ_C
- Standard 18-inv: **0.990900**
- DCS-584-DEPLOY: 0.994500
- Selo: `7d18c371...`
