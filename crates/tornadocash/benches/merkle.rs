use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use rand::RngExt;
use ruint::aliases::U256;
use tornadocash::merkle::TornadoMerkleTree;

fn random_leaves(n: usize) -> Vec<U256> {
    let mut rng = rand::rng();
    (0..n)
        .map(|_| {
            let mut bytes = [0u8; 32];
            rng.fill(&mut bytes);
            bytes[0] = 0; // clamp to 248 bits, well under the BN254 field size (~254 bits)
            U256::from_be_bytes(bytes)
        })
        .collect()
}

fn bench_insert(c: &mut Criterion) {
    let mut group = c.benchmark_group("merkle_insert");

    for n in [1, 100, 10_000, 100_000] {
        let leaves = random_leaves(n);

        group.bench_with_input(BenchmarkId::from_parameter(n), &leaves, |b, leaves| {
            b.iter(|| {
                let mut tree = TornadoMerkleTree::new(0);
                tree.insert_leaves(leaves, 0);
            });
        });
    }

    group.finish();
}

criterion_group!(benches, bench_insert);
criterion_main!(benches);
