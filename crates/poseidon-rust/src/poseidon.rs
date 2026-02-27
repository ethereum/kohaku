use crate::{error::Error, parameters::PoseidonParams};
use ark_ff::PrimeField;
use itertools::izip;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct Poseidon<F: PrimeField> {
    pub(crate) params: Arc<PoseidonParams<F>>,
}
impl<F: PrimeField> Poseidon<F> {
    pub fn new(params: &Arc<PoseidonParams<F>>) -> Self {
        Poseidon {
            params: params.clone(),
        }
    }

    pub fn permutation(&self, input: Vec<F>) -> Result<Vec<F>, Error> {
        let t = self.params.t;
        if input.len() != t {
            return Err(Error::InvalidParameters);
        }
        let mut current_state = input;
        for r in 0..self.params.rounds_f_beginning {
            self.add_rc(&mut current_state, &self.params.round_constants[r]);
            self.sbox(&mut current_state);
            current_state = PoseidonParams::mat_vec_mul(&self.params.mds, &current_state);
        }
        let p_end = self.params.rounds_f_beginning + self.params.rounds_p;
        self.add_rc(&mut current_state, &self.params.opt_round_constants[0]);
        current_state = PoseidonParams::mat_vec_mul(&self.params.m_i, &current_state);
        for r in self.params.rounds_f_beginning..p_end {
            current_state[0] = self.sbox_p(&current_state[0]);
            if r < p_end - 1 {
                current_state[0].add_assign(
                    &self.params.opt_round_constants[r + 1 - self.params.rounds_f_beginning][0],
                );
            }
            current_state = self.cheap_matmul(&current_state, p_end - r - 1);
        }
        for r in p_end..self.params.rounds {
            self.add_rc(&mut current_state, &self.params.round_constants[r]);
            self.sbox(&mut current_state);
            current_state = PoseidonParams::mat_vec_mul(&self.params.mds, &current_state);
        }
        Ok(current_state)
    }

    fn sbox(&self, input: &mut [F]) {
        input.iter_mut().for_each(|el| *el = self.sbox_p(el));
    }

    fn sbox_p(&self, input: &F) -> F {
        match self.params.d {
            3 => {
                let input2 = input.square();
                let mut out = input2;
                out.mul_assign(input);
                out
            }
            5 => {
                let input2 = input.square();
                let mut out = input2.square();
                out.mul_assign(input);
                out
            }
            7 => {
                let input2 = input.square();
                let mut out = input2.square();
                out.mul_assign(&input2);
                out.mul_assign(input);
                out
            }
            _ => input.pow([self.params.d as u64]),
        }
    }

    fn cheap_matmul(&self, input: &[F], r: usize) -> Vec<F> {
        let v = &self.params.v[r];
        let w_hat = &self.params.w_hat[r];
        let t = self.params.t;
        let mut new_state = vec![F::zero(); t];
        new_state[0] = self.params.mds[0][0];
        new_state[0].mul_assign(&input[0]);
        for (inp, w) in izip!(input.iter().skip(1), w_hat.iter()) {
            let mut tmp = w.to_owned();
            tmp.mul_assign(inp);
            new_state[0].add_assign(&tmp);
        }
        for (n, inp, v) in izip!(new_state.iter_mut().skip(1), input.iter().skip(1), v.iter()) {
            input[0].clone_into(n);
            n.mul_assign(v);
            n.add_assign(inp);
        }
        new_state
    }

    fn add_rc(&self, input: &mut [F], rc: &[F]) {
        debug_assert_eq!(input.len(), rc.len());
        input.iter_mut().zip(rc.iter()).for_each(|(a, b)| {
            a.add_assign(b);
        });
    }
}

#[cfg(test)]
mod poseidon_bn254_tests {
    use super::*;
    use crate::{
        bn254::{circom_t3::POSEIDON_CIRCOM_BN_3_PARAMS, circom_t4::POSEIDON_CIRCOM_BN_4_PARAMS},
        field_from_hex_string,
    };
    use ark_ff::{One, UniformRand, Zero};
    use ark_std::rand::thread_rng;

    static TESTRUNS: usize = 5;
    type Scalar = ark_bn254::Fr;

    #[test]
    fn consistent_perm() {
        let mut rng = thread_rng();

        let poseidon = Poseidon::new(&POSEIDON_CIRCOM_BN_3_PARAMS);
        let t = poseidon.params.t;
        for _ in 0..TESTRUNS {
            let input1: Vec<Scalar> = (0..t).map(|_| Scalar::rand(&mut rng)).collect();

            let mut input2: Vec<Scalar>;
            loop {
                input2 = (0..t).map(|_| Scalar::rand(&mut rng)).collect();
                if input1 != input2 {
                    break;
                }
            }

            let perm1 = poseidon.permutation(input1.to_owned()).unwrap();
            let perm2 = poseidon.permutation(input1).unwrap();
            let perm3 = poseidon.permutation(input2).unwrap();
            assert_eq!(perm1, perm2);
            assert_ne!(perm1, perm3);
        }
    }

    #[test]
    fn kats_t3() {
        let poseidon = Poseidon::new(&POSEIDON_CIRCOM_BN_3_PARAMS);
        let input: Vec<Scalar> = vec![Scalar::zero(), Scalar::one(), Scalar::from(2)];
        let perm = poseidon.permutation(input).unwrap();
        assert_eq!(
            perm[0],
            field_from_hex_string(
                "0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a"
            )
            .unwrap()
        );
        assert_eq!(
            perm[1],
            field_from_hex_string(
                "0x0fca49b798923ab0239de1c9e7a4a9a2210312b6a2f616d18b5a87f9b628ae29"
            )
            .unwrap()
        );
        assert_eq!(
            perm[2],
            field_from_hex_string(
                "0x0e7ae82e40091e63cbd4f16a6d16310b3729d4b6e138fcf54110e2867045a30c"
            )
            .unwrap()
        );
    }

    #[test]
    fn kats_t4() {
        let poseidon = Poseidon::new(&POSEIDON_CIRCOM_BN_4_PARAMS);
        let input: Vec<Scalar> = vec![
            Scalar::zero(),
            Scalar::one(),
            Scalar::from(2),
            Scalar::from(3),
        ];
        let perm = poseidon.permutation(input).unwrap();
        assert_eq!(
            perm[0],
            field_from_hex_string(
                "0x0e7732d89e6939c0ff03d5e58dab6302f3230e269dc5b968f725df34ab36d732"
            )
            .unwrap()
        );
        assert_eq!(
            perm[1],
            field_from_hex_string(
                "0x07b0b86b41ec7fdfe6c17ee6ccdddce4e47e748e493e542f9a435b0dde022a0d"
            )
            .unwrap()
        );
        assert_eq!(
            perm[2],
            field_from_hex_string(
                "0x04362e50fcc8be421898d47ace20eab18b0a6efab0e12ade49f2df609fec4209"
            )
            .unwrap()
        );
        assert_eq!(
            perm[3],
            field_from_hex_string(
                "0x1a779bd9781d3a8354eae5ed74e7fa44fa0e458e45a1407524bddf3b9f2bf2d7"
            )
            .unwrap()
        );
    }
}
