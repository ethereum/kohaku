use alloy::{
    dyn_abi::Eip712Domain,
    primitives::{Address, Bytes, U256},
};

use crate::{
    bundler::{Bundler, BundlerError},
    signable_user_operation::SignableUserOperation,
    smart_account::smart_account::{SmartAccount, SmartAccountError},
    user_operation::{UserOperation, UserOperationGasEstimate},
};

pub struct UserOperationBuilder {
    user_op: UserOperation,

    gas_set: bool,
    entry_point: Address,
    domain: Eip712Domain,
}

impl UserOperationBuilder {
    pub fn new(sender: Address, entry_point: Address, domain: Eip712Domain) -> Self {
        Self {
            user_op: UserOperation {
                sender,
                nonce: U256::ZERO,
                factory: None,
                factory_data: None,
                call_data: Bytes::new(),
                call_gas_limit: 0,
                verification_gas_limit: 0,
                pre_verification_gas: 0,
                max_fee_per_gas: 0,
                max_priority_fee_per_gas: 0,
                paymaster: None,
                paymaster_verification_gas_limit: None,
                paymaster_post_op_gas_limit: None,
                paymaster_data: None,
                signature: Bytes::new(),
                authorization: Default::default(),
            },
            entry_point,
            domain,
            gas_set: false,
        }
    }

    /// Create a new UserOperationBuilder with a smart account
    pub async fn new_with_smart_account(
        smart_account: &impl SmartAccount,
    ) -> Result<Self, SmartAccountError> {
        Ok(Self::new(
            smart_account.address(),
            smart_account.entry_point(),
            smart_account.domain(),
        )
        .with_nonce(smart_account.nonce().await?)
        .with_authorization(smart_account.authorization().await?)
        .with_signature(smart_account.dummy_signature()))
    }

    /// Sets the calldata for this UserOperation.
    pub fn with_calldata(mut self, calldata: Bytes) -> Self {
        self.user_op.call_data = calldata;
        self
    }

    /// Sets the paymaster address and data for this UserOperation.
    pub fn with_paymaster(mut self, paymaster: Address, paymaster_data: Vec<u8>) -> Self {
        self.user_op.paymaster = Some(paymaster);
        self.user_op.paymaster_data = Some(paymaster_data.into());
        self
    }

    /// Sets the 4337 operation nonce for this UserOperation.
    pub fn with_nonce(mut self, nonce: U256) -> Self {
        self.user_op.nonce = nonce;
        self
    }

    /// Sets the EIP-7702 authorization for this UserOperation.
    pub fn with_authorization(mut self, auth: alloy::eips::eip7702::Authorization) -> Self {
        self.user_op.authorization = crate::user_operation::Authorization::Eip7702(auth);
        self
    }

    /// Sets the gas parameters for this UserOperation.
    pub fn with_gas(
        mut self,
        gas: UserOperationGasEstimate,
        max_fee_per_gas: u128,
        max_priority_fee_per_gas: u128,
    ) -> Self {
        self.set_gas(gas, max_fee_per_gas, max_priority_fee_per_gas);
        self
    }

    /// Fetches a gas estimate from the provider for the current UserOp.
    pub async fn with_gas_estimate(mut self, bundler: &dyn Bundler) -> Result<Self, BundlerError> {
        let op = self.build();
        let (est, max_fee, max_priority_fee) = futures::try_join!(
            bundler.estimate_gas(&op),
            bundler.suggest_max_fee_per_gas(),
            bundler.suggest_max_priority_fee_per_gas()
        )?;

        self.set_gas(est, max_fee, max_priority_fee);
        Ok(self)
    }

    /// Sets the factory and factory data for this UserOperation.
    pub fn with_factory(mut self, factory: Address, data: Bytes) -> Self {
        self.user_op.factory = Some(factory);
        self.user_op.factory_data = Some(data);
        self
    }

    /// Builds a `SignableUserOperation` from this builder, which can then be signed and sent.
    pub fn build(&self) -> SignableUserOperation {
        SignableUserOperation {
            user_op: self.user_op.clone(),
            entry_point: self.entry_point,
            domain: self.domain.clone(),
        }
    }

    /// Sets the signature for this UserOperation.
    pub(crate) fn with_signature(mut self, signature: Bytes) -> Self {
        self.user_op.signature = signature;
        self
    }

    fn set_gas(
        &mut self,
        gas: UserOperationGasEstimate,
        max_fee_per_gas: u128,
        max_priority_fee_per_gas: u128,
    ) {
        self.gas_set = true;

        self.user_op.call_gas_limit = gas.call_gas_limit;
        self.user_op.verification_gas_limit = gas.verification_gas_limit;
        self.user_op.pre_verification_gas = gas.pre_verification_gas;
        self.user_op.paymaster_verification_gas_limit = gas.paymaster_verification_gas_limit;
        self.user_op.paymaster_post_op_gas_limit = gas.paymaster_post_op_gas_limit;
        self.user_op.max_fee_per_gas = max_fee_per_gas;
        self.user_op.max_priority_fee_per_gas = max_priority_fee_per_gas;
    }
}
