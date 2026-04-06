mod bn254;
pub mod error;
mod parameters;
mod poseidon;

use ark_bn254::Fr;
use ark_ff::PrimeField;
use num_bigint::BigUint;
use num_traits::Num;
use poseidon::Poseidon;

use crate::{
    bn254::{
        circom_t10::get_t10_params, circom_t11::get_t11_params, circom_t12::get_t12_params,
        circom_t13::get_t13_params, circom_t14::get_t14_params, circom_t2::get_t2_params,
        circom_t3::get_t3_params, circom_t4::get_t4_params, circom_t5::get_t5_params,
        circom_t6::get_t6_params, circom_t7::get_t7_params, circom_t8::get_t8_params,
        circom_t9::get_t9_params,
    },
    error::Error,
};

pub fn poseidon_hash(inputs: &[Fr]) -> Result<Fr, Error> {
    let mut state = vec![Fr::from(0)];
    state.extend_from_slice(inputs);

    let out = match state.len() {
        2 => Poseidon::new(&get_t2_params()).permutation(state)?,
        3 => Poseidon::new(&get_t3_params()).permutation(state)?,
        4 => Poseidon::new(&get_t4_params()).permutation(state)?,
        5 => Poseidon::new(&get_t5_params()).permutation(state)?,
        6 => Poseidon::new(&get_t6_params()).permutation(state)?,
        7 => Poseidon::new(&get_t7_params()).permutation(state)?,
        8 => Poseidon::new(&get_t8_params()).permutation(state)?,
        9 => Poseidon::new(&get_t9_params()).permutation(state)?,
        10 => Poseidon::new(&get_t10_params()).permutation(state)?,
        11 => Poseidon::new(&get_t11_params()).permutation(state)?,
        12 => Poseidon::new(&get_t12_params()).permutation(state)?,
        13 => Poseidon::new(&get_t13_params()).permutation(state)?,
        14 => Poseidon::new(&get_t14_params()).permutation(state)?,
        _ => return Err(Error::UnsupportedInputLength(state.len())),
    };

    Ok(out[0])
}

#[allow(dead_code)]
fn field_from_hex_string<F: PrimeField>(str: &str) -> Result<F, Error> {
    let tmp = match str.strip_prefix("0x") {
        Some(t) => BigUint::from_str_radix(t, 16),
        None => BigUint::from_str_radix(str, 16),
    };

    let tmp = tmp.map_err(|_| Error::ParseString)?;
    Ok(tmp.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poseidon_hash() {
        let expected = vec![
            "19014214495641488759237505126948346942972912379615652741039992445865937985820",
            "12583541437132735734108669866114103169564651237895298778035846191048104863326",
            "8599452571108419911675042369134657596129797276905188988960674134744449929238",
            "4050345352754260300667252706570081029004026400044882557845061748628670512780",
            "1475992993236322576209363326357087103599755887159177217587002895783839174540",
            "2579592068985894564663884204285667087640059297900666937160965942401359072100",
            "20329113756446417239599955060882819799955615300225172556927540370625639639591",
            "21656500796439224421257401895129482535503528269793362483330745763391692399728",
            "14408976789489036679302672303794802454823291363240129034501311453268715567967",
            "830312311503515836401584074612726804626276011883476452565502338584358217994",
            "16482319307391173079257078223199649745782806293396026512574082249553342763664",
            "9229882540043959809176016464298330440879059374171305180729988720176368448252",
            "14044108921269203222904300236541952095368226907391252621253021080476169222351",
        ];

        for (i, expected) in expected.iter().enumerate() {
            let inputs: Vec<Fr> = (0..=i).map(|j| Fr::from(j as u128)).collect();
            println!("Testing with {:?}", inputs);
            let hash = poseidon_hash(&inputs).unwrap();
            assert_eq!(expected.to_string(), hash.to_string());
        }
    }
}
