use std::sync::Arc;

use js_sys::Array;
use thiserror::Error;
use wasm_bindgen::prelude::*;

use crate::railgun::broadcaster::{
    transport::{MessageStream, WakuTransport, WakuTransportError},
    types::WakuMessage,
};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = "WakuAdapter")]
    pub type JsWakuAdapter;

    /// Subscribe to a set of content topics.
    /// The adapter manages the subscription callback internally.
    #[wasm_bindgen(method, catch)]
    async fn subscribe(this: &JsWakuAdapter, topics: Array) -> Result<(), JsValue>;

    /// Await the next inbound message matching the subscribed topics.
    /// Returns `null` when the subscription has been closed.
    #[wasm_bindgen(method, catch, js_name = "nextMessage")]
    async fn next_message(this: &JsWakuAdapter) -> Result<JsValue, JsValue>;

    /// Publish a message to a content topic.
    #[wasm_bindgen(method, catch)]
    async fn send(
        this: &JsWakuAdapter,
        topic: &str,
        payload: js_sys::Uint8Array,
    ) -> Result<(), JsValue>;

    /// Retrieve historical messages for a content topic.
    #[wasm_bindgen(method, catch, js_name = "retrieveHistorical")]
    async fn retrieve_historical(this: &JsWakuAdapter, topic: &str) -> Result<JsValue, JsValue>;
}

pub struct JsWakuTransport {
    adapter: Arc<JsWakuAdapter>,
}

#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum JsWakuTransportError {
    #[error("Serde error: {0}")]
    Serde(#[from] serde_wasm_bindgen::Error),
    #[error("JS error: {0:?}")]
    Js(JsValue),
}

impl JsWakuTransport {
    pub fn new(adapter: JsWakuAdapter) -> Self {
        Self {
            adapter: Arc::new(adapter),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl WakuTransport for JsWakuTransport {
    async fn subscribe(
        &self,
        content_topics: Vec<String>,
    ) -> Result<MessageStream, WakuTransportError> {
        let topics = content_topics
            .iter()
            .map(|t| JsValue::from_str(t))
            .collect::<Array>();

        self.adapter
            .subscribe(topics)
            .await
            .map_err(|e| WakuTransportError::SubscriptionFailed(format!("{e:?}")))?;

        let adapter = Arc::clone(&self.adapter);

        let stream = futures::stream::unfold(adapter, |adapter| async move {
            let msg_js = adapter.next_message().await.ok()?;
            if msg_js.is_null() || msg_js.is_undefined() {
                return None; // subscription closed
            }
            let msg: WakuMessage = serde_wasm_bindgen::from_value(msg_js).ok()?;
            Some((msg, adapter))
        });

        Ok(Box::pin(stream))
    }

    async fn send(&self, content_topic: &str, payload: Vec<u8>) -> Result<(), WakuTransportError> {
        let payload_js = js_sys::Uint8Array::from(payload.as_slice());

        self.adapter
            .send(content_topic, payload_js)
            .await
            .map_err(|e| WakuTransportError::SendFailed(format!("{e:?}")))?;

        Ok(())
    }

    async fn retrieve_historical(
        &self,
        content_topic: &str,
    ) -> Result<Vec<WakuMessage>, WakuTransportError> {
        let result = self
            .adapter
            .retrieve_historical(content_topic)
            .await
            .map_err(|e| WakuTransportError::RetrieveHistoricalFailed(format!("{e:?}")))?;

        let messages: Vec<WakuMessage> = serde_wasm_bindgen::from_value(result).map_err(|e| {
            WakuTransportError::RetrieveHistoricalFailed(format!(
                "Failed to deserialize messages: {e}"
            ))
        })?;

        Ok(messages)
    }
}
