use ark_ff::Field;
use ark_relations::gr1cs::Matrix;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};

#[derive(Debug, Clone, PartialEq, Eq, CanonicalSerialize, CanonicalDeserialize)]
pub struct SerializableNpIndex<F: Field> {
    /// The number of variables that are "public instances" to the constraint
    /// system.
    pub num_instance_variables: usize,
    /// The number of variables that are "private witnesses" to the constraint
    /// system.
    pub num_witness_variables: usize,
    /// The number of constraints in the constraint system.
    pub num_constraints: usize,
    /// The number of non_zero entries in the A matrix.
    pub a_num_non_zero: usize,
    /// The number of non_zero entries in the B matrix.
    pub b_num_non_zero: usize,
    /// The number of non_zero entries in the C matrix.
    pub c_num_non_zero: usize,

    /// The A constraint matrix. This is empty when
    /// `self.mode == SynthesisMode::Prove { construct_matrices = false }`.
    pub a: Matrix<F>,
    /// The B constraint matrix. This is empty when
    /// `self.mode == SynthesisMode::Prove { construct_matrices = false }`.
    pub b: Matrix<F>,
    /// The C constraint matrix. This is empty when
    /// `self.mode == SynthesisMode::Prove { construct_matrices = false }`.
    pub c: Matrix<F>,
}

impl<F: Field> From<ark_circom::index::NPIndex<F>> for SerializableNpIndex<F> {
    fn from(index: ark_circom::index::NPIndex<F>) -> Self {
        Self {
            num_instance_variables: index.num_instance_variables,
            num_witness_variables: index.num_witness_variables,
            num_constraints: index.num_constraints,
            a_num_non_zero: index.a_num_non_zero,
            b_num_non_zero: index.b_num_non_zero,
            c_num_non_zero: index.c_num_non_zero,
            a: index.a,
            b: index.b,
            c: index.c,
        }
    }
}

impl<F: Field> From<SerializableNpIndex<F>> for ark_circom::index::NPIndex<F> {
    fn from(matrices: SerializableNpIndex<F>) -> Self {
        Self {
            num_instance_variables: matrices.num_instance_variables,
            num_witness_variables: matrices.num_witness_variables,
            num_constraints: matrices.num_constraints,
            a_num_non_zero: matrices.a_num_non_zero,
            b_num_non_zero: matrices.b_num_non_zero,
            c_num_non_zero: matrices.c_num_non_zero,
            a: matrices.a,
            b: matrices.b,
            c: matrices.c,
        }
    }
}
