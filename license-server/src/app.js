import express from 'express';
import cors from 'cors';
import { createStore, maskKey, normaliseKey } from './store.js';

const MACHINE_ID = /^[a-f0-9]{64}$/;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Builds the Express app. `now` is injectable so tests can move the clock.
 */
export function createApp({ tokens, adminToken, now = () => Math.floor(Date.now() / 1000) }) {
  const store = createStore(now);
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '16kb' }));

  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  function requireLicense(key) {
    const license = store.get(key);
    if (!license) throw new ApiError(404, 'LICENSE_NOT_FOUND', 'That license key does not exist.');
    if (license.revoked) throw new ApiError(403, 'LICENSE_REVOKED', 'This license has been revoked.');
    if (license.subscriptionEndsAt <= now()) {
      throw new ApiError(402, 'SUBSCRIPTION_EXPIRED', 'The subscription for this license has ended. Renew to continue.');
    }
    return license;
  }

  async function tokenResponse(license, activation) {
    const token = await tokens.issue({ license, activation, keyHint: maskKey(license.key), now: now() });
    return {
      token,
      plan: license.plan,
      seatsUsed: license.activations.size,
      seatsMax: license.maxSeats,
      subscriptionEndsAt: license.subscriptionEndsAt,
      offlineGraceSeconds: tokens.graceSeconds,
    };
  }

  async function readToken(req) {
    const token = req.body?.token;
    if (typeof token !== 'string' || token.length > 4096) {
      throw new ApiError(400, 'BAD_REQUEST', 'A token is required.');
    }
    try {
      return await tokens.verifyIgnoringExpiry(token);
    } catch {
      throw new ApiError(401, 'INVALID_TOKEN', 'The license token is invalid or was tampered with.');
    }
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: now() }));

  // 1. Activation: claim a seat for this machine and receive a signed entitlement.
  app.post('/api/activate', route(async (req, res) => {
    const licenseKey = normaliseKey(req.body?.licenseKey);
    const machineId = String(req.body?.machineId ?? '');
    const machineName = String(req.body?.machineName ?? 'Unknown device').slice(0, 80);

    if (!licenseKey) throw new ApiError(400, 'BAD_REQUEST', 'Enter a license key.');
    if (!MACHINE_ID.test(machineId)) throw new ApiError(400, 'BAD_REQUEST', 'Invalid machine fingerprint.');

    const license = requireLicense(licenseKey);
    let activation = license.activations.get(machineId);

    if (!activation) {
      if (license.activations.size >= license.maxSeats) {
        throw new ApiError(409, 'SEAT_LIMIT_REACHED',
          `All ${license.maxSeats} seat(s) are in use. Deactivate another device to free a seat.`);
      }
      activation = { machineId, machineName, activatedAt: now(), lastSeenAt: now() };
      license.activations.set(machineId, activation);
    }
    activation.lastSeenAt = now();

    res.json(await tokenResponse(license, activation));
  }));

  // 2. Revalidation: exchange a (possibly grace-expired) token for a fresh one.
  app.post('/api/validate', route(async (req, res) => {
    const claims = await readToken(req);
    const license = requireLicense(claims.sub);
    const activation = license.activations.get(claims.mid);
    if (!activation) {
      throw new ApiError(410, 'SEAT_RELEASED', 'This device no longer holds a seat. Activate again.');
    }
    activation.lastSeenAt = now();
    res.json(await tokenResponse(license, activation));
  }));

  // 3. Deactivation: release the seat so it can be used on another machine.
  app.post('/api/deactivate', route(async (req, res) => {
    const claims = await readToken(req);
    const license = store.get(claims.sub);
    const released = license?.activations.delete(claims.mid) ?? false;
    res.json({ released, seatsUsed: license?.activations.size ?? 0 });
  }));

  // Demo-only admin endpoints so revocation can be shown live.
  const requireAdmin = (req) => {
    if (req.get('x-admin-token') !== adminToken) throw new ApiError(401, 'UNAUTHORISED', 'Admin token required.');
  };

  app.get('/api/admin/licenses', route(async (req, res) => {
    requireAdmin(req);
    res.json(store.list().map((l) => ({
      key: l.key,
      plan: l.plan,
      revoked: l.revoked,
      subscriptionEndsAt: l.subscriptionEndsAt,
      seats: { used: l.activations.size, max: l.maxSeats },
      devices: [...l.activations.values()].map(({ machineName, activatedAt, lastSeenAt }) => ({ machineName, activatedAt, lastSeenAt })),
    })));
  }));

  app.post('/api/admin/revoke', route(async (req, res) => {
    requireAdmin(req);
    const license = store.get(req.body?.licenseKey);
    if (!license) throw new ApiError(404, 'LICENSE_NOT_FOUND', 'That license key does not exist.');
    license.revoked = true;
    res.json({ revoked: true });
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body.' } });
    }
    console.error(err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error.' } });
  });

  return app;
}
