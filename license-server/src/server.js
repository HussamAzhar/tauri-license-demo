import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createTokenService } from './tokens.js';

const keyDir = new URL('../../dev-keys/', import.meta.url);
const read = (envVar, file) => process.env[envVar] ?? readFileSync(fileURLToPath(new URL(file, keyDir)), 'utf8');

const PORT = Number(process.env.PORT ?? 4600);
const GRACE_DAYS = Number(process.env.OFFLINE_GRACE_DAYS ?? 7);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';

const tokens = await createTokenService({
  privateKeyPem: read('LICENSE_PRIVATE_KEY', 'private.pem'),
  publicKeyPem: read('LICENSE_PUBLIC_KEY', 'public.pem'),
  graceSeconds: GRACE_DAYS * 24 * 60 * 60,
});

createApp({ tokens, adminToken: ADMIN_TOKEN }).listen(PORT, () => {
  console.log(`License server listening on http://localhost:${PORT}`);
  console.log(`Offline grace period: ${GRACE_DAYS} days`);
  console.log('Demo keys: DEMO-PRO-2026-ALPHA (2 seats), DEMO-TEAM-2026-BRAVO (5), DEMO-SOLO-2026-DELTA (1), DEMO-PRO-2025-EXPIRED');
});
