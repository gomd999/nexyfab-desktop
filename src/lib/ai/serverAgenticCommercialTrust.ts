import { createPublicKey, createHash } from 'node:crypto';
import type { AgenticCommercialQualificationVerificationContext, AgenticTrustedIdentity } from './agenticCommercialQualificationReceipt';

const FINGERPRINT = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROLE_SET = new Set(['agent', 'native_parser', 'independent_verifier']);
const EXACT_KEYS = new Set(['identityId', 'role', 'publicKeyPem', 'fingerprintSha256']);
const MAX_REGISTRY_BYTES = 64 * 1024;
const MAX_PEM_BYTES = 8 * 1024;

function fingerprint(publicKeyPem: string): string | undefined {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return undefined;
    return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
  } catch { return undefined; }
}

export type ServerAgenticTrustStatus = { ok: true; context: AgenticCommercialQualificationVerificationContext; identities: readonly AgenticTrustedIdentity[] } | { ok: false; issues: readonly string[] };

/** Loads the server-only registry. Request bodies never participate in trust, clock, or mode selection. */
export function loadServerAgenticCommercialTrust(): ServerAgenticTrustStatus {
  const issues: string[] = [];
  const now = new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) issues.push('server_clock_invalid');
  let parsed: unknown;
  const raw = process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON ?? '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_REGISTRY_BYTES) issues.push('server_registry_size_exceeded');
  else try { parsed = JSON.parse(raw); } catch { issues.push('server_registry_missing_or_malformed'); }
  if (!Array.isArray(parsed) || parsed.length !== 3) issues.push('server_registry_must_contain_exactly_three_identities');
  const identities: AgenticTrustedIdentity[] = [];
  const ids = new Set<string>(), keys = new Set<string>();
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const identity = item as Partial<AgenticTrustedIdentity>;
    const itemKeys = item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item as Record<string, unknown>) : [];
    const publicKeyPem = typeof identity.publicKeyPem === 'string' ? identity.publicKeyPem : '';
    const derived = publicKeyPem && Buffer.byteLength(publicKeyPem, 'utf8') <= MAX_PEM_BYTES ? fingerprint(publicKeyPem) : undefined;
    if (itemKeys.length !== EXACT_KEYS.size || itemKeys.some(key => !EXACT_KEYS.has(key)) || !SAFE_ID.test(identity.identityId ?? '') || !ROLE_SET.has(identity.role ?? '') || !FINGERPRINT.test(identity.fingerprintSha256 ?? '') || derived !== identity.fingerprintSha256 || ids.has(identity.identityId!) || keys.has(identity.fingerprintSha256 ?? '')) issues.push('server_registry_identity_or_fingerprint_invalid');
    else { ids.add(identity.identityId!); keys.add(identity.fingerprintSha256!); identities.push({ identityId: identity.identityId!, role: identity.role!, publicKeyPem, fingerprintSha256: identity.fingerprintSha256! } as AgenticTrustedIdentity); }
  }
  const roles = new Set(identities.map(item => item.role));
  if (roles.size !== 3) issues.push('server_registry_roles_must_be_unique');
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };
  return { ok: true, identities, context: { trustedRegistry: identities, now, mode: 'runtime' } };
}

export function serverAgenticCommercialMode(): 'runtime' { return 'runtime'; }
