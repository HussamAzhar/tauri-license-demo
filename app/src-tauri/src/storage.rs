//! Persists the entitlement token and the server address in the OS app-data
//! folder (e.g. ~/Library/Application Support/dev.hussamazhar.keystone).
//!
//! The token is signed, not secret: editing the file breaks the signature and
//! `Verifier::verify` rejects it, so plain-file storage is safe here. Anything
//! genuinely secret (a refresh credential, say) would go in the OS keychain.

use std::{fs, io, path::PathBuf};

use serde::{Deserialize, Serialize};

pub const DEFAULT_SERVER_URL: &str = "http://localhost:4600";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub server_url: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { server_url: DEFAULT_SERVER_URL.to_string() }
    }
}

pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    fn token_path(&self) -> PathBuf {
        self.dir.join("license.jwt")
    }

    fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }

    pub fn load_token(&self) -> io::Result<Option<String>> {
        match fs::read_to_string(self.token_path()) {
            Ok(token) => Ok(Some(token.trim().to_string())),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Write-then-rename so a crash mid-write can't leave a half-written token.
    pub fn save_token(&self, token: &str) -> io::Result<()> {
        let tmp = self.dir.join("license.jwt.tmp");
        fs::write(&tmp, token)?;
        fs::rename(tmp, self.token_path())
    }

    pub fn clear_token(&self) -> io::Result<()> {
        match fs::remove_file(self.token_path()) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }

    pub fn load_settings(&self) -> Settings {
        fs::read_to_string(self.settings_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &Settings) -> io::Result<()> {
        fs::write(self.settings_path(), serde_json::to_string_pretty(settings)?)
    }
}
