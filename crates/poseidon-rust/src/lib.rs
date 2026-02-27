mod bn254;
pub mod error;
mod parameters;
mod poseidon;

use crate::{
    bn254::{
        circom_t10::POSEIDON_CIRCOM_BN_10_PARAMS, circom_t11::POSEIDON_CIRCOM_BN_11_PARAMS,
        circom_t12::POSEIDON_CIRCOM_BN_12_PARAMS, circom_t13::POSEIDON_CIRCOM_BN_13_PARAMS,
        circom_t14::POSEIDON_CIRCOM_BN_14_PARAMS, circom_t2::POSEIDON_CIRCOM_BN_2_PARAMS,
        circom_t3::POSEIDON_CIRCOM_BN_3_PARAMS, circom_t4::POSEIDON_CIRCOM_BN_4_PARAMS,
        circom_t5::POSEIDON_CIRCOM_BN_5_PARAMS, circom_t6::POSEIDON_CIRCOM_BN_6_PARAMS,
        circom_t7::POSEIDON_CIRCOM_BN_7_PARAMS, circom_t8::POSEIDON_CIRCOM_BN_8_PARAMS,
        circom_t9::POSEIDON_CIRCOM_BN_9_PARAMS,
    },
    error::Error,
};
use ark_bn254::Fr;
use ark_ff::PrimeField;
use num_bigint::BigUint;
use num_traits::Num;
use poseidon::Poseidon;

pub fn poseidon_hash(inputs: &[Fr]) -> Result<Fr, Error> {
    let mut state = vec![Fr::from(0)];
    state.extend_from_slice(inputs);

    let out = match state.len() {
        2 => Poseidon::new(&POSEIDON_CIRCOM_BN_2_PARAMS).permutation(state)?,
        3 => Poseidon::new(&POSEIDON_CIRCOM_BN_3_PARAMS).permutation(state)?,
        4 => Poseidon::new(&POSEIDON_CIRCOM_BN_4_PARAMS).permutation(state)?,
        5 => Poseidon::new(&POSEIDON_CIRCOM_BN_5_PARAMS).permutation(state)?,
        6 => Poseidon::new(&POSEIDON_CIRCOM_BN_6_PARAMS).permutation(state)?,
        7 => Poseidon::new(&POSEIDON_CIRCOM_BN_7_PARAMS).permutation(state)?,
        8 => Poseidon::new(&POSEIDON_CIRCOM_BN_8_PARAMS).permutation(state)?,
        9 => Poseidon::new(&POSEIDON_CIRCOM_BN_9_PARAMS).permutation(state)?,
        10 => Poseidon::new(&POSEIDON_CIRCOM_BN_10_PARAMS).permutation(state)?,
        11 => Poseidon::new(&POSEIDON_CIRCOM_BN_11_PARAMS).permutation(state)?,
        12 => Poseidon::new(&POSEIDON_CIRCOM_BN_12_PARAMS).permutation(state)?,
        13 => Poseidon::new(&POSEIDON_CIRCOM_BN_13_PARAMS).permutation(state)?,
        14 => Poseidon::new(&POSEIDON_CIRCOM_BN_14_PARAMS).permutation(state)?,
        _ => return Err(Error::UnsupportedInputLength(state.len())),
    };

    Ok(out[0])
}

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
