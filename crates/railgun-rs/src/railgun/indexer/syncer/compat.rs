use std::pin::Pin;

use futures::Stream;

use super::syncer::SyncEvent;

/// Boxed stream type that is `Send` on native but not on WASM.
#[cfg(not(feature = "wasm"))]
pub type BoxedSyncStream<'a> = Pin<Box<dyn Stream<Item = SyncEvent> + Send + 'a>>;

#[cfg(feature = "wasm")]
pub type BoxedSyncStream<'a> = Pin<Box<dyn Stream<Item = SyncEvent> + 'a>>;
