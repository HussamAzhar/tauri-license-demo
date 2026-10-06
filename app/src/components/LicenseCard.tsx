import type { Device, LicenseDetails } from '../lib/types';
import { formatDate } from '../lib/format';

interface Props {
  details: LicenseDetails;
  device: Device | null;
  now: number;
}

/** The entitlement as the customer would think of it: what they bought, where it's used. */
export function LicenseCard({ details, device, now }: Props) {
  const ended = now >= details.subscriptionEndsAt;
  return (
    <section className="card" aria-labelledby="card-title">
      <h2 id="card-title" className="card-plan">{details.plan}</h2>
      <p className="card-key mono">{details.keyHint}</p>

      <dl className="card-facts">
        <div>
          <dt>Seats in use</dt>
          <dd>
            <span className="seats" aria-hidden="true">
              {Array.from({ length: details.seatsMax }, (_, i) => (
                <span key={i} className={i < details.seatsUsed ? 'seat seat--used' : 'seat'} />
              ))}
            </span>
            {details.seatsUsed} of {details.seatsMax}
          </dd>
        </div>
        <div>
          <dt>{ended ? 'Subscription ended' : 'Subscription renews'}</dt>
          <dd>{formatDate(details.subscriptionEndsAt)}</dd>
        </div>
        {device && (
          <div>
            <dt>This computer</dt>
            <dd>{device.machineName}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
