//! Utility to convert circuit artifacts from their original snark-js .zkey format
//! into circom-friendly proving keys and matrices.
//!
//! Conversion step takes upward of 3 seconds in release mode, so we want to do this
//! once.

// use std::io::Cursor;

// use ark_bn254::{Bn254, Fr};
// use ark_circom::read_zkey;
// use ark_groth16::ProvingKey;
// use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
// use clap::Parser;
// use railgun_rs::crypto::serializable_np_index::SerializableNpIndex;
// use tracing::info;

// #[derive(Parser)]
// #[command(name = "convert_artifacts")]
// #[command(about = "Convert circuit artifacts to serialized format", long_about = None)]
// struct Args {
//     /// Circuit name to convert
//     #[arg(value_name = "CIRCUIT_NAME")]
//     circuit_name: String,
// }

pub async fn main() {
    // tracing_subscriber::fmt::init();

    // let args = Args::parse();
    // info!("Converting artifacts for circuit: {}", args.circuit_name);

    // let zkey_path = format!("{}.zkey", args.circuit_name);
    // let zkey = std::fs::read(&zkey_path).unwrap();
    // let mut cursor = Cursor::new(zkey);
    // let (proving_key, matrices) = read_zkey(&mut cursor).unwrap();
    // let matrices: SerializableNpIndex<_> = matrices.into();

    // // Serialize to files
    // let proving_key_path = format!("{}_proving_key.bin", args.circuit_name).replace("/", "_");
    // let matrices_path = format!("{}_matrices.bin", args.circuit_name).replace("/", "_");

    // let proving_key_writer = std::fs::File::create(&proving_key_path).unwrap();
    // proving_key
    //     .serialize_compressed(&proving_key_writer)
    //     .unwrap();
    // proving_key_writer.sync_all().unwrap();

    // let matrices_writer = std::fs::File::create(&matrices_path).unwrap();
    // matrices.serialize_uncompressed(&matrices_writer).unwrap();
    // matrices_writer.sync_all().unwrap();

    // info!("Artifacts converted and saved to disk. Verifying...");
    // // Attempt to read back the proving key and matrices to verify they were written correctly
    // let proving_key_reader = std::fs::read(&proving_key_path).unwrap();
    // let mut proving_key_cursor = Cursor::new(proving_key_reader);
    // let proving_key_read_back =
    //     ProvingKey::<Bn254>::deserialize_uncompressed_unchecked(&mut proving_key_cursor)
    //         .expect("Failed to deserialize proving key");
    // assert_eq!(proving_key, proving_key_read_back);

    // let matrices_reader = std::fs::read(&matrices_path).unwrap();
    // let mut matrices_cursor = Cursor::new(matrices_reader);
    // let matrices_read_back =
    //     SerializableNpIndex::<Fr>::deserialize_uncompressed_unchecked(&mut matrices_cursor)
    //         .expect("Failed to deserialize matrices");
    // assert_eq!(matrices, matrices_read_back);

    // info!(
    //     "Conversion complete. Proving key saved to {}, matrices saved to {}",
    //     proving_key_path, matrices_path
    // );
}
