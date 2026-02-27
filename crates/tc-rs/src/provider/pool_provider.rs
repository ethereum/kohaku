use std::sync::Arc;

use alloy::primitives::{Address, Bytes};
use alloy_sol_types::SolCall;
use prover::{Proof, Prover};
use rand::RngCore;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

use crate::{
    abis::tornado::Tornado,
    circuit::{WithdrawCircuitInputs, WithdrawCircuitInputsError},
    indexer::{Indexer, IndexerError, IndexerState, Syncer, Verifier},
    note::Note,
    provider::pool::{Asset, Pool},
    tx_data::TxData,
};

/// A provider for a single tornadocash pool
pub struct PoolProvider {
    indexer: Indexer,
    prover: Arc<dyn Prover>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolProviderState {
    pub indexer_state: IndexerState,
}

#[derive(Debug, thiserror::Error)]
pub enum PoolProviderError {
    #[error("Indexer: {0}")]
    Indexer(#[from] IndexerError),
    #[error("Prover: {0}")]
    Prover(#[from] prover::ProverError),
    #[error("Withdraw Circuit: {0}")]
    WithdrawCircuit(#[from] WithdrawCircuitInputsError),
}

impl PoolProvider {
    pub fn new(
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
        prover: Arc<dyn Prover>,
        pool: Pool,
    ) -> Self {
        let indexer = Indexer::new(syncer, verifier, pool);
        Self { indexer, prover }
    }

    pub fn from_state(
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
        prover: Arc<dyn Prover>,
        state: PoolProviderState,
    ) -> Self {
        let indexer = Indexer::from_state(syncer, verifier, state.indexer_state);
        Self { indexer, prover }
    }

    pub fn pool(&self) -> &Pool {
        self.indexer.pool()
    }

    pub fn state(&self) -> PoolProviderState {
        PoolProviderState {
            indexer_state: self.indexer.state(),
        }
    }

    /// Create a deposit transaction
    pub fn deposit<R: RngCore>(&self, rng: &mut R) -> (TxData, Note) {
        let note = Note::random(
            rng,
            &self.pool().symbol(),
            &self.pool().amount(),
            self.pool().chain_id,
        );

        let call = Tornado::depositCall {
            _commitment: note.commitment().into(),
        };
        let calldata = call.abi_encode();

        let value = match self.pool().asset {
            Asset::Native { .. } => self.pool().amount_wei,
            Asset::Erc20 { .. } => 0,
        };

        let tx_data = TxData {
            to: self.pool().address,
            data: calldata,
            value: U256::from(value),
        };
        (tx_data, note)
    }

    /// Create a withdrawal transaction
    pub async fn withdraw(
        &self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
    ) -> Result<TxData, PoolProviderError> {
        let call = self
            .withdraw_calldata(note, recipient, relayer, fee, refund)
            .await?;

        Ok(TxData {
            to: self.pool().address,
            data: call.abi_encode(),
            value: refund.unwrap_or_default(),
        })
    }

    /// Create the calldata for a withdrawal transaction
    pub async fn withdraw_calldata(
        &self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
    ) -> Result<Tornado::withdrawCall, PoolProviderError> {
        let relayer = relayer.unwrap_or_default();
        let fee = fee.unwrap_or_default();
        let refund = refund.unwrap_or_default();

        let merkle_tree = self.indexer.tree();
        let circuit_inputs =
            WithdrawCircuitInputs::new(merkle_tree, note, recipient, relayer, fee, refund)?;

        let (proof, _public_inputs) = self
            .prover
            .prove("tc", circuit_inputs.as_flat_map())
            .await?;

        let proof = proof_to_solidity_inputs(&proof);
        let call = Tornado::withdrawCall {
            _proof: proof,
            _root: circuit_inputs.merkle_root.into(),
            _nullifierHash: circuit_inputs.nullifier_hash.into(),
            _recipient: recipient,
            _relayer: relayer,
            _fee: fee,
            _refund: refund,
        };

        Ok(call)
    }

    pub async fn sync(&mut self) -> Result<(), PoolProviderError> {
        self.indexer.sync().await?;
        self.verify().await
    }

    pub async fn sync_to(&mut self, block: u64) -> Result<(), PoolProviderError> {
        Ok(self.indexer.sync_to(block).await?)
    }

    pub async fn verify(&self) -> Result<(), PoolProviderError> {
        Ok(self.indexer.verify().await?)
    }
}

fn proof_to_solidity_inputs(proof: &Proof) -> Bytes {
    let proof_elements: [U256; 8] = [
        proof.a.x,
        proof.a.y,
        //? Order of b elements are reversed to match Solidity's expected format
        proof.b.x[1],
        proof.b.x[0],
        proof.b.y[1],
        proof.b.y[0],
        proof.c.x,
        proof.c.y,
    ];
    let mut proof_bytes = Vec::with_capacity(256);
    for elem in &proof_elements {
        proof_bytes.extend_from_slice(&elem.to_be_bytes::<32>());
    }

    proof_bytes.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROOF_JSON: &str = r#"{
        "pi_a": [
                "13266136784835640332844746266198608263901891282482609564079887369169768624014",
                "17042632590340990663614784043794282016230679095846282033410052204483255659230"
        ],
        "pi_b": [
            [
                "10970198678781339136039451360739256402919493905733936018567807044072972302915",
                "17969804996632599314500752065264226621718741730732011051439003195120644879225"
            ],
            [
                "12838843182760738365092422718132994180261846015110376812162643571983566251328",
                "10274407733932184301684127680370353775282162047081888242499546519304733605"
            ]
        ],
        "pi_c": [
            "9457691057294082210004347434205523973500867149942472710321839541505714818518",
            "1969710731313679419138676630718164627777075664359407762059172130399473623983"
        ]
    }"#;

    #[test]
    fn test_proof_to_solidity_inputs() {
        let proof: Proof = serde_json::from_str(PROOF_JSON).unwrap();
        let solidity_inputs = proof_to_solidity_inputs(&proof);

        insta::assert_snapshot!(solidity_inputs);
    }
}
