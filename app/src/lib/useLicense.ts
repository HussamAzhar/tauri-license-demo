import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toCommandError } from './api';
import type { CommandError, Device, LicenseStatus, Settings } from './types';

export type Action = 'activate' | 'revalidate' | 'deactivate' | 'forget' | 'settings';

const BACKGROUND_CHECK_MS = 15 * 60 * 1000;

/**
 * Owns license state for the whole app. Components get the current status,
 * which action (if any) is in flight, the last error, and the action methods.
 */
export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<CommandError | null>(null);
  const [demoOffsetDays, setDemoOffsetDays] = useState(0);
  const mounted = useRef(true);

  const run = useCallback(async (action: Action, fn: () => Promise<LicenseStatus>) => {
    setBusy(action);
    setError(null);
    try {
      const next = await fn();
      if (mounted.current) setStatus(next);
      return true;
    } catch (err) {
      const e = toCommandError(err);
      if (mounted.current) {
        setError(e);
        // The server may have revoked or released the seat; re-read local state.
        setStatus(await api.getStatus().catch(() => ({ state: 'notActivated' as const })));
      }
      return false;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  // Quiet revalidation: on launch and every 15 minutes. Being offline is
  // normal for a desktop app, so a failed background check is not an error.
  const backgroundCheck = useCallback(async () => {
    try {
      const next = await api.revalidate();
      if (mounted.current) {
        setStatus(next);
        setDemoOffsetDays(0);
      }
    } catch (err) {
      const e = toCommandError(err);
      if (!['OFFLINE', 'NETWORK'].includes(e.code) && mounted.current) setError(e);
      if (mounted.current) setStatus(await api.getStatus().catch(() => null));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const [d, s] = await Promise.all([api.getDevice(), api.getSettings()]);
      setDevice(d);
      setSettings(s);
      try {
        const local = await api.getStatus();
        setStatus(local);
        if (local.state !== 'notActivated') void backgroundCheck();
      } catch (err) {
        setError(toCommandError(err));
        setStatus({ state: 'notActivated' });
      }
    })();
    const timer = setInterval(() => void backgroundCheck(), BACKGROUND_CHECK_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [backgroundCheck]);

  const resetsDemoClock = (ok: boolean) => {
    if (ok) setDemoOffsetDays(0);
    return ok;
  };

  return {
    status,
    device,
    settings,
    busy,
    error,
    demoOffsetDays,
    dismissError: () => setError(null),
    activate: async (key: string) => resetsDemoClock(await run('activate', () => api.activate(key))),
    revalidate: async () => resetsDemoClock(await run('revalidate', api.revalidate)),
    deactivate: () => run('deactivate', api.deactivate),
    forget: () => run('forget', api.forgetLocalLicense),
    setDemoOffset: async (days: number) => {
      setDemoOffsetDays(days);
      try {
        setStatus(await api.setDemoClockOffset(days));
      } catch (err) {
        setError(toCommandError(err));
      }
    },
    saveServerUrl: async (url: string) => {
      setBusy('settings');
      setError(null);
      try {
        setSettings(await api.setServerUrl(url));
        return true;
      } catch (err) {
        setError(toCommandError(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
  };
}

export type LicenseController = ReturnType<typeof useLicense>;
