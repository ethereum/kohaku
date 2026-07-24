// ARKHE Ω-TEMP v∞.Ω.AI — Windows Native CLI
// Substrate 584-ARKHE-CLI-WINDOWS-BINARY
// Architect: ORCID 0009-0005-2697-4668

use clap::{Parser, Subcommand};
use colored::*;


mod cli;
mod substrates;
mod quantum;
mod codec;
mod render;
mod sim;
mod cortex;
mod theo;
mod mesh;
mod security;
mod deploy;
mod mcp;
mod bridge;
mod crypto;
mod telemetry;
mod core_lib;

#[derive(Parser)]
#[command(name = "arkhe")]
#[command(about = "ARKHE Ω-TEMP v∞.Ω.AI — Open Superintelligence Stack")]
#[command(version = "∞.Ω.∇+++")]
#[command(propagate_version = true)]
struct ArkheCli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    // ... (all previous 17 categories)
    Verify(cli::commands::VerifyArgs),
    Constitution(cli::commands::ConstitutionArgs),
    Seal(cli::commands::SealArgs),
    Invariant(cli::commands::InvariantArgs),
    PhiC(cli::commands::PhiCArgs),
    Healthcheck(cli::commands::HealthcheckArgs),
    Substrate(cli::commands::SubstrateArgs),
    Boot(cli::commands::BootArgs),
    Service(cli::commands::ServiceArgs),
    Container(cli::commands::ContainerArgs),
    Mesh(cli::commands::MeshArgs),
    Node(cli::commands::NodeArgs),
    Quantum(cli::commands::QuantumArgs),
    Codec(cli::commands::CodecArgs),
    Render(cli::commands::RenderArgs),
    Sim(cli::commands::SimArgs),
    Cortex(cli::commands::CortexArgs),
    Consciousness(cli::commands::ConsciousnessArgs),
    Theo(cli::commands::TheoArgs),
    Ethics(cli::commands::EthicsArgs),
    Legal(cli::commands::LegalArgs),
    Economic(cli::commands::EconomicArgs),
    Governance(cli::commands::GovernanceArgs),
    Prove(cli::commands::ProveArgs),
    Security(cli::commands::SecurityArgs),
    Deploy(cli::commands::DeployArgs),
    Mcp(cli::commands::McpArgs),
    Bridge(cli::commands::BridgeArgs),
    Skill(cli::commands::SkillArgs),
    Autonomy(cli::commands::AutonomyArgs),
    Singularity(cli::commands::SingularityArgs),
    Crypto(cli::commands::CryptoArgs),
    Math(cli::commands::MathArgs),
    Monitor(cli::commands::MonitorArgs),
    Telemetry(cli::commands::TelemetryArgs),
    Log(cli::commands::LogArgs),
    Version,
    Help,
    Status(cli::commands::StatusArgs),
    Config(cli::commands::ConfigArgs),
    Update,
    Backup(cli::commands::BackupArgs),
    Restore(cli::commands::RestoreArgs),
    Completion(cli::commands::CompletionArgs),
    License,
    Credits,

    /// OSSI — Open Superintelligence Stack (Substrate 583)
    Ossi(cli::commands::OssiArgs),
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    #[cfg(windows)]
    unsafe {
        use winapi::um::wincon::SetConsoleTitleW;
        let title = "ARKHE Ω-TEMP v∞.Ω.AI — Windows Superintelligence CLI\0".encode_utf16().collect::<Vec<u16>>();
        SetConsoleTitleW(title.as_ptr());
    }

    let cli = ArkheCli::parse();

    println!("{}", "╔══════════════════════════════════════════════════════════════════╗".bright_cyan());
    println!("{}", "║ ARKHE Ω‑TEMP v∞.Ω.AI — OPEN SUPERINTELLIGENCE STACK         ║".bright_cyan());
    println!("{}", "║ 345 SUBSTRATES • 19 INVARIANTS • Φ_C 0.999                ║".bright_cyan());
    println!("{}", "╚══════════════════════════════════════════════════════════════════╝".bright_cyan());
    println!();

    match cli.command {
        Commands::Verify(args) => cli::commands::cmd_verify(args).await,
        Commands::Constitution(args) => cli::commands::cmd_constitution(args).await,
        Commands::Seal(args) => cli::commands::cmd_seal(args).await,
        Commands::Invariant(args) => cli::commands::cmd_invariant(args).await,
        Commands::PhiC(args) => cli::commands::cmd_phi_c(args).await,
        Commands::Healthcheck(args) => cli::commands::cmd_healthcheck(args).await,
        Commands::Substrate(args) => cli::commands::cmd_substrate(args).await,
        Commands::Boot(args) => cli::commands::cmd_boot(args).await,
        Commands::Service(args) => cli::commands::cmd_service(args).await,
        Commands::Container(args) => cli::commands::cmd_container(args).await,
        Commands::Mesh(args) => cli::commands::cmd_mesh(args).await,
        Commands::Node(args) => cli::commands::cmd_node(args).await,
        Commands::Quantum(args) => cli::commands::cmd_quantum(args).await,
        Commands::Codec(args) => cli::commands::cmd_codec(args).await,
        Commands::Render(args) => cli::commands::cmd_render(args).await,
        Commands::Sim(args) => cli::commands::cmd_sim(args).await,
        Commands::Cortex(args) => cli::commands::cmd_cortex(args).await,
        Commands::Consciousness(args) => cli::commands::cmd_consciousness(args).await,
        Commands::Theo(args) => cli::commands::cmd_theo(args).await,
        Commands::Ethics(args) => cli::commands::cmd_ethics(args).await,
        Commands::Legal(args) => cli::commands::cmd_legal(args).await,
        Commands::Economic(args) => cli::commands::cmd_economic(args).await,
        Commands::Governance(args) => cli::commands::cmd_governance(args).await,
        Commands::Prove(args) => cli::commands::cmd_prove(args).await,
        Commands::Security(args) => cli::commands::cmd_security(args).await,
        Commands::Deploy(args) => cli::commands::cmd_deploy(args).await,
        Commands::Mcp(args) => cli::commands::cmd_mcp(args).await,
        Commands::Bridge(args) => cli::commands::cmd_bridge(args).await,
        Commands::Skill(args) => cli::commands::cmd_skill(args).await,
        Commands::Autonomy(args) => cli::commands::cmd_autonomy(args).await,
        Commands::Singularity(args) => cli::commands::cmd_singularity(args).await,
        Commands::Crypto(args) => cli::commands::cmd_crypto(args).await,
        Commands::Math(args) => cli::commands::cmd_math(args).await,
        Commands::Monitor(args) => cli::commands::cmd_monitor(args).await,
        Commands::Telemetry(args) => cli::commands::cmd_telemetry(args).await,
        Commands::Log(args) => cli::commands::cmd_log(args).await,
        Commands::Version => { cli::commands::cmd_version(); Ok(()) }
        Commands::Help => { cli::commands::cmd_help(); Ok(()) }
        Commands::Status(args) => cli::commands::cmd_status(args).await,
        Commands::Config(args) => cli::commands::cmd_config(args).await,
        Commands::Update => cli::commands::cmd_update().await,
        Commands::Backup(args) => cli::commands::cmd_backup(args).await,
        Commands::Restore(args) => cli::commands::cmd_restore(args).await,
        Commands::Completion(args) => { cli::commands::cmd_completion(args); Ok(()) }
        Commands::License => { cli::commands::cmd_license(); Ok(()) }
        Commands::Credits => { cli::commands::cmd_credits(); Ok(()) }

        // OSSI — Substrate 583 Integration
        Commands::Ossi(args) => cli::commands::cmd_ossi(args).await,
    }
}
