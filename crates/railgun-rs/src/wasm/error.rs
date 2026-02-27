use wasm_bindgen::{JsError, JsValue};

use crate::{
    crypto::keys::KeyError,
    railgun::{PoiProviderError, RailgunProviderError, address::RailgunAddressError},
};

impl From<KeyError> for JsValue {
    fn from(e: KeyError) -> Self {
        JsError::new(&format!("Key Error: {}", e)).into()
    }
}

impl From<RailgunProviderError> for JsValue {
    fn from(e: RailgunProviderError) -> Self {
        JsError::new(&format!("Railgun Provider Error: {}", e)).into()
    }
}

impl From<PoiProviderError> for JsValue {
    fn from(e: PoiProviderError) -> Self {
        JsError::new(&format!("POI Provider Error: {}", e)).into()
    }
}

impl From<RailgunAddressError> for JsValue {
    fn from(e: RailgunAddressError) -> Self {
        JsError::new(&format!("Railgun Address Error: {}", e)).into()
    }
}
