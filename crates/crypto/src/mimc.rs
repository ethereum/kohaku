use std::{str::FromStr, sync::OnceLock};

use ark_bn254::Fr;
use ark_ff::{AdditiveGroup, Field};

use crate::mimc_constants::C_STR;

const N_ROUNDS: usize = C_STR.len(); // 220

static CONSTANTS: OnceLock<[Fr; N_ROUNDS]> = OnceLock::new();

pub fn mimc_sponge_hash(left: Fr, right: Fr) -> Fr {
    multi_hash(&[left, right], Fr::ZERO, 1)[0]
}

fn constants() -> &'static [Fr; N_ROUNDS] {
    CONSTANTS.get_or_init(|| {
        C_STR
            .iter()
            .map(|s| Fr::from_str(s).expect("valid field element"))
            .collect::<Vec<_>>()
            .try_into()
            .expect("correct length")
    })
}

fn hash(mut xl: Fr, mut xr: Fr, k: Fr) -> (Fr, Fr) {
    let cts = constants();
    let last = N_ROUNDS - 1;

    for (i, c) in cts.iter().enumerate() {
        let mut t = xl + k;
        if i > 0 {
            t += c;
        }
        let t5 = t.pow([5u64]);
        let xr_new = xr + t5;
        if i < last {
            xr = xl;
            xl = xr_new;
        } else {
            xr = xr_new;
        }
    }

    (xl, xr)
}

fn multi_hash(arr: &[Fr], key: Fr, num_outputs: usize) -> Vec<Fr> {
    let mut r = Fr::ZERO;
    let mut c = Fr::ZERO;

    for elem in arr {
        r += elem;
        (r, c) = hash(r, c, key);
    }

    let mut out = Vec::with_capacity(num_outputs);
    out.push(r);

    for _ in 1..num_outputs {
        (r, c) = hash(r, c, key);
        out.push(r);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mimc_sponge_hash() {
        let left = Fr::from(100);
        let right = Fr::from(200);

        let hash: ark_ff::Fp<ark_ff::MontBackend<ark_bn254::FrConfig, 4>, 4> =
            mimc_sponge_hash(left, right);
        let expected =
            "19959340151377300313091727919972631675102727336775656950865944133482941692341";
        assert_eq!(hash.to_string(), expected);
    }
}
