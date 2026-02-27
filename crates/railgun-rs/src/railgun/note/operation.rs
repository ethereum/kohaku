use std::{fmt::Display, sync::Arc};

#[cfg(feature = "poi")]
use ruint::aliases::U256;
use thiserror::Error;

#[cfg(feature = "poi")]
use crate::railgun::poi::PoiNote;
use crate::{
    caip::AssetId,
    railgun::{
        note::{EncryptableNote, Note, transfer::TransferNote, unshield::UnshieldNote},
        signer::Signer,
    },
};

/// An Operation represents a single "operation" within a railgun transaction.
/// Otherwise known as the `RailgunSmartWallet::Transaction` struct in solidity.
///
/// - An operation MUST only spend notes from a single tree.
/// - An operation MUST have fewer than to 12 out_notes (13 including unshield),
///   which can be to arbitrary addresses.
/// - An operation MUST only spend a single asset.
///   - The POI proof circuit inputs are designed around this assumption, since the token
///     of the spent notes is a private input.
/// - An operation MUST only spend notes from a single address.
///   - The POI proof circuit inputs are designed around this assumption, since the
///     spender's public and nullifying key are private inputs to the circuit.
/// - An operation MUST only have a single unshield note.
///   - The railgun smart contracts are designed around this assumption, since the
///     `RailgunSmartWallet::Transaction` struct only supports defining a single
///      token/value pair for unshielding.
#[derive(Debug, Clone)]
pub struct Operation<N> {
    /// The UTXO tree number that the in_notes being spent are from
    pub utxo_tree_number: u32,

    /// The holder of the assets being spent.
    pub from: Arc<dyn Signer>,

    /// The asset this operation is spending.
    pub asset: AssetId,

    pub in_notes: Vec<N>,
    pub out_notes: Vec<TransferNote>,
    pub unshield_note: Option<UnshieldNote>,
}

#[derive(Debug, Error)]
pub enum OperationVerificationError {
    #[error("Imbalanced operation: {0} != {1} + {2}")]
    Imbalanced(u128, u128, u128),
    #[error("Too many output notes: {0} > 13")]
    TooManyOutputNotes(usize),
    #[error("Too many input notes: {0} > 13")]
    TooManyInputNotes(usize),
}

impl<N: Note> Operation<N> {
    /// TODO: Add error checking to ensure that the operation is valid.
    ///
    /// - Spending and viewing keys are the same for all notes in
    /// - Tree number is the same for all notes in
    /// - AssetID is the same for all notes
    /// - notes_in.value = notes_out.value + unshield_note.value
    /// - notes_in.len() <= 13
    /// - notes_out.len() + unshield_note.is_some() <= 13
    pub fn new(
        tree_number: u32,
        from: Arc<dyn Signer>,
        asset: AssetId,
        in_notes: Vec<N>,
        out_notes: Vec<TransferNote>,
        unshield: Option<UnshieldNote>,
    ) -> Self {
        Operation {
            utxo_tree_number: tree_number,
            from,
            asset,
            in_notes,
            out_notes,
            unshield_note: unshield,
        }
    }

    pub fn new_empty(tree_number: u32, from: Arc<dyn Signer>, asset: AssetId) -> Self {
        Operation {
            utxo_tree_number: tree_number,
            from,
            asset,
            in_notes: Vec::new(),
            out_notes: Vec::new(),
            unshield_note: None,
        }
    }

    pub fn verify(&self) -> Result<(), OperationVerificationError> {
        let in_value: u128 = self.in_notes.iter().map(|n| n.value()).sum();
        let out_value: u128 = self.out_notes.iter().map(|n| n.value()).sum();
        let unshield_value: u128 = self.unshield_note.as_ref().map_or(0, |n| n.value());

        if in_value != out_value + unshield_value {
            return Err(OperationVerificationError::Imbalanced(
                in_value,
                out_value,
                unshield_value,
            ));
        }

        if self.out_notes.len() + self.unshield_note.is_some() as usize > 13 {
            return Err(OperationVerificationError::TooManyOutputNotes(
                self.out_notes.len(),
            ));
        }

        if self.in_notes.len() > 13 {
            return Err(OperationVerificationError::TooManyInputNotes(
                self.in_notes.len(),
            ));
        }

        Ok(())
    }
}

impl<N: Note> Operation<N> {
    /// UTXO tree number for these in_notes
    pub fn utxo_tree_number(&self) -> u32 {
        self.utxo_tree_number
    }

    pub fn in_value(&self) -> u128 {
        self.in_notes.iter().map(|n| n.value()).sum()
    }

    /// Total value being transfered to other railgun addresses in this operation
    pub fn out_value(&self) -> u128 {
        let out_notes_value: u128 = self.out_notes.iter().map(|n| n.value()).sum();
        let unshield_value: u128 = self.unshield_note.as_ref().map_or(0, |n| n.value());
        out_notes_value + unshield_value
    }

    pub fn in_notes(&self) -> &[N] {
        &self.in_notes
    }

    pub fn out_notes(&self) -> Vec<Box<dyn Note>> {
        let mut notes: Vec<Box<dyn Note>> = Vec::new();

        for transfer in &self.out_notes {
            notes.push(Box::new(transfer.clone()));
        }

        if let Some(unshield) = &self.unshield_note {
            notes.push(Box::new(unshield.clone()));
        }

        notes.into_iter().filter(|n| n.value() > 0).collect()
    }

    pub fn unshield_note(&self) -> Option<UnshieldNote> {
        self.unshield_note.clone()
    }

    pub fn out_encryptable_notes(&self) -> Vec<Box<dyn EncryptableNote>> {
        let mut notes: Vec<Box<dyn EncryptableNote>> = Vec::new();

        for transfer in &self.out_notes {
            notes.push(Box::new(transfer.clone()));
        }

        notes.into_iter().filter(|n| n.value() > 0).collect()
    }
}

#[cfg(feature = "poi")]
impl Operation<PoiNote> {
    pub fn blinded_commitments(&self) -> Vec<U256> {
        self.in_notes
            .iter()
            .map(|n| n.blinded_commitment())
            .collect()
    }
}

impl<N: Note> Display for Operation<N> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Operation(tree: {}, from: {}, asset: {}, in_notes: {}, out_notes: {}, unshield: {})",
            self.utxo_tree_number,
            self.from.address(),
            self.asset,
            self.in_notes.len(),
            self.out_notes.len(),
            self.unshield_note.is_some(),
        )
    }
}

#[cfg(test)]
mod tests {
    use alloy::primitives::address;
    use tracing_test::traced_test;

    use crate::{
        caip::AssetId,
        crypto::keys::{ByteKey, SpendingKey, ViewingKey},
        railgun::{
            note::{
                Note,
                operation::{self},
                transfer::TransferNote,
                unshield::UnshieldNote,
                utxo::test_note,
            },
            signer::{PrivateKeySigner, Signer},
        },
    };

    /// Test that the ordering of out_notes is fee note, then transfer notes, then unshield note.
    #[test]
    #[traced_test]
    fn test_operation_ordering() {
        let from_account = PrivateKeySigner::new_evm(
            SpendingKey::from_bytes([1u8; 32]),
            ViewingKey::from_bytes([2u8; 32]),
            1,
        );

        let in_note = test_note();
        let transfer_note = TransferNote::new(
            ViewingKey::from_bytes([3u8; 32]),
            from_account.address(),
            AssetId::Erc20(address!("0x1234567890123456789012345678901234567890")),
            90,
            [2u8; 16],
            "memo",
        );
        let unshield_note = UnshieldNote::new(
            address!("0x1234567890123456789012345678901234567890"),
            AssetId::Erc20(address!("0x1234567890123456789012345678901234567890")),
            10,
        );

        let operation = operation::Operation::new(
            1,
            from_account,
            AssetId::Erc20(address!("0x1234567890123456789012345678901234567890")),
            vec![in_note],
            vec![transfer_note],
            Some(unshield_note.clone()),
        );

        let notes_out = operation.out_notes();
        assert_eq!(notes_out.last().unwrap().hash(), unshield_note.hash());
    }
}
