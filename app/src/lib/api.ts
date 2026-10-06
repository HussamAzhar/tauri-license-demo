import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CommandError, Device, LicenseStatus, Settings } from './types';
import { previewBackend } from './previewBackend';

/**
 * Typed wrapper around the Rust commands in app/src-tauri/src/lib.rs.
 * Components import `api` and never call `invoke` with string names directly,
 * so a renamed command is one change here instead of a hunt through the UI.
 *
 * Outside Tauri (plain `npm run dev` in a browser) a simulated backend is used,
 * which keeps UI work possible without a Rust toolchain.
 */
export interface LicenseApi {
  getDevice(): Promise<Device>;
  getSettings(): Promise<Settings>;
  setServerUrl(url: string): Promise<Settings>;
  getStatus(): Promise<LicenseStatus>;
  activate(licenseKey: string): Promise<LicenseStatus>;
  revalidate(): Promise<LicenseStatus>;
  deactivate(): Promise<LicenseStatus>;
  forgetLocalLicense(): Promise<LicenseStatus>;
  setDemoClockOffset(days: number): Promise<LicenseStatus>;
}

const tauriBackend: LicenseApi = {
  getDevice: () => invoke('get_device'),
  getSettings: () => invoke('get_settings'),
  setServerUrl: (url) => invoke('set_server_url', { url }),
  getStatus: () => invoke('get_status'),
  activate: (licenseKey) => invoke('activate', { licenseKey }),
  revalidate: () => invoke('revalidate'),
  deactivate: () => invoke('deactivate'),
  forgetLocalLicense: () => invoke('forget_local_license'),
  setDemoClockOffset: (days) => invoke('set_demo_clock_offset', { days }),
};

export const inTauri = isTauri();
export const api: LicenseApi = inTauri ? tauriBackend : previewBackend;

export function toCommandError(err: unknown): CommandError {
  if (typeof err === 'object' && err !== null && 'code' in err && 'message' in err) {
    return err as CommandError;
  }
  return { code: 'SERVER', message: String(err) };
}
