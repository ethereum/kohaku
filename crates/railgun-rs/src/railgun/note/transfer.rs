use crypto::poseidon_hash;
use rand::RngCore;
use ruint::aliases::U256;

use crate::{
    abis::railgun::CommitmentCiphertext,
    caip::AssetId,
    crypto::keys::{U256Key, ViewingKey},
    railgun::{
        address::RailgunAddress,
        merkle_tree::UtxoLeafHash,
        note::{
            EncryptableNote, Note,
            encrypt::{EncryptError, encrypt_note},
        },
    },
};

/// Transfer notes represent value being sent from one Railgun account to another.
#[derive(Debug, Clone)]
pub struct TransferNote {
    pub from_key: ViewingKey,
    pub to: RailgunAddress,
    pub asset: AssetId,
    pub value: u128,
    pub random: [u8; 16],
    pub memo: String,
}

impl TransferNote {
    pub fn new(
        from_key: ViewingKey,
        to: RailgunAddress,
        asset: AssetId,
        value: u128,
        random: [u8; 16],
        memo: &str,
    ) -> Self {
        TransferNote {
            from_key,
            to,
            asset,
            value,
            random,
            memo: memo.to_string(),
        }
    }
}

impl EncryptableNote for TransferNote {
    fn encrypt(&self, rng: &mut dyn RngCore) -> Result<CommitmentCiphertext, EncryptError> {
        encrypt_note(
            &self.to,
            &self.random,
            self.value,
            &self.asset,
            &self.memo,
            self.from_key,
            false,
            rng,
        )
    }
}

impl Note for TransferNote {
    fn asset(&self) -> AssetId {
        self.asset
    }

    fn value(&self) -> u128 {
        self.value
    }

    fn memo(&self) -> String {
        self.memo.clone()
    }

    fn hash(&self) -> UtxoLeafHash {
        poseidon_hash(&[
            self.note_public_key(),
            self.asset.hash(),
            U256::from(self.value),
        ])
        .unwrap()
        .into()
    }

    fn note_public_key(&self) -> U256 {
        poseidon_hash(&[
            self.to.master_key().to_u256(),
            U256::from_be_slice(&self.random),
        ])
        .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use alloy::primitives::address;
    use ruint::uint;
    use tracing_test::traced_test;

    use crate::{
        caip::AssetId,
        crypto::keys::{ByteKey, SpendingKey, ViewingKey},
        railgun::{
            address::{ChainId, RailgunAddress},
            merkle_tree::UtxoLeafHash,
            note::{Note, transfer::TransferNote},
        },
    };

    #[test]
    #[traced_test]
    fn test_transfer_note_hash() {
        let note = TransferNote::new(
            ViewingKey::from_bytes([3u8; 32]),
            RailgunAddress::from_private_keys(
                SpendingKey::from_bytes([1u8; 32]),
                ViewingKey::from_bytes([2u8; 32]),
                ChainId::EVM(1),
            ),
            AssetId::Erc20(address!("0x1234567890123456789012345678901234567890")),
            90,
            [2u8; 16],
            "memo",
        );
        let hash: UtxoLeafHash = note.hash();

        let expected: UtxoLeafHash = uint!(
            1005027091991696937637380235791481806966626119421670561695028901610612069057_U256
        )
        .into();
        assert_eq!(hash, expected);
    }
}
