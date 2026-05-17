//! Railgun protocol support for ERC-4337 user operations.
//!
//! See [`UserOperationBuilder::new_railgun`] to get started.

use alloy::{
    eips::eip7702::Authorization,
    primitives::{Address, B128, B256, Bytes, U256, address, aliases::U120, b256},
    sol_types::{SolCall, SolValue},
};

use crate::{
    abis::privacy_account_abi::IPrivacyAccount,
    builder::UserOperationBuilder,
    entry_point::{ENTRY_POINT_08, entry_point_08_domain},
};

/// Public inputs for the Railgun fee note commitment, used by the paymaster to verify the fee
/// on-chain.
pub struct FeeCommitment {
    /// Random value used to derive the transfer note public key.
    pub random: B128,
    /// Token address of the fee asset.
    pub asset: Address,
    /// Fee amount in the asset's base unit.
    pub value: u128,
}

/// Railgun-specific protocol data for constructing UserOperations.
pub struct RailgunProtocol {
    fee_calldata: Bytes,
    tail_calls: Vec<IPrivacyAccount::Call>,
}

/// Railgun 7702 Sender implementation address on all chains.
///
/// This is the only implementation that the Privacy-Protocol paymaster supports for
/// railgun user operations.
pub const IMPL: Address = address!("0xaBAd4109fcF3edBf7B7Cdff37A43a2197B5f2cC9");

/// Privacy-Protocol paymaster address on all chains.
pub const PAYMASTER: Address = address!("0xBbbc86034C5371e098163A39eC1bb8B2f015bB74");

/// Railgun paymaster master public key.
pub const PAYMASTER_MASTER_PUBLIC_KEY: B256 =
    b256!("0x19acdde26147205d58fd7768be7c011f08a147ef86e6b70968d09c81cef74b13");

/// Railgun paymaster viewing public key.
pub const PAYMASTER_VIEWING_PUBLIC_KEY: B256 =
    b256!("0x63ec4d326fc49c1c71064c982fb0bcbca2ba593b44ff7e8c7e4e75b401ae1d9c");

impl UserOperationBuilder<RailgunProtocol> {
    /// Creates a new Railgun [`UserOperationBuilder`].
    ///
    /// - `auth_nonce`: the EIP-7702 authorization nonce; must match the EOA's current transaction
    ///   nonce at the time the authorization is consumed.
    /// - `fee_calldata`: ABI-encoded `RailgunSmartWallet::transact` call containing a single fee
    ///   transaction. Accepted as raw [`Bytes`] so callers aren't forced to depend on the internal
    ///   `RailgunSmartWallet` ABI bindings.
    /// - `fee`: public inputs for the fee note commitment — the paymaster verifies these on-chain.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # use alloy::primitives::{Address, B128, Bytes, address};
    /// # use alloy::signers::local::PrivateKeySigner;
    /// # use userop_kit::bundler::{Bundler, pimlico::PimlicoBundler};
    /// # use userop_kit::railgun::FeeCommitment;
    /// # use userop_kit::builder::UserOperationBuilder;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// # let delegator = PrivateKeySigner::random();
    /// # let delegator_address = delegator.address();
    /// # let auth_nonce = 0u64;
    /// # let nonce = Default::default();
    /// # let fee_calldata = Bytes::new();
    /// let bundler = PimlicoBundler::new("https://api.pimlico.io/v2/1/rpc?apikey=".parse()?);
    ///
    /// let signed_op = UserOperationBuilder::new_railgun(
    ///     1, // chain_id
    ///     delegator_address,
    ///     auth_nonce,
    ///     fee_calldata,
    ///     FeeCommitment {
    ///         random: B128::ZERO, // your random value
    ///         asset: address!("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), // USDC
    ///         value: 1_000_000, // 1 USDC
    ///     },
    /// )
    /// .with_nonce(nonce)
    /// .with_tail_calls(vec![/* your calls here */])
    /// .with_gas_estimate(&bundler).await?
    /// .build()
    /// .sign(&delegator).await?;
    ///
    /// let hash = bundler.send_user_operation(&signed_op).await?;
    /// let receipt = bundler.wait_for_receipt(hash).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn new_railgun(
        chain_id: u64,
        delegator_address: Address,
        auth_nonce: u64,
        fee_calldata: Bytes,
        fee: FeeCommitment,
    ) -> Self {
        let auth = Authorization {
            chain_id: U256::from(chain_id),
            address: IMPL,
            nonce: auth_nonce,
        };

        let protocol = RailgunProtocol {
            fee_calldata,
            tail_calls: Vec::new(),
        };

        let domain = entry_point_08_domain(chain_id);
        let builder =
            UserOperationBuilder::new(delegator_address, ENTRY_POINT_08, domain, protocol)
                .with_paymaster(PAYMASTER)
                .with_authorization(auth)
                .with_paymaster_data(
                    (fee.random, fee.asset, U120::saturating_from(fee.value))
                        .abi_encode()
                        .into(),
                );
        builder.update_calldata()
    }

    /// Sets the tail calls for this UserOperation.
    ///
    /// Tail calls are executed in the UserOperation's `execute` phase after the fee calldata has
    /// been executed. They can perform arbitrary actions (IE sending or erc20s, interacting with
    /// other contracts).
    pub fn with_tail_calls(mut self, calls: Vec<IPrivacyAccount::Call>) -> Self {
        self.protocol.tail_calls = calls;
        self.update_calldata()
    }

    fn update_calldata(self) -> Self {
        let fee_call = self.protocol.fee_calldata.clone();
        let calldata =
            IPrivacyAccount::executeCall::new((fee_call, self.protocol.tail_calls.clone()))
                .abi_encode()
                .into();
        self.with_calldata(calldata)
    }
}
