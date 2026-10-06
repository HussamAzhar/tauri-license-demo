import type { LicenseStatus } from '../lib/types';
import type { LicenseController } from '../lib/useLicense';
import { formatAgo, formatDate, formatDuration } from '../lib/format';
import { GraceTimeline } from './GraceTimeline';
import { LicenseCard } from './LicenseCard';

type Activated = Exclude<LicenseStatus, { state: 'notActivated' }>;

interface Props {
  status: Activated;
  license: LicenseController;
  now: number;
}

interface Copy {
  tone: 'active' | 'grace' | 'blocked';
  title: string;
  body: string;
}

function copyFor(status: Activated, now: number): Copy {
  switch (status.state) {
    case 'active':
      return {
        tone: 'active',
        title: 'Licensed',
        body: `Checked with the license server ${formatAgo(status.details.lastValidatedAt, now)}. Everything is unlocked on this computer.`,
      };
    case 'offlineGrace':
      return {
        tone: 'grace',
        title: 'Working offline',
        body: `You can keep working for ${formatDuration(status.graceSecondsLeft)}. Connect to the internet before then so ${status.details.plan} stays unlocked.`,
      };
    case 'revalidationRequired':
      return {
        tone: 'blocked',
        title: 'Connection needed',
        body: 'This computer has been offline longer than the license allows. Connect to the internet and check your license to continue.',
      };
    case 'subscriptionExpired':
      return {
        tone: 'blocked',
        title: 'Subscription ended',
        body: `Your ${status.details.plan} subscription ended on ${formatDate(status.details.subscriptionEndsAt)}. Renew it, then check your license again.`,
      };
    case 'wrongMachine':
      return {
        tone: 'blocked',
        title: 'This license belongs to another computer',
        body: 'The license file here was issued to a different machine, so it can’t be used. Remove it and activate this computer with your key.',
      };
    case 'clockTampered':
      return {
        tone: 'blocked',
        title: 'Your system clock looks wrong',
        body: 'The date on this computer is earlier than your last license check. Set the correct date and time, then check your license.',
      };
  }
}

export function LicenseView({ status, license, now }: Props) {
  const { tone, title, body } = copyFor(status, now);
  const details = 'details' in status ? status.details : null;
  const showTimeline = details && status.state !== 'subscriptionExpired';
  const timelineNow = status.state === 'offlineGrace' ? status.details.graceEndsAt - status.graceSecondsLeft : now;
  const canDeactivate = details !== null;

  return (
    <div className="license">
      <section className={`status status--${tone}`} aria-live="polite">
        <p className="status-mark">
          <span className="status-dot" aria-hidden="true" />
          {details ? `${details.plan} license` : 'License'}
        </p>
        <h1 className="status-title">{title}</h1>
        <p className="status-body">{body}</p>

        {showTimeline && (
          <GraceTimeline details={details} now={timelineNow} tone={tone} />
        )}

        <div className="actions">
          {status.state === 'wrongMachine' ? (
            <button className="btn btn--primary" onClick={license.forget} disabled={license.busy !== null}>
              {license.busy === 'forget' ? 'Removing…' : 'Remove license from this computer'}
            </button>
          ) : (
            <button className="btn btn--primary" onClick={license.revalidate} disabled={license.busy !== null}>
              {license.busy === 'revalidate' ? 'Checking…' : 'Check license now'}
            </button>
          )}
          {canDeactivate && (
            <button className="btn btn--quiet" onClick={license.deactivate} disabled={license.busy !== null}>
              {license.busy === 'deactivate' ? 'Deactivating…' : 'Deactivate this computer'}
            </button>
          )}
        </div>
        {canDeactivate && (
          <p className="hint">Deactivating frees this seat so you can use the license on another computer.</p>
        )}
      </section>

      {details && <LicenseCard details={details} device={license.device} now={now} />}
    </div>
  );
}
