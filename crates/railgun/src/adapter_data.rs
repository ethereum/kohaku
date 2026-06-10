use alloy::{
    primitives::{Address, B256, aliases::U120, b256},
    sol,
    sol_types::SolValue,
};

use crate::{
    abis::railgun::Transaction,
    account::{address::RailgunAddress, chain::ChainId},
    crypto::keys::{ByteKey, MasterPublicKey, ViewingPublicKey},
};

/// Railgun paymaster master public key.
pub const PAYMASTER_MASTER_PUBLIC_KEY: B256 =
    b256!("0x19acdde26147205d58fd7768be7c011f08a147ef86e6b70968d09c81cef74b13");

/// Railgun paymaster viewing public key.
pub const PAYMASTER_VIEWING_PUBLIC_KEY: B256 =
    b256!("0x63ec4d326fc49c1c71064c982fb0bcbca2ba593b44ff7e8c7e4e75b401ae1d9c");

sol!(
    struct PaymasterData {
        address adapter;
        bytes adapterData;
    }

    contract RailgunFeeAdapter {
        struct AdapterData {
            bytes16 random;
            address asset;
            uint120 value;
            Transaction[] transactions;
        }
    }
);

pub fn encode_paymaster_data(adapter: Address, adapter_data: Vec<u8>) -> Vec<u8> {
    let data = PaymasterData {
        adapter,
        adapterData: adapter_data.into(),
    };
    data.abi_encode()
}

pub fn encode_railgun_adapter_data(
    random: [u8; 16],
    asset: Address,
    value: u128,
    transactions: Vec<Transaction>,
) -> Vec<u8> {
    let data = RailgunFeeAdapter::AdapterData {
        random: random.into(),
        asset,
        value: U120::saturating_from(value),
        transactions,
    };
    data.abi_encode()
}

pub fn paymaster_railgun_address(chain_id: ChainId) -> RailgunAddress {
    RailgunAddress::from_public_keys(
        MasterPublicKey::from_bytes(*PAYMASTER_MASTER_PUBLIC_KEY),
        ViewingPublicKey::from_bytes(*PAYMASTER_VIEWING_PUBLIC_KEY),
        chain_id,
    )
}
