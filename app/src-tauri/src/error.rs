use serde::Serialize;

/// Error returned to the front-end. Serialises to `{ code, message }` so the UI
/// can branch on `code` (e.g. show "Free a seat" for SEAT_LIMIT_REACHED) and
/// display `message` as-is.
#[derive(Debug, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
}

impl From<reqwest::Error> for CommandError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_connect() || err.is_timeout() {
            Self::new("OFFLINE", "Can't reach the license server. Check your connection and the server address.")
        } else {
            Self::new("NETWORK", format!("The license server request failed: {err}"))
        }
    }
}

impl From<license_core::LicenseError> for CommandError {
    fn from(_: license_core::LicenseError) -> Self {
        Self::new("INVALID_TOKEN", "The license file on this computer failed its signature check.")
    }
}

impl From<std::io::Error> for CommandError {
    fn from(err: std::io::Error) -> Self {
        Self::new("STORAGE", format!("Couldn't read or write the license file: {err}"))
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
