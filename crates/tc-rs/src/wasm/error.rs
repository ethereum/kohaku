use wasm_bindgen::JsValue;

use crate::provider::TornadoProviderError;
#[cfg(feature = "relay")]
use crate::relayers::RelayerError;

impl From<TornadoProviderError> for JsValue {
    fn from(error: TornadoProviderError) -> Self {
        JsValue::from_str(&format!("TornadoProvider error: {}", error))
    }
}

#[cfg(feature = "relay")]
impl From<RelayerError> for JsValue {
    fn from(error: RelayerError) -> Self {
        JsValue::from_str(&format!("Broadcaster error: {}", error))
    }
}
