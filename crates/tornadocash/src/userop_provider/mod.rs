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
        tornado_provider::{TornadoProvider, TornadoProviderError},
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
        R: rand::CryptoRng;
}

#[derive(Debug, thiserror::Error)]
pub enum TornadoPaymasterError {
    #[error("Pool missing paymaster address: {0}")]
    PoolMissingPaymasterAddress(Pool),
    #[error("Bundler error: {0}")]
    Bundler(#[from] userop_kit::bundler::BundlerError),
    #[error(transparent)]
    TornadoProvider(#[from] TornadoProviderError),
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
    #[tracing::instrument(skip_all)]
    async fn with_tornadocash_paymaster<R>(
        self,
        note: &Note,
        recipient: Address,
        tornado_provider: &mut TornadoProvider,
        bundler: &dyn Bundler,
        rng: &mut R,
    ) -> Result<Self, TornadoPaymasterError>
    where
        R: rand::CryptoRng,
    {
        let mut builder = self;
        let pool = tornado_provider.pool_from_note(note)?;
        let paymaster = pool
            .paymaster_address
            .ok_or(TornadoPaymasterError::PoolMissingPaymasterAddress(pool))?;
        let adapter = pool
            .adapter_address
            .ok_or(TornadoPaymasterError::PoolMissingPaymasterAddress(pool))?;

        let mut fee_estimate = U256::from(pool.amount_wei);

        loop {
            builder = build_with_fee(
                builder,
                paymaster,
                adapter,
                fee_estimate,
                note,
                recipient,
                tornado_provider,
                rng,
            )
            .await?;
            builder = builder.with_gas_estimate(bundler).await?;

            let wei = max_gas(&builder);
            let new_fee_estimate = tornado_provider.quote_wei_in_fee_token(pool, wei).await?;
            if new_fee_estimate <= fee_estimate {
                break;
            }

            let fee_buffer = new_fee_estimate * U256::from(FEE_BUFFER_BPS) / U256::from(10_000);
            fee_estimate = new_fee_estimate + fee_buffer;
        }

        Ok(builder)
    }
}

#[allow(clippy::too_many_arguments)]
/// Builds the tornadocash paymaster data with the specified fee.
async fn build_with_fee<S, R>(
    builder: UserOperationBuilder<S>,
    paymaster: Address,
    adapter: Address,
    fee: U256,
    note: &Note,
    recipient: Address,
    tornado_provider: &mut TornadoProvider,
    rng: &mut R,
) -> Result<UserOperationBuilder<S>, TornadoPaymasterError>
where
    R: rand::CryptoRng,
{
    let withdraw_call = tornado_provider
        .withdraw_call(note, recipient, Some(paymaster), Some(fee), None, rng)
        .await?;
    let paymaster_data = encode_paymaster_data(adapter, withdraw_call);
    let builder = builder.with_paymaster_and_data(paymaster, paymaster_data);

    Ok(builder)
}

/// Encodes the paymaster data for a Tornado Cash withdrawal call.
fn encode_paymaster_data(adapter: Address, withdraw_call: Tornado::withdrawCall) -> Bytes {
    let adapter_data = TornadoAdapterData {
        proof: withdraw_call._proof,
        root: withdraw_call._root,
        nullifierHash: withdraw_call._nullifierHash,
        recipient: withdraw_call._recipient,
        relayer: withdraw_call._relayer,
        fee: withdraw_call._fee,
        refund: withdraw_call._refund,
    };
    let data = PaymasterData {
        adapter,
        adapterData: adapter_data.abi_encode().into(),
    };
    data.abi_encode().into()
}

/// Returns the maximum gas cost of a user operation builder.
fn max_gas<S>(builder: &UserOperationBuilder<S>) -> U256 {
    let user_op = builder.build();
    let total_gas_limit = U256::from(user_op.total_gas_limit());
    let max_fee_per_gas =
        U256::from(user_op.user_op.max_fee_per_gas + user_op.user_op.max_priority_fee_per_gas);

    total_gas_limit * max_fee_per_gas
}
