const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const formatDate = (unix: number) => dateFmt.format(unix * 1000);
export const formatDateTime = (unix: number) => dateTimeFmt.format(unix * 1000);

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** 4 days 3 hours / 5 hours / 12 minutes */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day');
  if (hours > 0) return plural(hours, 'hour');
  return plural(Math.max(minutes, 1), 'minute');
}

export function formatAgo(unix: number, now: number): string {
  const diff = now - unix;
  if (diff < 60) return 'just now';
  return `${formatDuration(diff)} ago`;
}

/** Groups a 64-char hex fingerprint for reading aloud to support staff. */
export const formatFingerprint = (id: string) => id.slice(0, 16).match(/.{4}/g)?.join(' ') ?? id;
