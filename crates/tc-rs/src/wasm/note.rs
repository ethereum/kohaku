use std::str::FromStr;

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{Pool, note::Note, wasm::JsPool};

#[wasm_bindgen]
#[derive(Clone)]
pub struct JsNote {
    pub(crate) inner: Note,
}

#[wasm_bindgen]
impl JsNote {
    #[wasm_bindgen(getter)]
    pub fn nullifier(&self) -> Vec<u8> {
        self.inner.nullifier.to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn secret(&self) -> Vec<u8> {
        self.inner.secret.to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.symbol.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn amount(&self) -> String {
        self.inner.amount.clone()
    }

    #[wasm_bindgen(getter, js_name = "chainId")]
    pub fn chain_id(&self) -> u64 {
        self.inner.chain_id
    }

    #[wasm_bindgen(getter, js_name = "serialized")]
    pub fn serialized(&self) -> String {
        self.inner.to_string()
    }

    #[wasm_bindgen(js_name = "fromString")]
    pub fn from_string(note_str: &str) -> Result<JsNote, JsValue> {
        match Note::from_str(note_str) {
            Ok(note) => Ok(JsNote { inner: note }),
            Err(e) => Err(JsValue::from_str(&format!("Invalid note string: {}", e))),
        }
    }

    pub fn pool(&self) -> Option<JsPool> {
        Pool::from_note(&self.inner).map(JsPool::from)
    }
}

impl From<Note> for JsNote {
    fn from(inner: Note) -> Self {
        JsNote { inner }
    }
}
