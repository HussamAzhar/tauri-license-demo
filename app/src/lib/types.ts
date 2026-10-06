// Mirrors the Rust types in crates/license-core and app/src-tauri.
// LicenseStatus is a discriminated union on `state`, so `switch (status.state)`
// narrows each branch and TypeScript flags any state the UI forgets to handle.

export interface LicenseDetails {
  plan: string;
  keyHint: string;
  seatsUsed: number;
  seatsMax: number;
  subscriptionEndsAt: number;
  lastValidatedAt: number;
  graceEndsAt: number;
}

export type LicenseStatus =
  | { state: 'notActivated' }
  | { state: 'active'; details: LicenseDetails }
  | { state: 'offlineGrace'; details: LicenseDetails; graceSecondsLeft: number }
  | { state: 'revalidationRequired'; details: LicenseDetails }
  | { state: 'subscriptionExpired'; details: LicenseDetails }
  | { state: 'wrongMachine' }
  | { state: 'clockTampered' };

export interface Device {
  machineId: string;
  machineName: string;
  os: string;
  arch: string;
}

export interface Settings {
  serverUrl: string;
}

export type ErrorCode =
  | 'OFFLINE'
  | 'NETWORK'
  | 'SERVER'
  | 'STORAGE'
  | 'BAD_REQUEST'
  | 'INVALID_TOKEN'
  | 'LICENSE_NOT_FOUND'
  | 'LICENSE_REVOKED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SEAT_LIMIT_REACHED'
  | 'SEAT_RELEASED'
  | 'DISABLED';

export interface CommandError {
  code: ErrorCode;
  message: string;
}

export function isCommandError(value: unknown): value is CommandError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}
