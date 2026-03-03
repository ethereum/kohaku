use alloy_primitives::{Address, Bytes, FixedBytes};
use js_sys::BigInt;
use wasm_bindgen::prelude::*;

use crate::client::{EthRpcClient, EthRpcClientError, RawLog};

#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACE: &str = r#"
export interface EthRpcAdapter {
    getChainId(): Promise<bigint>;
    getBlockNumber(): Promise<bigint>;
    getLogs(
        address: `0x${string}`, 
        eventSignature: `0x${string}` | undefined, 
        fromBlock: number | undefined, 
        toBlock: number | undefined,
    ): Promise<RawLog[]>;
    ethCall(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`>;
    estimateGas(to: `0x${string}`, from: `0x${string}` | undefined, data: `0x${string}`): Promise<bigint>;
    getGasPrice(): Promise<bigint>;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "EthRpcAdapter")]
    pub type JsEthRpcAdapter;

    #[wasm_bindgen(method, catch, js_name = "getChainId")]
    pub async fn get_chain_id(this: &JsEthRpcAdapter) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "getBlockNumber")]
    pub async fn get_block_number(this: &JsEthRpcAdapter) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "getLogs")]
    pub async fn get_logs(
        this: &JsEthRpcAdapter,
        address: &str,
        event_signature: Option<String>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "ethCall")]
    pub async fn eth_call(this: &JsEthRpcAdapter, to: &str, data: &str)
    -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "estimateGas")]
    pub async fn estimate_gas(
        this: &JsEthRpcAdapter,
        to: &str,
        from: Option<String>,
        data: &str,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "getGasPrice")]
    pub async fn get_gas_price(this: &JsEthRpcAdapter) -> Result<JsValue, JsValue>;
}

#[async_trait::async_trait(?Send)]
impl EthRpcClient for JsEthRpcAdapter {
    async fn get_chain_id(&self) -> Result<u64, EthRpcClientError> {
        let result = self
            .get_chain_id()
            .await
            .map_err(|e| EthRpcClientError::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u64(result)
    }

    async fn get_block_number(&self) -> Result<u64, EthRpcClientError> {
        let result = self
            .get_block_number()
            .await
            .map_err(|e| EthRpcClientError::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u64(result)
    }

    async fn get_logs(
        &self,
        address: Address,
        event_signature: Option<FixedBytes<32>>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<Vec<RawLog>, EthRpcClientError> {
        let addr_str = format!("{:#x}", address);
        let sig_str = event_signature.map(|s| format!("{:#x}", s));

        let result = self
            .get_logs(&addr_str, sig_str, from_block, to_block)
            .await
            .map_err(|e| EthRpcClientError::Rpc(format!("{:?}", e)))?;

        let logs: Vec<RawLog> = serde_wasm_bindgen::from_value(result)
            .map_err(|e| EthRpcClientError::Decode(e.to_string()))?;
        Ok(logs)
    }

    async fn eth_call(&self, to: Address, data: Bytes) -> Result<Bytes, EthRpcClientError> {
        let to_str = format!("{:#x}", to);
        let data_str = format!("0x{}", hex::encode(data));

        let result = self
            .eth_call(&to_str, &data_str)
            .await
            .map_err(|e| EthRpcClientError::Rpc(format!("{:?}", e)))?;

        let hex_str: String = serde_wasm_bindgen::from_value(result)
            .map_err(|e| EthRpcClientError::Decode(e.to_string()))?;
        let bytes = parse_hex_bytes(&hex_str)?;
        Ok(bytes.into())
    }

    async fn estimate_gas(
        &self,
        to: Address,
        data: Bytes,
        from: Option<Address>,
    ) -> Result<u64, EthRpcClientError> {
        let to_str = format!("{:#x}", to);
        let from_str = from.map(|f| format!("{:#x}", f));
        let data_str = format!("0x{}", hex::encode(data));
        let result = self
            .estimate_gas(&to_str, from_str, &data_str)
            .await
            .map_err(|e| EthRpcClientError::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u64(result)
    }

    async fn get_gas_price(&self) -> Result<u128, EthRpcClientError> {
        let result = self
            .get_gas_price()
            .await
            .map_err(|e| EthRpcClientError::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u128(result)
    }
}

fn js_bigint_to_u64(val: JsValue) -> Result<u64, EthRpcClientError> {
    let bigint = BigInt::from(val);
    let s = bigint
        .to_string(10)
        .map_err(|e| EthRpcClientError::Decode(format!("{:?}", e)))?
        .as_string()
        .ok_or_else(|| EthRpcClientError::Decode("BigInt.toString returned non-string".into()))?;
    s.parse::<u64>()
        .map_err(|e| EthRpcClientError::Decode(e.to_string()))
}

fn js_bigint_to_u128(val: JsValue) -> Result<u128, EthRpcClientError> {
    let bigint = BigInt::from(val);
    let s = bigint
        .to_string(10)
        .map_err(|e| EthRpcClientError::Decode(format!("{:?}", e)))?
        .as_string()
        .ok_or_else(|| EthRpcClientError::Decode("BigInt.toString returned non-string".into()))?;
    s.parse::<u128>()
        .map_err(|e| EthRpcClientError::Decode(e.to_string()))
}

fn parse_hex_bytes(s: &str) -> Result<Vec<u8>, EthRpcClientError> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(s).map_err(|e| EthRpcClientError::Decode(e.to_string()))
}
