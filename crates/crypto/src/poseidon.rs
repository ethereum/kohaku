use ark_bn254::Fr;
use ark_ff::{BigInt, PrimeField};
use ruint::aliases::U256;

pub fn poseidon_hash(inputs: &[U256]) -> Result<U256, poseidon_rust::error::Error> {
    let inputs: Vec<Fr> = inputs.iter().map(|i| BigInt::from(i).into()).collect();
    let hash = poseidon_rust::poseidon_hash(&inputs)?;
    Ok(hash.into_bigint().into())
}
