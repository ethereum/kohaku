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

fn pow5(t: Fr) -> Fr {
    let t2 = t.square();
    t2.square() * t
}

fn hash(mut xl: Fr, mut xr: Fr, k: Fr) -> (Fr, Fr) {
    let cts = constants();
    let last = N_ROUNDS - 1;

    let t5 = pow5(xl + k);
    xr += t5;
    std::mem::swap(&mut xl, &mut xr);

    for c in &cts[1..last] {
        let t5 = pow5(xl + k + c);
        xr += t5;
        std::mem::swap(&mut xl, &mut xr);
    }

    // last round: don't swap
    xr += pow5(xl + k + cts[last]);

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
