//! # Error
//! Contains the Error messages from this crate.

use thiserror::Error;

/// An Error enum capturing the errors produced by this crate.
#[derive(Error, Debug)]
pub enum Error {
    /// The provided parameters are invalid
    #[error("The provided parameters are invalid")]
    InvalidParameters,
    #[error("Unsupported input length: {0}")]
    UnsupportedInputLength(usize),
    /// The provided string is not a field element
    #[error("The provided string is not a field element")]
    ParseString,
    #[error("Err: {0}")]
    Other(String),
}

impl From<String> for Error {
    fn from(mes: String) -> Self {
        Self::Other(mes)
    }
}
impl From<&str> for Error {
    fn from(mes: &str) -> Self {
        Self::Other(mes.to_owned())
    }
}
