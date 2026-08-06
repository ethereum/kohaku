use alloy::{
    primitives::{Address, Bytes, U256},
    sol,
    sol_types::SolValue,
};
use userop_kit::{
    builder::UserOperationBuilder,
    bundler::{Bundler, BundlerExt},
};

use crate::{
    abis::tornado::Tornado,
    provider::{
        note::Note,
        pool::Pool,
        provider::{TornadoProvider, TornadoProviderError},
    },
};

pub trait TornadoPaymasterExt: Sized {
    fn with_tornadocash_paymaster<R>(
        self,
        note: &Note,
        recipient: Address,
        tornado_provider: &mut TornadoProvider,
        bundler: &dyn Bundler,
        rng: &mut R,
    ) -> impl std::future::Future<Output = Result<Self, TornadoPaymasterError>>
    where
        R: rand::CryptoRng + Send;
}

#[derive(Debug, thiserror::Error)]
pub enum TornadoPaymasterError {
    #[error("Pool missing paymaster address: {0}")]
    PoolMissingPaymasterAddress(Pool),
    #[error("Bundler error: {0}")]
    Bundler(#[from] userop_kit::bundler::BundlerError),
    #[error(transparent)]
    Provider(#[from] TornadoProviderError),
}

const FEE_BUFFER_BPS: u128 = 100; // 1% buffer

sol!(
    struct PaymasterData {
        address adapter;
        bytes adapterData;
    }

    struct TornadoAdapterData {
        bytes proof;
        bytes32 root;
        bytes32 nullifierHash;
        address recipient;
        address relayer;
        uint256 fee;
        uint256 refund;
    }
);

impl<S: Sized + Send + Sync> TornadoPaymasterExt for UserOperationBuilder<S> {
    async fn with_tornadocash_paymaster<R>(
        self,
        note: &Note,
        recipient: Address,
        tornado_provider: &mut TornadoProvider,
        bundler: &dyn Bundler,
        rng: &mut R,
    ) -> Result<Self, TornadoPaymasterError>
    where
        R: rand::CryptoRng + Send,
    {
        let mut builder = self;
        let pool = tornado_provider.pool_from_note(note)?;
        let paymaster = pool
            .paymaster_address
            .ok_or(TornadoPaymasterError::PoolMissingPaymasterAddress(pool))?;

        let mut fee_estimate = U256::from(pool.amount_wei);

        loop {
            builder = build_with_fee(
                builder,
                paymaster,
                fee_estimate,
                note,
                recipient,
                tornado_provider,
                bundler,
                rng,
            )
            .await?;
            let max_gas_estimate = max_gas(&builder);

            // TODO: Implement buffer, so extra fee is added to the estimate to account for
            // fluctuations
            //
            // TODO: Call `quoteWeiInToken` to get the fee in token, since this only works for ETH
            // rn.
            if max_gas_estimate <= fee_estimate {
                break;
            }

            let fee_buffer = max_gas_estimate * U256::from(FEE_BUFFER_BPS) / U256::from(10_000);
            fee_estimate = max_gas_estimate + fee_buffer;
        }

        Ok(builder)
    }
}

async fn build_with_fee<S, R>(
    builder: UserOperationBuilder<S>,
    paymaster: Address,
    fee: U256,
    note: &Note,
    recipient: Address,
    tornado_provider: &mut TornadoProvider,
    bundler: &dyn Bundler,
    rng: &mut R,
) -> Result<UserOperationBuilder<S>, TornadoPaymasterError>
where
    R: rand::CryptoRng + Send,
{
    let withdraw_call = tornado_provider
        .withdraw_call(note, recipient, Some(paymaster), Some(fee), None, rng)
        .await?;
    let paymaster_data = encode_paymaster_data(paymaster, withdraw_call);

    let builder = builder.with_paymaster_and_data(paymaster, paymaster_data);
    let builder = builder.with_gas_estimate(bundler).await?;

    Ok(builder)
}

fn encode_paymaster_data(adapter: Address, withdraw_call: Tornado::withdrawCall) -> Bytes {
    let adapter_data = encode_tornado_adapter_data(withdraw_call);
    let data = PaymasterData {
        adapter,
        adapterData: adapter_data,
    };
    data.abi_encode_params().into()
}

fn encode_tornado_adapter_data(withdraw_call: Tornado::withdrawCall) -> Bytes {
    let data = TornadoAdapterData {
        proof: withdraw_call._proof,
        root: withdraw_call._root,
        nullifierHash: withdraw_call._nullifierHash,
        recipient: withdraw_call._recipient,
        relayer: withdraw_call._relayer,
        fee: withdraw_call._fee,
        refund: withdraw_call._refund,
    };
    data.abi_encode_params().into()
}

/// Returns the maximum gas cost of a user operation builder.
fn max_gas<S>(builder: &UserOperationBuilder<S>) -> U256 {
    let user_op = builder.build();
    let total_gas_limit = U256::from(user_op.total_gas_limit());
    let max_fee_per_gas =
        U256::from(user_op.user_op.max_fee_per_gas + user_op.user_op.max_priority_fee_per_gas);

    total_gas_limit * max_fee_per_gas
}
