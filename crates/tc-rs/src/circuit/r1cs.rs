use std::{collections::HashMap, str::FromStr};

use ark_bn254::Fr;
use ark_relations::r1cs::ConstraintMatrices;

use crate::circuit::WithdrawCircuitInputs;

#[derive(serde::Deserialize)]
pub struct TornadoCircuit {
    #[serde(rename = "nPubInputs")]
    pub n_pub_inputs: usize,
    #[serde(rename = "nOutputs")]
    pub n_outputs: usize,
    #[serde(rename = "nVars")]
    pub n_vars: usize,
    pub constraints: Vec<JsonConstraint>,
    #[serde(rename = "signalName2Idx")]
    pub signal_name_to_idx: HashMap<String, usize>,
}

/// Intermediate JSON representation.
/// Each constraint is [A_map, B_map, C_map] where each map is {signal_idx: coeff_string}.
type JsonConstraint = [HashMap<String, String>; 3];

impl TornadoCircuit {
    /// Parse the TornadoCircuit JSON representation into an arkworks R1CS constraint system
    pub fn r1cs(&self) -> ConstraintMatrices<Fr> {
        r1cs_from_json(self)
    }

    // pub fn to_signals(&self, inputs: WithdrawCircuitInputs) -> Vec<(usize, Fr)> {
    //     let s = |name: &str| -> usize {
    //         self.signal_name_to_idx
    //             .get(name)
    //             .copied()
    //             .expect("valid signal name")
    //     };

    // }
}

/// Parse a TornadoCircuit JSON repr into an arkworks R1CS constraint system
fn r1cs_from_json(circuit: &TornadoCircuit) -> ConstraintMatrices<Fr> {
    let num_instance = 1 + circuit.n_pub_inputs + circuit.n_outputs; // 1 for the constant term
    let num_witness = circuit.n_vars - num_instance;
    let num_constraints = circuit.constraints.len();

    let mut a = Vec::with_capacity(num_constraints);
    let mut b = Vec::with_capacity(num_constraints);
    let mut c = Vec::with_capacity(num_constraints);

    for constraint in &circuit.constraints {
        a.push(parse_sparse_row(&constraint[0]));
        b.push(parse_sparse_row(&constraint[1]));
        c.push(parse_sparse_row(&constraint[2]));
    }

    let matrices = ConstraintMatrices {
        num_instance_variables: num_instance,
        num_witness_variables: num_witness,
        num_constraints,
        a_num_non_zero: a.iter().map(|row| row.len()).sum(),
        b_num_non_zero: b.iter().map(|row| row.len()).sum(),
        c_num_non_zero: c.iter().map(|row| row.len()).sum(),
        a,
        b,
        c,
    };

    matrices
}

fn parse_sparse_row(map: &HashMap<String, String>) -> Vec<(Fr, usize)> {
    map.iter()
        .map(|(idx_str, coeff_str)| {
            let idx: usize = idx_str.parse().expect("valid signal index");
            let coeff = Fr::from_str(coeff_str).expect("valid field element");
            (coeff, idx)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_r1cs_from_json() {
        let json_str = r#"{
            "nPubInputs": 1,
            "nOutputs": 0,
            "nVars": 3,
            "constraints": [
                [{"1": "2"}, {"0": "1"}, {"2": "2"}]
            ]
        }"#;

        let circuit: TornadoCircuit = serde_json::from_str(json_str).unwrap();
        let r1cs = r1cs_from_json(&circuit);

        assert_eq!(r1cs.num_instance_variables, 2); // constant + 1 public
        assert_eq!(r1cs.num_witness_variables, 1);
        assert_eq!(r1cs.num_constraints, 1);
        assert_eq!(r1cs.a[0], vec![(Fr::from(2u64), 1)]);
        assert_eq!(r1cs.b[0], vec![(Fr::from(1u64), 0)]);
        assert_eq!(r1cs.c[0], vec![(Fr::from(2u64), 2)]);
        assert_eq!(r1cs.a[0].len(), 1);
        assert_eq!(r1cs.b[0].len(), 1);
        assert_eq!(r1cs.c[0].len(), 1);
    }
}
