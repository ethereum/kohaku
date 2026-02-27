use std::str::FromStr;

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::note::Note;

#[wasm_bindgen]
#[derive(Clone)]
pub struct JsNote {
    pub(crate) inner: Note,
}

#[wasm_bindgen]
impl JsNote {
    pub fn stringify(&self) -> String {
        self.inner.to_string()
    }

    #[wasm_bindgen(js_name = "fromString")]
    pub fn from_string(note_str: &str) -> Result<JsNote, JsValue> {
        match Note::from_str(note_str) {
            Ok(note) => Ok(JsNote { inner: note }),
            Err(e) => Err(JsValue::from_str(&format!("Invalid note string: {}", e))),
        }
    }
}

impl From<Note> for JsNote {
    fn from(inner: Note) -> Self {
        JsNote { inner }
    }
}
