use std::sync::Arc;

use thiserror::Error;

use crate::{
    caip::AssetId,
    railgun::{
        note::{
            EncryptableNote, Note, transfer::TransferNote, unshield::UnshieldNote, utxo::UtxoNote,
        },
        signer::RailgunSigner,
    },
};

/// An Operation represents a single "operation" within a railgun transaction.
/// Otherwise known as the `RailgunSmartWallet::Transaction` struct in solidity.
///
/// - An operation MUST only spend notes from a single tree.
/// - An operation MUST have fewer than to 12 out_notes (13 including unshield), which can be to
///   arbitrary addresses.
/// - An operation MUST only spend a single asset.
///   - The POI proof circuit inputs are designed around this assumption, since the token of the
///     spent notes is a private input.
/// - An operation MUST only spend notes from a single address.
///   - The POI proof circuit inputs are designed around this assumption, since the spender's public
///     and nullifying key are private inputs to the circuit.
/// - An operation MUST only have a single unshield note.
///   - The railgun smart contracts are designed around this assumption, since the
///     `RailgunSmartWallet::Transaction` struct only supports defining a single token/value pair
///     for unshielding.
#[derive(Debug, Clone)]
pub struct Operation {
    /// The UTXO tree number that the in_notes being spent are from
    pub utxo_tree_number: u32,

    /// The holder of the assets being spent.
    pub from: Arc<dyn RailgunSigner>,

    /// The asset this operation is spending.
    pub asset: AssetId,

    in_notes: Vec<UtxoNote>,
    out_notes: Vec<TransferNote>,
    unshield_note: Option<UnshieldNote>,
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

impl Operation {
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
        from: Arc<dyn RailgunSigner>,
        asset: AssetId,
        in_notes: Vec<UtxoNote>,
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

    pub fn new_empty(tree_number: u32, from: Arc<dyn RailgunSigner>, asset: AssetId) -> Self {
        Operation {
            utxo_tree_number: tree_number,
            from,
            asset,
            in_notes: Vec::new(),
            out_notes: Vec::new(),
            unshield_note: None,
        }
    }

    pub fn add_in_note(&mut self, note: UtxoNote) {
        self.in_notes.push(note);
    }

    pub fn add_out_note(&mut self, note: TransferNote) {
        self.out_notes.push(note);
    }

    pub fn set_unshield_note(&mut self, note: UnshieldNote) {
        self.unshield_note = Some(note);
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

impl Operation {
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

    pub fn in_notes(&self) -> &[UtxoNote] {
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
