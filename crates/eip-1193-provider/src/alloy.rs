use alloy::{
    eips::BlockId,
    network::TransactionBuilder,
    primitives::{Address, Bytes, FixedBytes},
    providers::Provider,
    rpc::types::{Filter, TransactionRequest},
    transports::{RpcError, TransportErrorKind},
};

use crate::{Eip1193Error, Eip1193Provider, RawLog};

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl<P: Provider> Eip1193Provider for P {
    async fn chain_id(&self) -> Result<u64, Eip1193Error> {
        Ok(self.get_chain_id().await?)
    }

    async fn block_number(&self) -> Result<u64, Eip1193Error> {
        Ok(self.get_block_number().await?)
    }

    async fn logs(
        &self,
        address: Address,
        event_signature: Option<FixedBytes<32>>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<Vec<RawLog>, Eip1193Error> {
        let mut filter = Filter::new().address(address);
        if let Some(event_signature) = event_signature {
            filter = filter.event_signature(event_signature);
        }
        if let Some(from_block) = from_block {
            filter = filter.from_block(from_block);
        }
        if let Some(to_block) = to_block {
            filter = filter.to_block(to_block);
        }

        let logs = self.get_logs(&filter).await?;
        let logs = logs
            .into_iter()
            .map(|log| RawLog {
                topics: log.topics().to_vec(),
                block_number: log.block_number,
                block_timestamp: log.block_timestamp,
                transaction_hash: log.transaction_hash,
                address: log.address(),
                data: log.data().data.clone(),
            })
            .collect();

        Ok(logs)
    }

    async fn eth_call(&self, to: Address, data: Bytes) -> Result<Bytes, Eip1193Error> {
        let request = TransactionRequest::default().to(to).with_input(data);
        Ok(self.call(request).await?.into())
    }

    async fn estimate_gas(
        &self,
        to: Address,
        data: Bytes,
        from: Option<Address>,
    ) -> Result<u64, Eip1193Error> {
        let mut request = TransactionRequest::default().to(to).with_input(data);
        if let Some(f) = from {
            request = request.from(f);
        }
        Ok(self.estimate_gas(request).await?)
    }

    async fn gas_price(&self) -> Result<u128, Eip1193Error> {
        Ok(self.get_gas_price().await?)
    }

    async fn transaction_count(
        &self,
        address: Address,
        block: Option<u64>,
    ) -> Result<u64, Eip1193Error> {
        let block_id = match block {
            Some(b) => BlockId::number(b),
            None => BlockId::latest(),
        };

        Ok(self
            .get_transaction_count(address)
            .block_id(block_id)
            .await?)
    }
}

impl From<RpcError<TransportErrorKind>> for Eip1193Error {
    fn from(e: RpcError<TransportErrorKind>) -> Self {
        Eip1193Error::Rpc(e.to_string())
    }
}
