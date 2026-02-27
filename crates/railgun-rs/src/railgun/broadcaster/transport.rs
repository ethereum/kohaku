use std::pin::Pin;

use futures::Stream;
use thiserror::Error;

use super::types::WakuMessage;

#[derive(Debug, Error)]
pub enum WakuTransportError {
    #[error("Subscription failed: {0}")]
    SubscriptionFailed(String),
    #[error("Send failed: {0}")]
    SendFailed(String),
    #[error("Connection error: {0}")]
    ConnectionError(String),
    #[error("Historical retrieval failed: {0}")]
    RetrieveHistoricalFailed(String),
}

#[cfg(not(target_arch = "wasm32"))]
pub type MessageStream = Pin<Box<dyn Stream<Item = WakuMessage> + Send>>;

#[cfg(target_arch = "wasm32")]
pub type MessageStream = Pin<Box<dyn Stream<Item = WakuMessage>>>;

/// Transport layer for Waku network communication.
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait WakuTransport: common::MaybeSend {
    /// Subscribe to messages on the given content topics.
    ///
    /// Returns a stream of messages received on any of the subscribed topics.
    /// The subscription remains active until the stream is dropped.
    async fn subscribe(
        &self,
        content_topics: Vec<String>,
    ) -> Result<MessageStream, WakuTransportError>;

    /// Send a message to the given content topic.
    async fn send(&self, content_topic: &str, payload: Vec<u8>) -> Result<(), WakuTransportError>;

    /// Retrieve historical messages for a given content topic.
    ///
    /// Historical messages should be returned in chronological order, and each
    /// message should only be returned once across all calls to this method.
    async fn retrieve_historical(
        &self,
        content_topic: &str,
    ) -> Result<Vec<WakuMessage>, WakuTransportError>;
}
