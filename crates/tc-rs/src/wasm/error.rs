use wasm_bindgen::JsValue;

#[cfg(feature = "broadcaster")]
use crate::broadcaster::BroadcasterError;
use crate::provider::TornadoProviderError;

impl From<TornadoProviderError> for JsValue {
    fn from(error: TornadoProviderError) -> Self {
        JsValue::from_str(&format!("TornadoProvider error: {}", error))
    }
}

#[cfg(feature = "broadcaster")]
impl From<BroadcasterError> for JsValue {
    fn from(error: BroadcasterError) -> Self {
        JsValue::from_str(&format!("Broadcaster error: {}", error))
    }
}
