use std::collections::HashMap;

use criterion::{BatchSize, Criterion, criterion_group, criterion_main};
use tornadocash::circuit::artifacts::RemoteArtifactLoader;
use websnark_rs::{
    circuit::{Value, generate_witness},
    proof::generate_random_proof,
};

const SIGNALS_DATA: &str = include_str!("./signals.json");

fn bench_witness(c: &mut Criterion) {
    let signals: HashMap<String, Value> = serde_json::from_str(SIGNALS_DATA).unwrap();
    let artifact_loader = RemoteArtifactLoader::default();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let circuit = rt.block_on(artifact_loader.load_circuit()).unwrap();

    c.bench_function("generate_witness", |b| {
        b.iter_batched(
            || (circuit.clone(), signals.clone()),
            |(circuit, signals)| {
                generate_witness(circuit, signals).unwrap();
            },
            BatchSize::SmallInput,
        );
    });
}

fn bench_prove(c: &mut Criterion) {
    let signals: HashMap<String, Value> = serde_json::from_str(SIGNALS_DATA).unwrap();
    let artifact_loader = RemoteArtifactLoader::default();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let circuit = rt.block_on(artifact_loader.load_circuit()).unwrap();
    let proving_key = rt.block_on(artifact_loader.load_proving_key()).unwrap();

    let witness = generate_witness(circuit, signals).unwrap();
    let mut rng = rand::rng();
    c.bench_function("generate_proof", |b| {
        b.iter_batched(
            || (proving_key.clone(), witness.clone()),
            |(pk, witness)| {
                generate_random_proof(pk, witness, &mut rng).unwrap();
            },
            BatchSize::SmallInput,
        );
    });
}

criterion_group! {
    name = benches;
    config = Criterion::default().sample_size(10);
    targets = bench_witness, bench_prove
}
criterion_main!(benches);
