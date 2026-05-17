use alloy::hex;
use railgun::database::{Database, DatabaseError};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACE: &str = r#"
/**
 * Database interface for storing railgun provider state.
 */
export interface Database {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "Database")]
    pub type JsDatabase;

    #[wasm_bindgen(method, catch, js_name = "get")]
    pub async fn get(this: &JsDatabase, key: &str) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "set")]
    pub async fn set(this: &JsDatabase, key: &str, value: &str) -> Result<(), JsValue>;

    #[wasm_bindgen(method, catch, js_name = "delete")]
    pub async fn delete(this: &JsDatabase, key: &str) -> Result<(), JsValue>;
}

#[async_trait::async_trait(?Send)]
impl Database for JsDatabase {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, DatabaseError> {
        let key = hex::encode(key);
        let result = self
            .get(&key)
            .await
            .map_err(|e| DatabaseError::StorageError(format!("JS get error: {:?}", e)))?;

        if result.is_null() || result.is_undefined() {
            return Ok(None);
        }

        let value = result.as_string().ok_or_else(|| {
            DatabaseError::StorageError("JS get error: value is not a string".to_string())
        })?;
        let value = hex::decode(value).map_err(|e| {
            DatabaseError::StorageError(format!("JS get error: invalid hex value: {:?}", e))
        })?;
        Ok(Some(value))
    }

    async fn set(&self, key: &[u8], value: &[u8]) -> Result<(), DatabaseError> {
        let key = hex::encode(key);
        let value = hex::encode(value);
        self.set(&key, &value)
            .await
            .map_err(|e| DatabaseError::StorageError(format!("JS set error: {:?}", e)))
    }

    async fn delete(&self, key: &[u8]) -> Result<(), DatabaseError> {
        let key = hex::encode(key);
        self.delete(&key)
            .await
            .map_err(|e| DatabaseError::StorageError(format!("JS delete error: {:?}", e)))
    }
}
