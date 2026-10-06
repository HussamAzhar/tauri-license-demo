//! Device identity. The raw OS machine ID never leaves the computer; the
//! server only ever sees a salted SHA-256 fingerprint.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// 64-char hex fingerprint sent to the license server.
    pub machine_id: String,
    /// Friendly name shown in the vendor's seat list ("Hussam's MacBook").
    pub machine_name: String,
    pub os: String,
    pub arch: String,
}

impl Device {
    pub fn detect() -> Self {
        let host = gethostname::gethostname().to_string_lossy().into_owned();
        // machine-uid reads /etc/machine-id (Linux), IOPlatformUUID (macOS) or
        // MachineGuid from the registry (Windows). Fall back to the hostname so
        // the app still works inside unusual sandboxes.
        let os_uid = machine_uid::get().unwrap_or_else(|_| format!("fallback:{host}"));

        Self {
            machine_id: license_core::fingerprint(&[&os_uid, std::env::consts::OS, std::env::consts::ARCH]),
            machine_name: host,
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }
}
