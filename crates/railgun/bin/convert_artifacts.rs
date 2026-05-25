//! Utility to convert circuit artifacts from their original snark-js .zkey format
//! into circom-friendly proving keys and matrices.
//!
//! Conversion step takes upward of 3 seconds in release mode, so we want to do this
//! once.

use std::io::Cursor;

use ark_bn254::{Bn254, Fr};
use ark_circom::read_zkey;
use ark_groth16::ProvingKey;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use railgun::crypto::serializable_np_index::SerializableNpIndex;
use tracing::info;

const IPFS_BASE: &str = "https://ipfs-lb.com/ipfs/QmUsmnK4PFc7zDp2cmC4wBZxYLjNyRgWfs5GNcJJ2uLcpU";

pub async fn main() {
    tracing_subscriber::fmt::init();

    for i in 1..6 {
        for j in 1..6 {
            let circuit_name = format!("0{}x0{}", i, j);
            convert_artifacts(&circuit_name).await;
        }
    }
}

async fn convert_artifacts(circuit_name: &str) {
    info!("Converting artifacts for circuit: {}", circuit_name);

    let url = format!("{}/circuits/{}/zkey.br", IPFS_BASE, circuit_name);
    info!("Downloading {}", url);
    let compressed = reqwest::get(&url).await.unwrap().bytes().await.unwrap();

    let mut zkey = Vec::new();
    brotli::BrotliDecompress(&mut compressed.as_ref(), &mut zkey).unwrap();

    info!("Parsing .zkey file");
    let mut cursor = Cursor::new(zkey);
    let (proving_key, matrices) = read_zkey(&mut cursor).unwrap();
    let matrices: SerializableNpIndex<_> = matrices.into();

    std::fs::create_dir_all(&circuit_name).unwrap();
    let wasm_path = format!("{}/wasm.br", circuit_name);
    let proving_key_path = format!("{}/proving_key.bin.br", circuit_name);
    let matrices_path = format!("{}/matrices.bin.br", circuit_name);

    let wasm_url = format!("{}/prover/snarkjs/{}.wasm.br", IPFS_BASE, circuit_name);
    info!("Downloading {}", wasm_url);
    let wasm_bytes = reqwest::get(&wasm_url)
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    std::fs::write(&wasm_path, &wasm_bytes).unwrap();

    let params = brotli::enc::BrotliEncoderParams::default();

    info!("Serializing proving key and matrices to disk");
    let mut proving_key_bytes = Vec::new();
    proving_key
        .serialize_uncompressed(&mut proving_key_bytes)
        .unwrap();
    let mut proving_key_file = std::fs::File::create(&proving_key_path).unwrap();
    brotli::BrotliCompress(
        &mut proving_key_bytes.as_slice(),
        &mut proving_key_file,
        &params,
    )
    .unwrap();
    proving_key_file.sync_all().unwrap();

    let mut matrices_bytes = Vec::new();
    matrices
        .serialize_uncompressed(&mut matrices_bytes)
        .unwrap();
    let mut matrices_file = std::fs::File::create(&matrices_path).unwrap();
    brotli::BrotliCompress(&mut matrices_bytes.as_slice(), &mut matrices_file, &params).unwrap();
    matrices_file.sync_all().unwrap();

    info!("Artifacts converted and saved to disk. Verifying...");

    let mut proving_key_disk = Vec::new();
    brotli::BrotliDecompress(
        &mut std::fs::read(&proving_key_path).unwrap().as_slice(),
        &mut proving_key_disk,
    )
    .unwrap();
    let proving_key_read_back =
        ProvingKey::<Bn254>::deserialize_uncompressed_unchecked(&mut Cursor::new(proving_key_disk))
            .expect("Failed to deserialize proving key");
    assert_eq!(proving_key, proving_key_read_back);

    let mut matrices_disk = Vec::new();
    brotli::BrotliDecompress(
        &mut std::fs::read(&matrices_path).unwrap().as_slice(),
        &mut matrices_disk,
    )
    .unwrap();
    let matrices_read_back = SerializableNpIndex::<Fr>::deserialize_uncompressed_unchecked(
        &mut Cursor::new(matrices_disk),
    )
    .expect("Failed to deserialize matrices");
    assert_eq!(matrices, matrices_read_back);

    info!(
        "Conversion complete. WASM saved to {}, proving key saved to {}, matrices saved to {}",
        wasm_path, proving_key_path, matrices_path
    );
}
