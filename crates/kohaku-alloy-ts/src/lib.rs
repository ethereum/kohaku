//! Kohaku alloy adapter crate.
//!
//! Creates a js-friendly adapter for alloy's `Service` trait, so a JS handler
//! (viem, a custom fetch wrapper, etc.) can be dependency-injected as the
//! transport.
#![cfg(wasm)]

use alloy::{
    rpc::json_rpc::{RequestPacket, ResponsePacket},
    transports::{TransportError, TransportFut},
};
use tower_service::Service;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACE: &str = r#"
export interface AlloyService {
    /** Calls a method with the given parameters. Resolves to the RPC result (not the full envelope). */
    call(method: string, params: unknown[]): Promise<unknown>;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "AlloyService")]
    pub type JsAlloyService;

    #[wasm_bindgen(method, catch, js_name = "call")]
    async fn call(this: &JsAlloyService, method: &str, params: JsValue)
    -> Result<JsValue, JsValue>;
}

#[derive(Clone)]
pub struct AlloyServiceAdapter(JsValue);

impl AlloyServiceAdapter {
    pub fn new(service: JsAlloyService) -> Self {
        Self(service.into())
    }

    fn js(&self) -> &JsAlloyService {
        self.0.unchecked_ref()
    }
}

impl Service<RequestPacket> for AlloyServiceAdapter {
    type Error = TransportError;
    type Future = TransportFut<'static>;
    type Response = ResponsePacket;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: RequestPacket) -> Self::Future {
        let adapter = self.clone();

        Box::pin(async move {
            let reqs = match req {
                RequestPacket::Single(req) => vec![req],
                RequestPacket::Batch(reqs) => reqs,
            };

            let mut responses = Vec::with_capacity(reqs.len());

            for req in reqs {
                let method = req.method().to_owned();

                let params: JsValue = match req.params() {
                    Some(raw) => js_sys::JSON::parse(raw.get()).map_err(js_err_to_transport)?,
                    None => js_sys::Array::new().into(),
                };

                let result = adapter
                    .js()
                    .call(&method, params)
                    .await
                    .map_err(js_err_to_transport)?;

                let result_json: serde_json::Value = serde_wasm_bindgen::from_value(result)
                    .map_err(|e| TransportError::local_usage_str(&e.to_string()))?;

                let result_str = result_json.to_string();
                let envelope = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": req.id(),
                    "result": result_json,
                });

                let response: alloy::rpc::json_rpc::Response = serde_json::from_value(envelope)
                    .map_err(|e| TransportError::deser_err(e, &result_str))?;

                responses.push(response);
            }

            match responses.len() {
                1 => Ok(ResponsePacket::Single(responses.remove(0))),
                _ => Ok(ResponsePacket::Batch(responses)),
            }
        })
    }
}

fn js_err_to_transport(e: JsValue) -> TransportError {
    let msg = e
        .dyn_ref::<js_sys::Error>()
        .map(|err| String::from(err.message()))
        .unwrap_or_else(|| format!("{e:?}"));
    TransportError::local_usage_str(&msg)
}
