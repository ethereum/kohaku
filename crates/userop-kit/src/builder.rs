use alloy::{
    dyn_abi::Eip712Domain,
    primitives::{Address, Bytes, U256, aliases::U192},
};
use alloy_sol_types::SolCall;
use eip_1193_provider::provider::{Eip1193Caller, Eip1193Error, Eip1193Provider};

use crate::{
    abis::entry_point::EntryPoint,
    bundler::{Bundler, BundlerError},
    signable_user_operation::SignableUserOperation,
    user_operation::{UserOperation, UserOperationGasEstimate},
};

pub struct UserOperationBuilder<P = ()> {
    pub op: UserOperation,
    pub(crate) protocol: P,

    gas_set: bool,
    entry_point: Address,
    domain: Eip712Domain,
}

impl<P> UserOperationBuilder<P> {
    pub fn new(sender: Address, entry_point: Address, domain: Eip712Domain, protocol: P) -> Self {
        Self {
            op: UserOperation {
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
            protocol,
            gas_set: false,
        }
    }

    /// Sets the calldata for this UserOperation.
    pub fn with_calldata(mut self, calldata: Bytes) -> Self {
        self.op.call_data = calldata;
        self
    }

    /// Sets the paymaster for this UserOperation.
    pub fn with_paymaster(mut self, paymaster: Address) -> Self {
        self.op.paymaster = Some(paymaster);
        self
    }

    /// Sets the paymaster data for this UserOperation.
    pub fn with_paymaster_data(mut self, data: Bytes) -> Self {
        self.op.paymaster_data = Some(data);
        self
    }

    /// Sets the 4337 operation nonce for this UserOperation.
    pub fn with_nonce(mut self, nonce: U256) -> Self {
        self.op.nonce = nonce;
        self
    }

    /// Fetches the nonce for this UserOperation from the EntryPoint, using the provided key.
    pub async fn with_provider_nonce(
        mut self,
        provider: &dyn Eip1193Provider,
        key: U192,
    ) -> Result<Self, Eip1193Error> {
        let nonce = provider
            .sol_call(
                self.entry_point,
                EntryPoint::getNonceCall::new((self.op.sender, key)),
            )
            .await?;
        self.op.nonce = nonce;
        Ok(self)
    }

    /// Sets the EIP-7702 authorization for this UserOperation.
    pub fn with_authorization(mut self, auth: alloy::eips::eip7702::Authorization) -> Self {
        self.op.authorization = crate::user_operation::Authorization::Eip7702(auth);
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
        self.op.factory = Some(factory);
        self.op.factory_data = Some(data);
        self
    }

    /// Builds a `SignableUserOperation` from this builder, which can then be signed and sent.
    pub fn build(&self) -> SignableUserOperation {
        SignableUserOperation {
            user_op: self.op.clone(),
            entry_point: self.entry_point,
            domain: self.domain.clone(),
        }
    }

    fn set_gas(
        &mut self,
        gas: UserOperationGasEstimate,
        max_fee_per_gas: u128,
        max_priority_fee_per_gas: u128,
    ) {
        self.gas_set = true;

        self.op.call_gas_limit = gas.call_gas_limit;
        self.op.verification_gas_limit = gas.verification_gas_limit;
        self.op.pre_verification_gas = gas.pre_verification_gas;
        self.op.paymaster_verification_gas_limit = gas.paymaster_verification_gas_limit;
        self.op.paymaster_post_op_gas_limit = gas.paymaster_post_op_gas_limit;
        self.op.max_fee_per_gas = max_fee_per_gas;
        self.op.max_priority_fee_per_gas = max_priority_fee_per_gas;
    }
}
