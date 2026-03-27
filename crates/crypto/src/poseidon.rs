use ark_bn254::Fr;
use ark_ff::PrimeField;
use ruint::aliases::U256;

pub fn poseidon_hash(inputs: &[U256]) -> Result<U256, poseidon_rust::error::Error> {
    let inputs: Vec<Fr> = inputs
        .iter()
        .map(|i| Fr::from_be_bytes_mod_order(&i.to_be_bytes::<32>()))
        .collect();
    let hash = poseidon_rust::poseidon_hash(&inputs)?;
    Ok(hash.into_bigint().into())
}
