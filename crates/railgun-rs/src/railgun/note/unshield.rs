use alloy::primitives::{Address, aliases::U120};
use crypto::poseidon_hash;
use ruint::aliases::U256;

use crate::{
    abis,
    caip::AssetId,
    railgun::{merkle_tree::UtxoLeafHash, note::Note},
};

/// Unshield notes represent value exiting the Railgun system to an external address.
#[derive(Debug, Clone)]
pub struct UnshieldNote {
    pub receiver: Address,
    pub asset: AssetId,
    pub value: u128,
}

impl UnshieldNote {
    pub fn new(receiver: Address, asset: AssetId, value: u128) -> Self {
        UnshieldNote {
            receiver,
            asset,
            value,
        }
    }

    pub fn preimage(&self) -> abis::railgun::CommitmentPreimage {
        abis::railgun::CommitmentPreimage {
            npk: self.note_public_key().into(),
            token: self.asset.into(),
            value: U120::from(self.value),
        }
    }

    pub fn unshield_type(&self) -> abis::railgun::UnshieldType {
        abis::railgun::UnshieldType::NORMAL
    }
}

impl Note for UnshieldNote {
    fn asset(&self) -> AssetId {
        self.asset
    }

    fn value(&self) -> u128 {
        self.value
    }

    fn memo(&self) -> String {
        String::new()
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
        let mut bytes = [0u8; 32];
        bytes[12..32].copy_from_slice(self.receiver.as_slice());
        U256::from_be_bytes(bytes)
    }
}

#[cfg(test)]
mod tests {
    use alloy::primitives::address;
    use ruint::uint;
    use tracing_test::traced_test;

    use crate::{
        caip::AssetId,
        railgun::{
            merkle_tree::UtxoLeafHash,
            note::{Note, unshield::UnshieldNote},
        },
    };

    #[test]
    #[traced_test]
    fn test_hash() {
        let note = UnshieldNote::new(
            address!("0x1234567890123456789012345678901234567890"),
            AssetId::Erc20(address!("0x0987654321098765432109876543210987654321")),
            10,
        );
        let hash: UtxoLeafHash = note.hash();

        let expected: UtxoLeafHash = uint!(
            8567008140137776704315285747629501283858914289267824930248254678854896412220_U256
        )
        .into();
        assert_eq!(hash, expected);
    }
}
