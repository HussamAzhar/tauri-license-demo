import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';

export const ISSUER = 'license-demo';
export const AUDIENCE = 'tauri-license-demo-app';
const ALG = 'RS256';

/**
 * Entitlement token. The desktop client verifies it OFFLINE with the embedded
 * public key, so every field the client needs to make a decision lives here.
 *
 *   iat      when the server last confirmed this activation (online check)
 *   exp      iat + offline grace period: after this the app must reach the server
 *   sub_exp  when the paid subscription itself ends
 */
export async function createTokenService({ privateKeyPem, publicKeyPem, graceSeconds }) {
  const privateKey = await importPKCS8(privateKeyPem, ALG);
  const publicKey = await importSPKI(publicKeyPem, ALG);

  return {
    graceSeconds,

    async issue({ license, activation, keyHint, now }) {
      return new SignJWT({
        mid: activation.machineId,
        plan: license.plan,
        key_hint: keyHint,
        seats_used: license.activations.size,
        seats_max: license.maxSeats,
        sub_exp: license.subscriptionEndsAt,
      })
        .setProtectedHeader({ alg: ALG, typ: 'JWT' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(license.key)
        .setIssuedAt(now)
        .setExpirationTime(now + graceSeconds)
        .setJti(crypto.randomUUID())
        .sign(privateKey);
    },

    /**
     * Verifies signature, issuer and audience. Expiry is deliberately NOT enforced
     * here: a client whose grace period lapsed while offline must still be able to
     * come back online and revalidate. Seat ownership is checked by the caller.
     */
    async verifyIgnoringExpiry(token) {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: [ALG],
        clockTolerance: Number.MAX_SAFE_INTEGER,
      });
      return payload;
    },
  };
}
