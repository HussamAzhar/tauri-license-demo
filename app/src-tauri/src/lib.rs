//! Tauri backend. The React front-end never talks to the network or touches the
//! license file directly: it calls these commands over IPC, and all HTTP,
//! cryptography and storage happen here in Rust.

mod device;
mod error;
mod storage;

use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use license_core::{evaluate, LicenseStatus, Verifier};
use serde::Deserialize;
use serde_json::json;
use tauri::{Manager, State};

use device::Device;
use error::{CommandError, CommandResult};
use storage::{Settings, Storage};

/// The vendor's public key is compiled into the binary. Swapping it would mean
/// patching the executable, which code signing on macOS/Windows makes visible.
const LICENSE_PUBLIC_KEY: &[u8] = include_bytes!("../../../dev-keys/public.pem");

struct AppState {
    verifier: Verifier,
    device: Device,
    storage: Storage,
    http: reqwest::Client,
    settings: Mutex<Settings>,
    /// Demo-only: seconds added to the real clock to show the grace period.
    clock_offset: Mutex<i64>,
}

impl AppState {
    fn now(&self) -> i64 {
        let real = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        real + *self.clock_offset.lock().unwrap()
    }

    fn server_url(&self) -> String {
        self.settings.lock().unwrap().server_url.trim_end_matches('/').to_string()
    }

    /// Reads the stored token and turns it into a status, entirely offline.
    fn current_status(&self) -> CommandResult<LicenseStatus> {
        let Some(token) = self.storage.load_token()? else {
            return Ok(LicenseStatus::NotActivated);
        };
        let claims = self.verifier.verify(&token)?;
        Ok(evaluate(&claims, &self.device.machine_id, self.now()))
    }

    /// POSTs to the license server and returns the parsed JSON or a typed error.
    async fn post(&self, path: &str, body: serde_json::Value) -> CommandResult<serde_json::Value> {
        let res = self.http.post(format!("{}{}", self.server_url(), path)).json(&body).send().await?;
        let ok = res.status().is_success();
        let payload: serde_json::Value = res.json().await.unwrap_or_default();
        if ok {
            return Ok(payload);
        }
        #[derive(Deserialize)]
        struct ApiError {
            code: String,
            message: String,
        }
        match serde_json::from_value::<ApiError>(payload["error"].clone()) {
            Ok(e) => Err(CommandError::new(&e.code, e.message)),
            Err(_) => Err(CommandError::new("SERVER", "The license server returned an unexpected response.")),
        }
    }

    /// Verifies a token from the server *before* storing it, so a spoofed or
    /// intercepted response can't install a forged entitlement.
    fn accept_token(&self, payload: &serde_json::Value) -> CommandResult<LicenseStatus> {
        let token = payload["token"]
            .as_str()
            .ok_or_else(|| CommandError::new("SERVER", "The server response did not include a license token."))?;
        self.verifier.verify(token)?;
        self.storage.save_token(token)?;
        *self.clock_offset.lock().unwrap() = 0; // back online: simulated time ends
        self.current_status()
    }
}

#[tauri::command]
fn get_device(state: State<'_, AppState>) -> Device {
    state.device.clone()
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_server_url(state: State<'_, AppState>, url: String) -> CommandResult<Settings> {
    let url = url.trim().to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(CommandError::new("BAD_REQUEST", "The server address must start with http:// or https://."));
    }
    let settings = Settings { server_url: url };
    state.storage.save_settings(&settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> CommandResult<LicenseStatus> {
    state.current_status()
}

#[tauri::command]
async fn activate(state: State<'_, AppState>, license_key: String) -> CommandResult<LicenseStatus> {
    let payload = state
        .post(
            "/api/activate",
            json!({
                "licenseKey": license_key.trim(),
                "machineId": state.device.machine_id,
                "machineName": state.device.machine_name,
            }),
        )
        .await?;
    state.accept_token(&payload)
}

#[tauri::command]
async fn revalidate(state: State<'_, AppState>) -> CommandResult<LicenseStatus> {
    let Some(token) = state.storage.load_token()? else {
        return Ok(LicenseStatus::NotActivated);
    };
    match state.post("/api/validate", json!({ "token": token })).await {
        Ok(payload) => state.accept_token(&payload),
        // The vendor says this machine is no longer entitled: drop the local copy.
        Err(e) if matches!(e.code.as_str(), "SEAT_RELEASED" | "LICENSE_REVOKED" | "LICENSE_NOT_FOUND") => {
            state.storage.clear_token()?;
            Err(e)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn deactivate(state: State<'_, AppState>) -> CommandResult<LicenseStatus> {
    if let Some(token) = state.storage.load_token()? {
        // The seat only frees up if the server hears about it, so a failed
        // request keeps the local license rather than silently losing the seat.
        state.post("/api/deactivate", json!({ "token": token })).await?;
        state.storage.clear_token()?;
    }
    Ok(LicenseStatus::NotActivated)
}

/// Removes a corrupted or tampered license file so the user can start over.
#[tauri::command]
fn forget_local_license(state: State<'_, AppState>) -> CommandResult<LicenseStatus> {
    state.storage.clear_token()?;
    Ok(LicenseStatus::NotActivated)
}

#[cfg(feature = "demo-controls")]
#[tauri::command]
fn set_demo_clock_offset(state: State<'_, AppState>, days: f64) -> CommandResult<LicenseStatus> {
    *state.clock_offset.lock().unwrap() = (days * 86_400.0) as i64;
    state.current_status()
}

#[cfg(not(feature = "demo-controls"))]
#[tauri::command]
fn set_demo_clock_offset(_days: f64) -> CommandResult<LicenseStatus> {
    Err(CommandError::new("DISABLED", "Demo controls are not included in this build."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let storage = Storage::new(app.path().app_data_dir()?)?;
            let settings = storage.load_settings();
            app.manage(AppState {
                verifier: Verifier::from_public_pem(LICENSE_PUBLIC_KEY)?,
                device: Device::detect(),
                http: reqwest::Client::builder()
                    .timeout(Duration::from_secs(8))
                    .user_agent(concat!("keystone/", env!("CARGO_PKG_VERSION")))
                    .build()?,
                settings: Mutex::new(settings),
                storage,
                clock_offset: Mutex::new(0),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device,
            get_settings,
            set_server_url,
            get_status,
            activate,
            revalidate,
            deactivate,
            forget_local_license,
            set_demo_clock_offset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Keystone");
}
