import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/tokens.js';

const keys = (f) => readFileSync(new URL(`../../dev-keys/${f}`, import.meta.url), 'utf8');
const machine = (name) => createHash('sha256').update(name).digest('hex');
const GRACE = 7 * 24 * 3600;

let server;
let base;
let clock = Math.floor(Date.now() / 1000);

before(async () => {
  const tokens = await createTokenService({
    privateKeyPem: keys('private.pem'),
    publicKeyPem: keys('public.pem'),
    graceSeconds: GRACE,
  });
  const app = createApp({ tokens, adminToken: 'test-admin', now: () => clock });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function post(path, body, headers = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('activation returns a signed entitlement with grace-period expiry', async () => {
  const { status, body } = await post('/api/activate', { licenseKey: 'demo-pro-2026-alpha', machineId: machine('a') });
  assert.equal(status, 200);
  const claims = decodeJwt(body.token);
  assert.equal(claims.mid, machine('a'));
  assert.equal(claims.plan, 'Pro');
  assert.equal(claims.key_hint, 'DEMO-****-ALPHA');
  assert.equal(claims.exp - claims.iat, GRACE);
  assert.equal(body.seatsUsed, 1);
});

test('re-activating the same machine does not consume another seat', async () => {
  const { body } = await post('/api/activate', { licenseKey: 'DEMO-PRO-2026-ALPHA', machineId: machine('a') });
  assert.equal(body.seatsUsed, 1);
});

test('seat limit is enforced and freed by deactivation', async () => {
  const first = await post('/api/activate', { licenseKey: 'DEMO-SOLO-2026-DELTA', machineId: machine('laptop') });
  assert.equal(first.status, 200);

  const blocked = await post('/api/activate', { licenseKey: 'DEMO-SOLO-2026-DELTA', machineId: machine('desktop') });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'SEAT_LIMIT_REACHED');

  const released = await post('/api/deactivate', { token: first.body.token });
  assert.equal(released.body.released, true);

  const retry = await post('/api/activate', { licenseKey: 'DEMO-SOLO-2026-DELTA', machineId: machine('desktop') });
  assert.equal(retry.status, 200);
});

test('expired subscriptions and unknown keys are rejected', async () => {
  const expired = await post('/api/activate', { licenseKey: 'DEMO-PRO-2025-EXPIRED', machineId: machine('a') });
  assert.equal(expired.status, 402);
  const unknown = await post('/api/activate', { licenseKey: 'NOPE-1234', machineId: machine('a') });
  assert.equal(unknown.status, 404);
});

test('a token whose grace period lapsed offline can still be revalidated', async () => {
  const { body } = await post('/api/activate', { licenseKey: 'DEMO-TEAM-2026-BRAVO', machineId: machine('field-pc') });
  clock += GRACE + 3600; // the device was offline for 7 days and 1 hour
  const renewed = await post('/api/validate', { token: body.token });
  assert.equal(renewed.status, 200);
  assert.equal(decodeJwt(renewed.body.token).iat, clock);
});

test('tampered tokens are rejected', async () => {
  const { body } = await post('/api/activate', { licenseKey: 'DEMO-TEAM-2026-BRAVO', machineId: machine('b') });
  const [h, p, s] = body.token.split('.');
  const forged = JSON.parse(Buffer.from(p, 'base64url'));
  forged.seats_max = 999;
  const tampered = [h, Buffer.from(JSON.stringify(forged)).toString('base64url'), s].join('.');
  const res = await post('/api/validate', { token: tampered });
  assert.equal(res.status, 401);
});

test('revocation blocks revalidation', async () => {
  const { body } = await post('/api/activate', { licenseKey: 'DEMO-PRO-2026-ALPHA', machineId: machine('c') });
  const denied = await post('/api/admin/revoke', { licenseKey: 'DEMO-PRO-2026-ALPHA' });
  assert.equal(denied.status, 401);
  await post('/api/admin/revoke', { licenseKey: 'DEMO-PRO-2026-ALPHA' }, { 'x-admin-token': 'test-admin' });
  const res = await post('/api/validate', { token: body.token });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'LICENSE_REVOKED');
});
