use wasm_bindgen::prelude::wasm_bindgen;

use crate::railgun::broadcaster::broadcaster::Fee;

#[wasm_bindgen]
pub struct JsFee {
    inner: Fee,
}

impl From<Fee> for JsFee {
    fn from(fee: Fee) -> Self {
        JsFee { inner: fee }
    }
}

impl From<&Fee> for JsFee {
    fn from(fee: &Fee) -> Self {
        JsFee { inner: fee.clone() }
    }
}

impl From<JsFee> for Fee {
    fn from(js_fee: JsFee) -> Self {
        js_fee.inner
    }
}

impl From<&JsFee> for Fee {
    fn from(js_fee: &JsFee) -> Self {
        js_fee.inner.clone()
    }
}
