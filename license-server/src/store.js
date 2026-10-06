// In-memory license store. A real deployment would back this with MySQL/Postgres;
// the shape mirrors a typical licenses + activations schema.

const DAY = 24 * 60 * 60;

/**
 * @typedef {{ machineId: string, machineName: string, activatedAt: number, lastSeenAt: number }} Activation
 * @typedef {{ key: string, plan: string, maxSeats: number, subscriptionEndsAt: number, revoked: boolean, activations: Map<string, Activation> }} License
 */

export function maskKey(key) {
  // DEMO-PRO-2026-ALPHA -> DEMO-****-ALPHA
  const parts = key.split('-');
  if (parts.length < 3) return '****';
  return `${parts[0]}-****-${parts[parts.length - 1]}`;
}

export function normaliseKey(input) {
  return String(input ?? '').trim().toUpperCase();
}

export function createStore(nowSeconds) {
  const now = nowSeconds();
  /** @type {Map<string, License>} */
  const licenses = new Map();

  const seed = [
    { key: 'DEMO-PRO-2026-ALPHA', plan: 'Pro', maxSeats: 2, subscriptionEndsAt: now + 365 * DAY },
    { key: 'DEMO-TEAM-2026-BRAVO', plan: 'Team', maxSeats: 5, subscriptionEndsAt: now + 180 * DAY },
    { key: 'DEMO-SOLO-2026-DELTA', plan: 'Personal', maxSeats: 1, subscriptionEndsAt: now + 30 * DAY },
    { key: 'DEMO-PRO-2025-EXPIRED', plan: 'Pro', maxSeats: 2, subscriptionEndsAt: now - 10 * DAY },
  ];

  for (const l of seed) {
    licenses.set(l.key, { ...l, revoked: false, activations: new Map() });
  }

  return {
    get(key) {
      return licenses.get(normaliseKey(key));
    },
    list() {
      return [...licenses.values()];
    },
  };
}
