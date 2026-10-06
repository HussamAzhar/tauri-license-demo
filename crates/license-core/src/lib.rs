//! Pure licensing logic, kept free of Tauri so it can be unit-tested anywhere
//! and reused by other front-ends (a CLI, a service, a different UI shell).
//!
//! The flow it supports:
//! 1. The server signs an entitlement token (RS256) when a seat is activated.
//! 2. The app stores it and verifies it **offline** with the embedded public key.
//! 3. [`evaluate`] turns verified claims + the current time into a [`LicenseStatus`]
//!    the UI can render: active, offline grace, revalidation required, and so on.

use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const ISSUER: &str = "license-demo";
pub const AUDIENCE: &str = "tauri-license-demo-app";

/// After this long without reaching the server, the app shows it is running on
/// its offline grace period (the token's `exp` sets how long that lasts).
pub const ONLINE_FRESHNESS_SECS: i64 = 24 * 60 * 60;

/// Tolerated clock drift before we assume the system clock was wound back.
pub const CLOCK_SKEW_SECS: i64 = 5 * 60;

#[derive(Debug, thiserror::Error)]
pub enum LicenseError {
    #[error("the license token signature or contents are invalid")]
    InvalidToken(#[from] jsonwebtoken::errors::Error),
}

/// Claims inside the signed entitlement. Mirrors `license-server/src/tokens.js`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Claims {
    /// License key (never shown in the UI; `key_hint` is the masked form).
    pub sub: String,
    /// Machine fingerprint this entitlement is bound to.
    pub mid: String,
    pub plan: String,
    pub key_hint: String,
    pub seats_used: u32,
    pub seats_max: u32,
    /// Subscription end (unix seconds).
    pub sub_exp: i64,
    /// Last successful online validation (unix seconds).
    pub iat: i64,
    /// End of the offline grace period (unix seconds).
    pub exp: i64,
}

/// What the UI needs to know, already decided. Serialised with a `state` tag
/// so the TypeScript side gets a discriminated union.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LicenseStatus {
    /// No token stored on this machine.
    NotActivated,
    /// Validated online recently.
    #[serde(rename_all = "camelCase")]
    Active { details: LicenseDetails },
    /// Not validated for a while, but still inside the offline grace window.
    #[serde(rename_all = "camelCase")]
    OfflineGrace { details: LicenseDetails, grace_seconds_left: i64 },
    /// Grace window used up: the app must reach the server before continuing.
    #[serde(rename_all = "camelCase")]
    RevalidationRequired { details: LicenseDetails },
    /// The paid subscription has ended.
    #[serde(rename_all = "camelCase")]
    SubscriptionExpired { details: LicenseDetails },
    /// The token was issued to a different computer (e.g. copied across).
    WrongMachine,
    /// The system clock is earlier than the last server check: likely wound back
    /// to stretch the grace period.
    ClockTampered,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseDetails {
    pub plan: String,
    pub key_hint: String,
    pub seats_used: u32,
    pub seats_max: u32,
    pub subscription_ends_at: i64,
    pub last_validated_at: i64,
    pub grace_ends_at: i64,
}

impl From<&Claims> for LicenseDetails {
    fn from(c: &Claims) -> Self {
        Self {
            plan: c.plan.clone(),
            key_hint: c.key_hint.clone(),
            seats_used: c.seats_used,
            seats_max: c.seats_max,
            subscription_ends_at: c.sub_exp,
            last_validated_at: c.iat,
            grace_ends_at: c.exp,
        }
    }
}

/// Verifies entitlement tokens with the vendor's public key.
pub struct Verifier {
    key: DecodingKey,
    validation: Validation,
}

impl Verifier {
    pub fn from_public_pem(pem: &[u8]) -> Result<Self, LicenseError> {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[ISSUER]);
        validation.set_audience(&[AUDIENCE]);
        // Expiry is evaluated by `evaluate`, not rejected here: an app whose grace
        // period ran out still needs to read its token to show a useful screen and
        // to send it back to the server for revalidation.
        validation.validate_exp = false;
        validation.set_required_spec_claims(&["exp", "iat", "sub", "iss", "aud"]);
        Ok(Self { key: DecodingKey::from_rsa_pem(pem)?, validation })
    }

    /// Checks signature, algorithm, issuer and audience. Any edit to the payload
    /// (for example raising `seats_max`) breaks the signature and fails here.
    pub fn verify(&self, token: &str) -> Result<Claims, LicenseError> {
        Ok(decode::<Claims>(token, &self.key, &self.validation)?.claims)
    }
}

/// Decides the license state from verified claims. Pure: no I/O, no clock.
pub fn evaluate(claims: &Claims, machine_id: &str, now: i64) -> LicenseStatus {
    if claims.mid != machine_id {
        return LicenseStatus::WrongMachine;
    }
    if now + CLOCK_SKEW_SECS < claims.iat {
        return LicenseStatus::ClockTampered;
    }

    let details = LicenseDetails::from(claims);

    if now >= claims.sub_exp {
        return LicenseStatus::SubscriptionExpired { details };
    }
    if now - claims.iat <= ONLINE_FRESHNESS_SECS {
        return LicenseStatus::Active { details };
    }
    if now < claims.exp {
        return LicenseStatus::OfflineGrace { grace_seconds_left: claims.exp - now, details };
    }
    LicenseStatus::RevalidationRequired { details }
}

/// Stable, non-reversible machine fingerprint. Raw identifiers (hardware UUID,
/// hostname) never leave the device; only this salted SHA-256 is sent.
pub fn fingerprint(components: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"tauri-license-demo:v1");
    for part in components {
        hasher.update([0u8]); // separator so ("ab","c") != ("a","bc")
        hasher.update(part.as_bytes());
    }
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;

    const PRIVATE: &[u8] = include_bytes!("../../../dev-keys/private.pem");
    const PUBLIC: &[u8] = include_bytes!("../../../dev-keys/public.pem");
    const NOW: i64 = 1_790_000_000;
    const DAY: i64 = 86_400;

    fn claims() -> Claims {
        Claims {
            sub: "DEMO-PRO-2026-ALPHA".into(),
            mid: fingerprint(&["machine-a"]),
            plan: "Pro".into(),
            key_hint: "DEMO-****-ALPHA".into(),
            seats_used: 1,
            seats_max: 2,
            sub_exp: NOW + 365 * DAY,
            iat: NOW,
            exp: NOW + 7 * DAY,
        }
    }

    fn sign(c: &Claims) -> String {
        let mut body = serde_json::to_value(c).unwrap();
        body["iss"] = json!(ISSUER);
        body["aud"] = json!(AUDIENCE);
        encode(&Header::new(Algorithm::RS256), &body, &EncodingKey::from_rsa_pem(PRIVATE).unwrap()).unwrap()
    }

    #[test]
    fn verifies_a_genuine_token_even_after_exp() {
        let mut c = claims();
        c.iat = 1_000;
        c.exp = 2_000; // long expired: still readable so the app can revalidate
        let v = Verifier::from_public_pem(PUBLIC).unwrap();
        assert_eq!(v.verify(&sign(&c)).unwrap(), c);
    }

    #[test]
    fn rejects_a_tampered_payload() {
        let token = sign(&claims());
        let parts: Vec<&str> = token.split('.').collect();
        let mut forged = claims();
        forged.seats_max = 999;
        let forged_payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({
                "sub": forged.sub, "mid": forged.mid, "plan": forged.plan, "key_hint": forged.key_hint,
                "seats_used": forged.seats_used, "seats_max": forged.seats_max, "sub_exp": forged.sub_exp,
                "iat": forged.iat, "exp": forged.exp, "iss": ISSUER, "aud": AUDIENCE
        })).unwrap());
        let tampered = format!("{}.{}.{}", parts[0], forged_payload, parts[2]);
        let v = Verifier::from_public_pem(PUBLIC).unwrap();
        assert!(v.verify(&tampered).is_err());
    }

    #[test]
    fn rejects_a_token_with_the_wrong_audience() {
        let mut body = serde_json::to_value(claims()).unwrap();
        body["iss"] = json!(ISSUER);
        body["aud"] = json!("some-other-product");
        let token = encode(&Header::new(Algorithm::RS256), &body, &EncodingKey::from_rsa_pem(PRIVATE).unwrap()).unwrap();
        assert!(Verifier::from_public_pem(PUBLIC).unwrap().verify(&token).is_err());
    }

    #[test]
    fn status_progresses_from_active_to_grace_to_revalidation() {
        let c = claims();
        let mid = c.mid.clone();
        assert!(matches!(evaluate(&c, &mid, NOW + 3600), LicenseStatus::Active { .. }));
        match evaluate(&c, &mid, NOW + 3 * DAY) {
            LicenseStatus::OfflineGrace { grace_seconds_left, .. } => assert_eq!(grace_seconds_left, 4 * DAY),
            other => panic!("expected grace, got {other:?}"),
        }
        assert!(matches!(evaluate(&c, &mid, NOW + 8 * DAY), LicenseStatus::RevalidationRequired { .. }));
    }

    #[test]
    fn subscription_end_wins_over_grace() {
        let mut c = claims();
        c.sub_exp = NOW + DAY;
        let mid = c.mid.clone();
        assert!(matches!(evaluate(&c, &mid, NOW + 2 * DAY), LicenseStatus::SubscriptionExpired { .. }));
    }

    #[test]
    fn token_copied_to_another_machine_is_rejected() {
        let c = claims();
        assert_eq!(evaluate(&c, &fingerprint(&["machine-b"]), NOW), LicenseStatus::WrongMachine);
    }

    #[test]
    fn winding_the_clock_back_is_detected() {
        let c = claims();
        let mid = c.mid.clone();
        assert_eq!(evaluate(&c, &mid, NOW - DAY), LicenseStatus::ClockTampered);
        // small drift is tolerated
        assert!(matches!(evaluate(&c, &mid, NOW - 60), LicenseStatus::Active { .. }));
    }

    #[test]
    fn fingerprint_is_stable_and_unambiguous() {
        assert_eq!(fingerprint(&["a", "b"]), fingerprint(&["a", "b"]));
        assert_ne!(fingerprint(&["ab", "c"]), fingerprint(&["a", "bc"]));
        assert_eq!(fingerprint(&["x"]).len(), 64);
    }

    #[test]
    fn status_serialises_as_a_tagged_union_for_typescript() {
        let c = claims();
        let json = serde_json::to_value(evaluate(&c, &c.mid, NOW + 3 * DAY)).unwrap();
        assert_eq!(json["state"], "offlineGrace");
        assert_eq!(json["details"]["keyHint"], "DEMO-****-ALPHA");
        assert_eq!(json["graceSecondsLeft"], 4 * DAY);
    }
}
