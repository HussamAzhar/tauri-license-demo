import { useState, type FormEvent } from 'react';
import type { LicenseController } from '../lib/useLicense';
import { inTauri } from '../lib/api';

/** Server address and the demo clock that drives the offline grace period. */
export function Footer({ license, activated }: { license: LicenseController; activated: boolean }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');

  const startEditing = () => {
    setUrl(license.settings?.serverUrl ?? '');
    setEditing(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await license.saveServerUrl(url)) setEditing(false);
  };

  const days = license.demoOffsetDays;

  return (
    <footer className="footer">
      <div className="footer-server">
        {editing ? (
          <form onSubmit={save} className="server-form">
            <label htmlFor="server-url" className="field-label">License server</label>
            <input id="server-url" className="server-input mono" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            <button className="btn btn--small" type="submit" disabled={license.busy === 'settings'}>Save</button>
            <button className="btn btn--small btn--quiet" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <p>
            License server <span className="mono">{license.settings?.serverUrl ?? '…'}</span>{' '}
            <button className="link" onClick={startEditing}>Change</button>
            {!inTauri && <span className="preview-flag">Browser preview with simulated responses</span>}
          </p>
        )}
      </div>

      {activated && (
        <div className="clock">
          <label htmlFor="demo-clock" className="field-label">
            Demo clock: {days === 0 ? 'real time' : `${days > 0 ? '+' : ''}${days} days`}
          </label>
          <input
            id="demo-clock"
            type="range"
            min={-2}
            max={10}
            step={0.5}
            value={days}
            onChange={(e) => void license.setDemoOffset(Number(e.target.value))}
          />
          <p className="hint">Move time forward to see the offline allowance run out, or back to trip clock-tamper detection. Checking your license resets it.</p>
        </div>
      )}
    </footer>
  );
}
