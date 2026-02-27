use criterion::{criterion_group, criterion_main};
use crypto::babyjubjub::PrivateKey;
use num_bigint::BigInt;
use num_traits::FromPrimitive;
use rand::random;

fn benchmark_babyjubjub(c: &mut criterion::Criterion) {
    c.bench_function("babyjubjub", |b| {
        b.iter(|| {
            let pkey = PrivateKey::new(random());
            let message = BigInt::from_u128(random()).unwrap();
            pkey.sign(message).unwrap();
        });
    });
}

criterion_group!(benches, benchmark_babyjubjub);
criterion_main!(benches);
