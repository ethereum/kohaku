use alloy::primitives::{Address, Bytes, FixedBytes};
use js_sys::BigInt;
use wasm_bindgen::prelude::*;

use crate::provider::{Eip1193Error, Eip1193Provider, RawLog};

#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACE: &str = r#"
export interface Eip1193Provider {
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
    #[wasm_bindgen(typescript_type = "Eip1193Provider")]
    pub type JsEip1193Provider;

    #[wasm_bindgen(method, catch, js_name = "getChainId")]
    pub async fn get_chain_id(this: &JsEip1193Provider) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "getBlockNumber")]
    pub async fn get_block_number(this: &JsEip1193Provider) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "getLogs")]
    pub async fn get_logs(
        this: &JsEip1193Provider,
        address: &str,
        event_signature: Option<String>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "ethCall")]
    pub async fn eth_call(
        this: &JsEip1193Provider,
        to: &str,
        data: &str,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "estimateGas")]
    pub async fn estimate_gas(
        this: &JsEip1193Provider,
        to: &str,
        from: Option<String>,
        data: &str,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "getGasPrice")]
    pub async fn get_gas_price(this: &JsEip1193Provider) -> Result<JsValue, JsValue>;
}

#[async_trait::async_trait(?Send)]
impl Eip1193Provider for JsEip1193Provider {
    async fn get_chain_id(&self) -> Result<u64, Eip1193Error> {
        let result = self
            .get_chain_id()
            .await
            .map_err(|e| Eip1193Error::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u64(result)
    }

    async fn get_block_number(&self) -> Result<u64, Eip1193Error> {
        let result = self
            .get_block_number()
            .await
            .map_err(|e| Eip1193Error::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u64(result)
    }

    async fn logs(
        &self,
        address: Address,
        event_signature: Option<FixedBytes<32>>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<Vec<RawLog>, Eip1193Error> {
        let addr_str = format!("{:#x}", address);
        let sig_str = event_signature.map(|s| format!("{:#x}", s));

        let result = self
            .get_logs(&addr_str, sig_str, from_block, to_block)
            .await
            .map_err(|e| Eip1193Error::Rpc(format!("{:?}", e)))?;

        let logs: Vec<RawLog> = serde_wasm_bindgen::from_value(result)
            .map_err(|e| Eip1193Error::Decode(e.to_string()))?;
        Ok(logs)
    }

    async fn eth_call(&self, to: Address, data: Bytes) -> Result<Bytes, Eip1193Error> {
        let to_str = format!("{:#x}", to);
        let data_str = format!("0x{}", hex::encode(data));

        let result = self
            .eth_call(&to_str, &data_str)
            .await
            .map_err(|e| Eip1193Error::Rpc(format!("{:?}", e)))?;

        let hex_str: String = serde_wasm_bindgen::from_value(result)
            .map_err(|e| Eip1193Error::Decode(e.to_string()))?;
        let bytes = parse_hex_bytes(&hex_str)?;
        Ok(bytes.into())
    }

    async fn estimate_gas(
        &self,
        to: Address,
        data: Bytes,
        from: Option<Address>,
    ) -> Result<u64, Eip1193Error> {
        let to_str = format!("{:#x}", to);
        let from_str = from.map(|f| format!("{:#x}", f));
        let data_str = format!("0x{}", hex::encode(data));
        let result = self
            .estimate_gas(&to_str, from_str, &data_str)
            .await
            .map_err(|e| Eip1193Error::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u64(result)
    }

    async fn gas_price(&self) -> Result<u128, Eip1193Error> {
        let result = self
            .get_gas_price()
            .await
            .map_err(|e| Eip1193Error::Rpc(format!("{:?}", e)))?;
        js_bigint_to_u128(result)
    }

    async fn transaction_count(
        &self,
        _address: Address,
        _block: Option<u64>,
    ) -> Result<u64, Eip1193Error> {
        unimplemented!("get_transaction_count is not implemented in the WASM RPC client");
    }
}

fn js_bigint_to_u64(val: JsValue) -> Result<u64, Eip1193Error> {
    let bigint = BigInt::from(val);
    let s = bigint
        .to_string(10)
        .map_err(|e| Eip1193Error::Decode(format!("{:?}", e)))?
        .as_string()
        .ok_or_else(|| Eip1193Error::Decode("BigInt.toString returned non-string".into()))?;
    s.parse::<u64>()
        .map_err(|e| Eip1193Error::Decode(e.to_string()))
}

fn js_bigint_to_u128(val: JsValue) -> Result<u128, Eip1193Error> {
    let bigint = BigInt::from(val);
    let s = bigint
        .to_string(10)
        .map_err(|e| Eip1193Error::Decode(format!("{:?}", e)))?
        .as_string()
        .ok_or_else(|| Eip1193Error::Decode("BigInt.toString returned non-string".into()))?;
    s.parse::<u128>()
        .map_err(|e| Eip1193Error::Decode(e.to_string()))
}

fn parse_hex_bytes(s: &str) -> Result<Vec<u8>, Eip1193Error> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(s).map_err(|e| Eip1193Error::Decode(e.to_string()))
}
