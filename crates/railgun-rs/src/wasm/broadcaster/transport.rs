use std::sync::Arc;

use js_sys::Array;
use wasm_bindgen::prelude::*;

use crate::railgun::broadcaster::{
    transport::{MessageStream, WakuTransport, WakuTransportError},
    types::WakuMessage,
};

#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACE: &str = r#"
export interface WakuAdapter {
    /**
     * Subscribe to a set of content topics.
     */
    subscribe(topics: string[]): Promise<void>;

    /**
     * Await the next inbound message matching the subscribed topics.
     * Returns `null` when the subscription has been closed.
     */
    nextMessage(): Promise<WakuMessage | null>;

    /**
     * Publish a message to a content topic.
     */
    send(topic: string, payload: Uint8Array): Promise<void>;

    /**
     * Retrieve historical messages for a content topic.
     */
    retrieveHistorical(topic: string): Promise<WakuMessage[]>;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "WakuAdapter")]
    pub type JsWakuAdapter;

    #[wasm_bindgen(method, catch)]
    async fn subscribe(this: &JsWakuAdapter, topics: Array) -> Result<(), JsValue>;

    #[wasm_bindgen(method, catch, js_name = "nextMessage")]
    async fn next_message(this: &JsWakuAdapter) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch)]
    async fn send(
        this: &JsWakuAdapter,
        topic: &str,
        payload: js_sys::Uint8Array,
    ) -> Result<(), JsValue>;

    #[wasm_bindgen(method, catch, js_name = "retrieveHistorical")]
    async fn retrieve_historical(this: &JsWakuAdapter, topic: &str) -> Result<JsValue, JsValue>;
}

pub struct JsWakuTransport(Arc<JsWakuAdapter>);

impl JsWakuTransport {
    pub fn new(adapter: JsWakuAdapter) -> Self {
        Self(Arc::new(adapter))
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

        self.0
            .subscribe(topics)
            .await
            .map_err(|e| WakuTransportError::SubscriptionFailed(format!("{e:?}")))?;

        let adapter = Arc::clone(&self.0);

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

        self.0
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
            .0
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
