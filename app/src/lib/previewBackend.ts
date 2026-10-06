import type { LicenseApi } from './api';
import type { CommandError, LicenseDetails, LicenseStatus } from './types';

/**
 * Browser-only stand-in for the Rust backend, used by `npm run dev` outside
 * Tauri. It returns the same shapes with simulated data; none of the real
 * security (signature checks, machine binding) happens here.
 */

const DAY = 86_400;
const GRACE = 7 * DAY;
const FRESH = DAY;
const now = () => Math.floor(Date.now() / 1000);

const plans: Record<string, { plan: string; seatsMax: number; endsInDays: number }> = {
  'DEMO-PRO-2026-ALPHA': { plan: 'Pro', seatsMax: 2, endsInDays: 365 },
  'DEMO-TEAM-2026-BRAVO': { plan: 'Team', seatsMax: 5, endsInDays: 180 },
  'DEMO-SOLO-2026-DELTA': { plan: 'Personal', seatsMax: 1, endsInDays: 30 },
  'DEMO-PRO-2025-EXPIRED': { plan: 'Pro', seatsMax: 2, endsInDays: -10 },
};

let license: LicenseDetails | null = null;
let offset = 0;
let serverUrl = 'http://localhost:4600';

const fail = (code: CommandError['code'], message: string): never => {
  throw { code, message } satisfies CommandError;
};

function evaluate(): LicenseStatus {
  if (!license) return { state: 'notActivated' };
  const t = now() + offset;
  if (t + 300 < license.lastValidatedAt) return { state: 'clockTampered' };
  if (t >= license.subscriptionEndsAt) return { state: 'subscriptionExpired', details: license };
  if (t - license.lastValidatedAt <= FRESH) return { state: 'active', details: license };
  if (t < license.graceEndsAt) return { state: 'offlineGrace', details: license, graceSecondsLeft: license.graceEndsAt - t };
  return { state: 'revalidationRequired', details: license };
}

const pause = () => new Promise((r) => setTimeout(r, 450));

export const previewBackend: LicenseApi = {
  async getDevice() {
    return { machineId: 'b7e1c94f0a2d6e83f51c7a90d2b44e6c18f3a5d09e7b2c61f4a8d3e5c7b9a1f20', machineName: 'Browser preview', os: 'web', arch: 'n/a' };
  },
  async getSettings() {
    return { serverUrl };
  },
  async setServerUrl(url: string) {
    serverUrl = url;
    return { serverUrl };
  },
  async getStatus() {
    return evaluate();
  },
  async activate(licenseKey: string) {
    await pause();
    const key = licenseKey.trim().toUpperCase();
    const p = plans[key] ?? fail('LICENSE_NOT_FOUND', 'That license key does not exist.');
    if (p.endsInDays < 0) fail('SUBSCRIPTION_EXPIRED', 'The subscription for this license has ended. Renew to continue.');
    const parts = key.split('-');
    const t = now();
    license = {
      plan: p.plan,
      keyHint: `${parts[0]}-****-${parts[parts.length - 1]}`,
      seatsUsed: 1,
      seatsMax: p.seatsMax,
      subscriptionEndsAt: t + p.endsInDays * DAY,
      lastValidatedAt: t,
      graceEndsAt: t + GRACE,
    };
    offset = 0;
    return evaluate();
  },
  async revalidate() {
    await pause();
    if (license) {
      license = { ...license, lastValidatedAt: now(), graceEndsAt: now() + GRACE };
      offset = 0;
    }
    return evaluate();
  },
  async deactivate() {
    await pause();
    license = null;
    return evaluate();
  },
  async forgetLocalLicense() {
    license = null;
    return evaluate();
  },
  async setDemoClockOffset(days: number) {
    offset = Math.round(days * DAY);
    return evaluate();
  },
};
