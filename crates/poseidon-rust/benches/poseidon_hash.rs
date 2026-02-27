use ark_bn254::Fr;
use criterion::{criterion_group, criterion_main};
use poseidon_rust::poseidon_hash;
use rand::random;

fn benchmark_poseidon(c: &mut criterion::Criterion) {
    for t in 1..=13 {
        c.bench_function(&format!("poseidon_hash_{}", t), |b| {
            b.iter(|| {
                let r: u128 = random();
                let inputs = (0..t).map(|_| Fr::from(r)).collect::<Vec<_>>();
                poseidon_hash(&inputs).unwrap();
            });
        });
    }
}

criterion_group!(benches, benchmark_poseidon);
criterion_main!(benches);
