use crate::HttpError;

pub trait ResponseExt {
    fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, HttpError>;
    fn text(&self) -> Result<String, HttpError>;
}

impl ResponseExt for http::Response<Vec<u8>> {
    fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, HttpError> {
        serde_json::from_slice(self.body()).map_err(|e| HttpError::Request(e.to_string()))
    }

    fn text(&self) -> Result<String, HttpError> {
        String::from_utf8(self.body().clone()).map_err(|e| HttpError::Request(e.to_string()))
    }
}
