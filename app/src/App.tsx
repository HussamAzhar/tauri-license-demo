import { useEffect, useState } from 'react';
import { useLicense } from './lib/useLicense';
import { ActivationView } from './components/ActivationView';
import { LicenseView } from './components/LicenseView';
import { Footer } from './components/Footer';
import type { CommandError } from './lib/types';

const ERROR_HINTS: Partial<Record<CommandError['code'], string>> = {
  OFFLINE: 'Running the demo locally? Start the server with npm start in the license-server folder.',
  SEAT_LIMIT_REACHED: 'Deactivate the license on another computer, or use a key with more seats.',
  INVALID_TOKEN: 'It was edited or damaged. Remove it, then activate again with your key.',
};

export default function App() {
  const license = useLicense();
  const { status, error } = license;

  // Ticks once a minute so "checked 5 minutes ago" stays current.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const now = Math.floor(clock / 1000) + Math.round(license.demoOffsetDays * 86_400);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <img src="/keystone.svg" alt="" width={22} height={22} />
          Keystone
        </span>
        {license.device && (
          <span className="topbar-device">
            {license.device.machineName}, {license.device.os} {license.device.arch}
          </span>
        )}
      </header>

      <main className="main">
        {error && (
          <div className="alert" role="alert">
            <div>
              <p className="alert-title">{error.message}</p>
              {ERROR_HINTS[error.code] && <p className="alert-hint">{ERROR_HINTS[error.code]}</p>}
            </div>
            <div className="alert-actions">
              {error.code === 'INVALID_TOKEN' && (
                <button className="btn btn--small" onClick={license.forget}>Remove license file</button>
              )}
              <button className="btn btn--small btn--quiet" onClick={license.dismissError}>Dismiss</button>
            </div>
          </div>
        )}

        {status === null ? (
          <p className="loading">Reading license…</p>
        ) : status.state === 'notActivated' ? (
          <ActivationView license={license} />
        ) : (
          <LicenseView status={status} license={license} now={now} />
        )}
      </main>

      <Footer license={license} activated={status !== null && status.state !== 'notActivated'} />
    </div>
  );
}
