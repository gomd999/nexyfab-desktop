/**
 * NexySys SSO — RS256 JWT verification via auth.nexysys.com JWKS
 *
 * Verification flow:
 *   1. Verify RS256 signature against cached JWKS
 *   2. Require email_verified === true (account takeover prevention)
 *   3. Look up nf_users by sso_sub → if found, return user
 *   4. Look up by LOWER(email) → if found, link sso_sub (first SSO login of existing user)
 *   5. If no match → auto-provision new nf_users row (plan = 'free')
 *   6. Write audit log for sso_sub link events
 *
 * JWKS is cached at module scope so jose's internal cache is shared across
 * all requests in the same Node/Worker instance.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import { getDbAdapter } from './db-adapter';

const ISSUER = process.env.NEXYSYS_ISSUER ?? 'https://auth.nexysys.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

// Module-scope cache — do NOT move inside verifyNexysysToken
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

export interface SsoPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  scope?: string;
  client_id?: string;
}

/**
 * Verify a NexySys RS256 access token.
 * Returns the decoded payload or null (expired / invalid / unverified email).
 */
export async function verifyNexysysToken(token: string): Promise<SsoPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });

    if (!payload.sub || !payload.email) return null;

    // 🔴 SECURITY: reject unverified emails — prevents account takeover
    if (!payload.email_verified) {
      console.warn('[SSO] Rejected token with unverified email:', payload.email);
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email as string,
      email_verified: true,
      name: payload.name as string | undefined,
      scope: payload.scope as string | undefined,
      client_id: payload.client_id as string | undefined,
    };
  } catch {
    // JWTExpired, JWTInvalid, JWKSNoMatchingKey, etc.
    return null;
  }
}

/**
 * Resolve (or provision) a NexyFab user from a verified SSO payload.
 *
 * Returns the nf_users row (id, email, plan) or null on DB failure.
 */
export async function resolveOrProvisionUser(
  payload: SsoPayload,
): Promise<{ id: string; email: string; plan: string } | null> {
  const db = getDbAdapter();
  const emailLower = payload.email.trim().toLowerCase();

  // 1. Lookup by sso_sub (returning user via SSO)
  const bySub = await db.queryOne<{ id: string; email: string; plan: string }>(
    'SELECT id, email, plan FROM nf_users WHERE sso_sub = ?',
    payload.sub,
  ).catch(() => null);
  if (bySub) return bySub;

  // 2. Lookup by email (existing HMAC user — first SSO login)
  const byEmail = await db.queryOne<{ id: string; email: string; plan: string; sso_sub: string | null }>(
    'SELECT id, email, plan, sso_sub FROM nf_users WHERE LOWER(email) = ?',
    emailLower,
  ).catch(() => null);

  if (byEmail) {
    if (!byEmail.sso_sub) {
      // Link sso_sub for this existing account
      await db.execute(
        'UPDATE nf_users SET sso_sub = ? WHERE id = ?',
        payload.sub, byEmail.id,
      ).catch(() => {});

      // 🔵 Audit: SSO account link event
      await db.execute(
        `INSERT INTO nf_audit_log (id, user_id, action, metadata, created_at)
         VALUES (?, ?, 'account.sso_linked', ?, ?)`,
        crypto.randomUUID(),
        byEmail.id,
        JSON.stringify({ sso_sub: payload.sub, email: payload.email }),
        Date.now(),
      ).catch(() => {});
    }
    return { id: byEmail.id, email: byEmail.email, plan: byEmail.plan };
  }

  // 3. Auto-provision: brand-new user via SSO (no prior NexyFab account)
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.execute(
      `INSERT INTO nf_users (id, email, name, plan, sso_sub, created_at, updated_at)
       VALUES (?, ?, ?, 'free', ?, ?, ?)`,
      newId, emailLower, payload.name ?? null, payload.sub, now, now,
    );

    await db.execute(
      `INSERT INTO nf_audit_log (id, user_id, action, metadata, created_at)
       VALUES (?, ?, 'account.sso_provisioned', ?, ?)`,
      crypto.randomUUID(),
      newId,
      JSON.stringify({ sso_sub: payload.sub, email: payload.email }),
      Date.now(),
    ).catch(() => {});

    return { id: newId, email: emailLower, plan: 'free' };
  } catch (err) {
    console.error('[SSO] Auto-provision failed:', err);
    return null;
  }
}
