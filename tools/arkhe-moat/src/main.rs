// supply_chain_coherence.rs — Calcula Φ_C do grafo de dependências
// Substrato 823-RUST-SECURE-SUPPLY-CHAIN
// Arquitecto: ORCID 0009-0005-2697-4668
// Data: 2026-05-25

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
struct Package {
    name: String,
    version: String,
    maintainer_verified: bool,
    signature_valid: bool,
    dependencies: Vec<String>,
    coherence: f64, // Φ individual
}

impl Package {
    fn new(name: &str, version: &str, verified: bool, sig_valid: bool) -> Self {
        Self {
            name: name.to_string(),
            version: version.to_string(),
            maintainer_verified: verified,
            signature_valid: sig_valid,
            dependencies: vec![],
            coherence: 0.0,
        }
    }

    fn compute_coherence(&mut self) -> f64 {
        // Coerência baseada em verificabilidade
        let base: f64 = if self.maintainer_verified { 0.7 } else { 0.3 };
        let sig: f64 = if self.signature_valid { 0.3 } else { 0.0 };
        self.coherence = (base + sig).min(1.0);
        self.coherence
    }
}

struct SupplyChainGraph {
    packages: HashMap<String, Package>,
    edges: Vec<(String, String)>, // (dependent, dependency)
}

impl SupplyChainGraph {
    fn new() -> Self {
        Self { packages: HashMap::new(), edges: vec![] }
    }

    fn add_package(&mut self, pkg: Package) {
        self.packages.insert(pkg.name.clone(), pkg);
    }

    fn add_dependency(&mut self, dependent: &str, dependency: &str) {
        self.edges.push((dependent.to_string(), dependency.to_string()));
        if let Some(pkg) = self.packages.get_mut(dependent) {
            pkg.dependencies.push(dependency.to_string());
        }
    }

    /// Calcula o parâmetro de ordem de Kuramoto do grafo de supply chain.
    /// r_supply_chain = |(1/N) Σ exp(iθ_j)| onde θ_j = arccos(Φ_C(pkg_j))
    fn compute_order_parameter(&mut self) -> f64 {
        // Atualizar coerência individual
        let mut phases: Vec<f64> = vec![];
        for (_, pkg) in self.packages.iter_mut() {
            pkg.compute_coherence();
            let theta = pkg.coherence.acos(); // fase a partir da coerência
            phases.push(theta);
        }

        if phases.is_empty() { return 0.0; }

        let n = phases.len() as f64;
        let real: f64 = phases.iter().map(|&t| t.cos()).sum();
        let imag: f64 = phases.iter().map(|&t| t.sin()).sum();
        (real * real + imag * imag).sqrt() / n
    }

    /// Verifica se o grafo está acima do Ghost Threshold (0.577)
    fn is_trustworthy(&mut self) -> (f64, bool) {
        let r = self.compute_order_parameter();
        (r, r > 0.577)
    }

    /// Detecta pacotes "equivocadores" (múltiplas versões conflitantes)
    fn detect_conflicts(&self) -> Vec<String> {
        let mut name_versions: HashMap<&str, HashSet<&str>> = HashMap::new();
        for (_, pkg) in &self.packages {
            name_versions.entry(&pkg.name)
                .or_insert_with(HashSet::new)
                .insert(&pkg.version);
        }
        name_versions.iter()
            .filter(|(_, versions)| versions.len() > 1)
            .map(|(name, _)| name.to_string())
            .collect()
    }
}

fn main() {
    let mut graph = SupplyChainGraph::new();

    // Simular um ecossistema com pacotes verificados e não verificados
    graph.add_package(Package::new("laravel/framework", "11.0", true, true));
    graph.add_package(Package::new("monolog/monolog", "3.5", true, true));
    graph.add_package(Package::new("unknown/left-pad", "1.0", false, false));
    graph.add_package(Package::new("rust-tooling/moat", "1.0", true, true));
    graph.add_package(Package::new("compromised/evil-pkg", "0.1", false, false));

    graph.add_dependency("laravel/framework", "monolog/monolog");
    graph.add_dependency("laravel/framework", "unknown/left-pad");
    graph.add_dependency("rust-tooling/moat", "unknown/left-pad"); // depende de pacote não verificado

    let (r, trustworthy) = graph.is_trustworthy();
    let conflicts = graph.detect_conflicts();

    println!("=== SUPPLY CHAIN COHERENCE REPORT ===");
    println!("r_supply_chain = {:.4}", r);
    println!("Ghost Threshold (0.577): {}", if trustworthy { "ABOVE ✓" } else { "BELOW ✗" });
    println!("Trustworthy: {}", if trustworthy { "YES" } else { "NO — supply chain at risk" });

    if !conflicts.is_empty() {
        println!("\n⚠️  CONFLICTS DETECTED (equivocators):");
        for c in &conflicts {
            println!("  - {} has multiple versions", c);
        }
    }

    println!("\n=== PACKAGE COHERENCE ===");
    for (_, pkg) in &graph.packages {
        let status = if pkg.coherence > 0.577 { "✓" } else { "✗" };
        println!("  {} {}: Φ = {:.4} {}", pkg.name, pkg.version, pkg.coherence, status);
    }
}
