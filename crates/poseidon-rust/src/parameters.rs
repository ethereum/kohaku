use ark_ff::PrimeField;
use itertools::izip;

use crate::error::Error;

#[derive(Clone, Debug)]
pub struct PoseidonParams<F: PrimeField> {
    pub(crate) t: usize, // statesize
    pub(crate) d: usize, // sbox degree
    pub(crate) rounds_f_beginning: usize,
    pub(crate) rounds_p: usize,
    #[allow(dead_code)]
    pub(crate) rounds_f_end: usize,
    pub(crate) rounds: usize,
    pub(crate) mds: Vec<Vec<F>>,
    pub(crate) round_constants: Vec<Vec<F>>,
    pub(crate) opt_round_constants: Vec<Vec<F>>, // optimized
    pub(crate) w_hat: Vec<Vec<F>>,               // optimized
    pub(crate) v: Vec<Vec<F>>,                   // optimized
    pub(crate) m_i: Vec<Vec<F>>,                 // optimized
}

impl<F: PrimeField> PoseidonParams<F> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        t: usize,
        d: usize,
        rounds_f: usize,
        rounds_p: usize,
        mds: Vec<Vec<F>>,
        round_constants: Vec<Vec<F>>,
    ) -> Result<Self, Error> {
        if mds.len() != t {
            return Err(Error::InvalidParameters);
        }
        for row in mds.iter() {
            if row.len() != t {
                return Err(Error::InvalidParameters);
            }
        }
        let rounds = rounds_f + rounds_p;
        if round_constants.len() != rounds {
            return Err(Error::InvalidParameters);
        }
        for row in round_constants.iter() {
            if row.len() != t {
                return Err(Error::InvalidParameters);
            }
        }
        if rounds_f % 2 != 0 {
            return Err(Error::InvalidParameters);
        }
        let r = rounds_f / 2;

        let (m_i_, v_, w_hat_) = Self::equivalent_matrices(&mds, t, rounds_p);
        let opt_round_constants =
            Self::equivalent_round_constants(&round_constants, &mds, r, rounds_p);

        Ok(PoseidonParams {
            t,
            d,
            rounds_f_beginning: r,
            rounds_p,
            rounds_f_end: r,
            rounds,
            mds,
            round_constants,
            opt_round_constants,
            w_hat: w_hat_,
            v: v_,
            m_i: m_i_,
        })
    }

    // guassian elimination
    fn mat_inverse(mat: &[Vec<F>]) -> Vec<Vec<F>> {
        let n = mat.len();
        debug_assert!(mat[0].len() == n);

        let mut m = mat.to_owned();
        let mut inv = vec![vec![F::zero(); n]; n];
        for (i, invi) in inv.iter_mut().enumerate() {
            invi[i] = F::one();
        }

        // upper triangle
        for row in 0..n {
            for j in 0..row {
                // subtract from these rows
                let el = m[row][j];
                for col in 0..n {
                    // do subtraction for each col
                    if col < j {
                        m[row][col] = F::zero();
                    } else {
                        let mut tmp = m[j][col];
                        tmp.mul_assign(&el);
                        m[row][col].sub_assign(&tmp);
                    }
                    if col > row {
                        inv[row][col] = F::zero();
                    } else {
                        let mut tmp = inv[j][col];
                        tmp.mul_assign(&el);
                        inv[row][col].sub_assign(&tmp);
                    }
                }
            }
            // make 1 in diag
            let el_inv = m[row][row].inverse().unwrap();
            for col in 0..n {
                match col.cmp(&row) {
                    std::cmp::Ordering::Less => inv[row][col].mul_assign(&el_inv),
                    std::cmp::Ordering::Equal => {
                        m[row][col] = F::one();
                        inv[row][col].mul_assign(&el_inv)
                    }
                    std::cmp::Ordering::Greater => m[row][col].mul_assign(&el_inv),
                }
            }
        }

        // upper triangle
        for row in (0..n).rev() {
            for j in (row + 1..n).rev() {
                // subtract from these rows
                let el = m[row][j];
                for col in 0..n {
                    // do subtraction for each col

                    #[cfg(debug_assertions)]
                    {
                        if col >= j {
                            m[row][col] = F::zero();
                        }
                    }
                    let mut tmp = inv[j][col];
                    tmp.mul_assign(&el);
                    inv[row][col].sub_assign(&tmp);
                }
            }
        }

        #[cfg(debug_assertions)]
        {
            for (row, mrow) in m.iter().enumerate() {
                for (col, v) in mrow.iter().enumerate() {
                    if row == col {
                        debug_assert!(*v == F::one());
                    } else {
                        debug_assert!(*v == F::zero());
                    }
                }
            }
        }

        inv
    }

    fn mat_transpose(mat: &[Vec<F>]) -> Vec<Vec<F>> {
        let rows = mat.len();
        let cols = mat[0].len();
        let mut transpose = vec![vec![F::zero(); rows]; cols];

        for (row, matrow) in mat.iter().enumerate() {
            debug_assert_eq!(cols, matrow.len());
            for col in 0..cols {
                transpose[col][row] = matrow[col];
            }
        }
        transpose
    }

    #[allow(clippy::type_complexity)]
    fn equivalent_matrices(
        mds: &[Vec<F>],
        t: usize,
        rounds_p: usize,
    ) -> (Vec<Vec<F>>, Vec<Vec<F>>, Vec<Vec<F>>) {
        let mut w_hat = Vec::with_capacity(rounds_p);
        let mut v = Vec::with_capacity(rounds_p);
        let mut m_i = vec![vec![F::zero(); t]; t];

        let mds_ = Self::mat_transpose(mds);
        #[allow(clippy::redundant_clone)] // Seems to be a mistake by clippy?
        let mut m_mul = mds_.clone();

        for _ in 0..rounds_p {
            // calc m_hat, w and v
            let mut m_hat = vec![vec![F::zero(); t - 1]; t - 1];
            let mut w = vec![F::zero(); t - 1];
            let mut v_ = vec![F::zero(); t - 1];
            v_[..(t - 1)].clone_from_slice(&m_mul[0][1..t]);
            for row in 1..t {
                for col in 1..t {
                    m_hat[row - 1][col - 1] = m_mul[row][col];
                }
                w[row - 1] = m_mul[row][0];
            }
            // calc_w_hat
            let m_hat_inv = Self::mat_inverse(&m_hat);
            let w_hat_ = Self::mat_vec_mul(&m_hat_inv, &w);

            w_hat.push(w_hat_);
            v.push(v_);

            // update m_i
            m_i = m_mul;
            m_i[0][0] = F::one();
            for i in 1..t {
                m_i[0][i] = F::zero();
                m_i[i][0] = F::zero();
            }
            m_mul = Self::mat_mat_mul(&mds_, &m_i);
        }

        (Self::mat_transpose(&m_i), v, w_hat)
    }

    fn equivalent_round_constants(
        round_constants: &[Vec<F>],
        mds: &[Vec<F>],
        rounds_f_beginning: usize,
        rounds_p: usize,
    ) -> Vec<Vec<F>> {
        let mut opt = vec![Vec::new(); rounds_p];
        let mds_inv = Self::mat_inverse(mds);

        let p_end = rounds_f_beginning + rounds_p - 1;
        let mut tmp = round_constants[p_end].clone();
        for i in (0..rounds_p - 1).rev() {
            let inv_cip = Self::mat_vec_mul(&mds_inv, &tmp);
            opt[i + 1] = vec![inv_cip[0]];
            round_constants[rounds_f_beginning + i].clone_into(&mut tmp);
            for i in 1..inv_cip.len() {
                tmp[i].add_assign(&inv_cip[i]);
            }
        }
        opt[0] = tmp;

        opt
    }

    pub(crate) fn mat_vec_mul(mat: &[Vec<F>], input: &[F]) -> Vec<F> {
        let t = mat.len();
        debug_assert!(t == input.len());
        let mut out = vec![F::zero(); t];
        for (mat, out) in izip!(mat.iter(), out.iter_mut()) {
            debug_assert_eq!(mat.len(), t);
            for (mat, inp) in izip!(mat.iter(), input.iter()) {
                let mut tmp = mat.to_owned();
                tmp.mul_assign(inp);
                out.add_assign(tmp);
            }
        }
        out
    }

    fn mat_mat_mul(mat1: &[Vec<F>], mat2: &[Vec<F>]) -> Vec<Vec<F>> {
        let t = mat1.len();
        let mut out = vec![vec![F::zero(); t]; t];
        for (mat1, out) in izip!(mat1.iter(), out.iter_mut()) {
            for (col1, out) in out.iter_mut().enumerate() {
                for (mat1, m2) in izip!(mat1.iter(), mat2.iter()) {
                    let mut tmp = mat1.to_owned();
                    tmp.mul_assign(&m2[col1]);
                    out.add_assign(&tmp);
                }
            }
        }
        out
    }
}
