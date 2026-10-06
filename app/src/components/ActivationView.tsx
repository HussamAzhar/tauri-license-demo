import { useState, type FormEvent } from 'react';
import type { LicenseController } from '../lib/useLicense';
import { formatFingerprint } from '../lib/format';

const DEMO_KEYS = [
  { key: 'DEMO-PRO-2026-ALPHA', note: 'Pro, 2 seats' },
  { key: 'DEMO-TEAM-2026-BRAVO', note: 'Team, 5 seats' },
  { key: 'DEMO-SOLO-2026-DELTA', note: 'Personal, 1 seat' },
  { key: 'DEMO-PRO-2025-EXPIRED', note: 'Subscription ended' },
];

export function ActivationView({ license }: { license: LicenseController }) {
  const [key, setKey] = useState('');
  const busy = license.busy === 'activate';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) await license.activate(key);
  };

  return (
    <div className="activate">
      <form className="activate-form" onSubmit={submit}>
        <h1 className="activate-title">Activate Keystone</h1>
        <p className="status-body">
          Enter the license key from your purchase email. Activation uses one seat on your license and works offline afterwards.
        </p>

        <label htmlFor="license-key" className="field-label">License key</label>
        <input
          id="license-key"
          className="key-input mono"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <div className="actions">
          <button className="btn btn--primary" type="submit" disabled={busy || !key.trim()}>
            {busy ? 'Activating…' : 'Activate this computer'}
          </button>
        </div>

        {license.device && (
          <p className="hint">
            This computer is identified as <span className="mono">{formatFingerprint(license.device.machineId)}</span>.
            Only this one-way fingerprint is sent, never the hardware ID itself.
          </p>
        )}
      </form>

      <aside className="demo-keys" aria-labelledby="demo-keys-title">
        <h2 id="demo-keys-title" className="aside-title">Demo keys</h2>
        <p className="hint">The local license server accepts these. Pick one to fill it in.</p>
        <ul>
          {DEMO_KEYS.map((d) => (
            <li key={d.key}>
              <button type="button" className="demo-key" onClick={() => setKey(d.key)}>
                <span className="mono">{d.key}</span>
                <span className="demo-key-note">{d.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
