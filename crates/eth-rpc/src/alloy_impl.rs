use alloy::{
    network::TransactionBuilder,
    providers::Provider,
    rpc::types::{Filter, TransactionRequest},
    transports::{RpcError, TransportErrorKind},
};
use alloy_primitives::{Address, Bytes, FixedBytes};

use crate::{EthRpcClient, EthRpcClientError, RawLog};

#[async_trait::async_trait]
impl<P: Provider> EthRpcClient for P {
    async fn get_chain_id(&self) -> Result<u64, EthRpcClientError> {
        Ok(self.get_chain_id().await?)
    }

    async fn get_block_number(&self) -> Result<u64, EthRpcClientError> {
        Ok(self.get_block_number().await?)
    }

    async fn get_logs(
        &self,
        address: Address,
        event_signature: Option<FixedBytes<32>>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<Vec<RawLog>, EthRpcClientError> {
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

    async fn eth_call(&self, to: Address, data: Bytes) -> Result<Bytes, EthRpcClientError> {
        let request = TransactionRequest::default().to(to).with_input(data);
        Ok(self.call(request).await?.into())
    }

    async fn estimate_gas(
        &self,
        to: Address,
        data: Bytes,
        from: Option<Address>,
    ) -> Result<u64, EthRpcClientError> {
        let mut request = TransactionRequest::default().to(to).with_input(data);
        if let Some(f) = from {
            request = request.from(f);
        }
        Ok(self.estimate_gas(request).await?)
    }

    async fn get_gas_price(&self) -> Result<u128, EthRpcClientError> {
        Ok(self.get_gas_price().await?)
    }
}

impl From<RpcError<TransportErrorKind>> for EthRpcClientError {
    fn from(e: RpcError<TransportErrorKind>) -> Self {
        EthRpcClientError::Rpc(e.to_string())
    }
}
