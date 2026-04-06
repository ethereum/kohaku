#[cfg(not(target_arch = "wasm32"))]
criterion::criterion_main!(bench::benches);

#[cfg(target_arch = "wasm32")]
fn main() {}

#[cfg(not(target_arch = "wasm32"))]
mod bench {
    use std::hint::black_box;

    use criterion::criterion_group;
    use crypto::pedersen_hash;
    use rand::random;

    fn benchmark_pedersen(c: &mut criterion::Criterion) {
        c.bench_function("pedersen", |b| {
            b.iter(|| {
                let data: [u8; 32] = random();
                pedersen_hash(black_box(&data));
            });
        });
    }

    criterion_group!(benches, benchmark_pedersen);
}
