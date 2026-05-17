use reqwest::Client;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};

pub struct RpcClient {
    client: Client,
    url: reqwest::Url,
    id: AtomicU64,
}

#[derive(Debug, thiserror::Error)]
pub enum RpcClientError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("RPC error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("Missing result")]
    MissingResult,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RpcResponse<T> {
    Success { result: T },
    Failure { error: RpcError },
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

impl RpcClient {
    pub fn new(url: reqwest::Url) -> Self {
        Self {
            client: Client::new(),
            url,
            id: AtomicU64::new(1),
        }
    }

    pub async fn request<P, R>(&self, method: &str, params: P) -> Result<R, RpcClientError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let id = self.id.fetch_add(1, Ordering::Relaxed);
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let text = self
            .client
            .post(self.url.clone())
            .json(&body)
            .send()
            .await?
            .text()
            .await?;
        let resp: RpcResponse<Value> = serde_json::from_str(&text)?;

        let resp = match resp {
            RpcResponse::Success { result } => result,
            RpcResponse::Failure { error } => {
                return Err(RpcClientError::Rpc {
                    code: error.code,
                    message: error.message,
                });
            }
        };

        let result = serde_json::from_value(resp)?;
        Ok(result)
    }
}
