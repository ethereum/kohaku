#[cfg(not(target_arch = "wasm32"))]
criterion::criterion_main!(bench::benches);

#[cfg(target_arch = "wasm32")]
fn main() {}

#[cfg(not(target_arch = "wasm32"))]
mod bench {
    use std::collections::HashMap;

    use alloy::primitives::U256;
    use prover::Prover;
    use railgun_rs::circuit::native::{Groth16Prover, RemoteArtifactLoader};

    #[derive(Debug, serde::Deserialize)]
    struct ProveInput {
        pub circuit_name: String,
        pub inputs: HashMap<String, Vec<U256>>,
    }

    const PROVE_INPUT: &str = include_str!("groth16_prove_input.json");
    const ARTIFACTS_BASE_URL: &str = "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/";

    fn benchmark_groth16(c: &mut criterion::Criterion) {
        let prove_input: ProveInput = serde_json::from_str(PROVE_INPUT).expect("Invalid input");
        let artifact_loader = RemoteArtifactLoader::new(ARTIFACTS_BASE_URL);
        let prover = Groth16Prover::new(artifact_loader);

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        c.bench_function("groth16", |b| {
            b.iter(|| {
                rt.block_on(async {
                    prover
                        .prove(&prove_input.circuit_name, prove_input.inputs.clone())
                        .await
                        .unwrap()
                })
            });
        });
    }

    criterion::criterion_group!(
        name = benches;
        config = criterion::Criterion::default().sample_size(10);
        targets = benchmark_groth16
    );
}
