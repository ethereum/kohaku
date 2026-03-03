use std::collections::HashMap;

use ruint::aliases::U256;

use crate::railgun::note::{IncludedNote, utxo::UtxoNote};

/// A Notebook holds a collection of spent and unspent notes for a Railgun account,
/// on a single tree.
#[derive(Debug, Clone, Default)]
pub struct Notebook {
    pub unspent: HashMap<u32, UtxoNote>,
    pub spent: HashMap<u32, UtxoNote>,
}

// #[derive(Debug, Clone)]
// pub struct SpentNote {
//     inner: UtxoNote,
// }

impl Notebook {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Notebook {
            unspent: HashMap::new(),
            spent: HashMap::new(),
        }
    }

    pub fn unspent(&self) -> &HashMap<u32, UtxoNote> {
        &self.unspent
    }

    /// Adds an unspent note to the notebook.
    pub fn add(&mut self, note_position: u32, note: UtxoNote) {
        self.unspent.insert(note_position, note);
    }

    /// Nullifies (spends) a note in the notebook based on its nullifier.
    ///
    /// Returns the spent note if found, otherwise returns None.
    pub fn nullify(&mut self, nullifier: U256, _timestamp: u64) -> Option<UtxoNote> {
        let Some((&leaf_index, _)) = self
            .unspent
            .iter()
            .find(|(leaf_index, note)| note.nullifier(U256::from(**leaf_index)) == nullifier)
        else {
            return None;
        };
        let note = self.unspent.remove(&leaf_index).unwrap();

        self.spent.insert(leaf_index, note.clone());
        Some(note)
    }
}
