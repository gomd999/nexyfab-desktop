import { createPrivateKey, randomUUID, sign, type KeyLike } from 'node:crypto';

export const NEXYCAD_HANDOFF_SCHEMA = 'nexysys.nexycad-handoff.v1' as const;
export type NexyCadProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface NexyCadHandoffInput {
  issuer: string;
  audience: string;
  subject: string;
  organizationId: string | null;
  projectId: string;
  projectRole: NexyCadProjectRole;
  keyId: string;
  privateKey: KeyLike;
  nowEpochSeconds?: number;
  lifetimeSeconds?: number;
  handoffId?: string;
}

function bounded(value: string, name: string, maximum = 256): string {
  if (value.length < 1 || value.length > maximum || value.trim() !== value) throw new Error(`nexycad_handoff_invalid:${name}`);
  return value;
}

function base64url(value: Uint8Array | string): string {
  return Buffer.from(value).toString('base64url');
}

export function loadNexyCadHandoffPrivateKey(encodedPem: string): KeyLike {
  if (encodedPem.length < 64 || encodedPem.length > 16_384) throw new Error('nexycad_handoff_private_key_invalid');
  return createPrivateKey(Buffer.from(encodedPem, 'base64').toString('utf8'));
}

export function signNexyCadProjectHandoff(input: NexyCadHandoffInput): { token: string; expiresAt: string } {
  const lifetimeSeconds = input.lifetimeSeconds ?? 60;
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 60) throw new Error('nexycad_handoff_lifetime_invalid');
  if (!['OWNER', 'EDITOR', 'VIEWER'].includes(input.projectRole)) throw new Error('nexycad_handoff_role_invalid');
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now)) throw new Error('nexycad_handoff_time_invalid');
  const expiresAt = now + lifetimeSeconds;
  const header = base64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: bounded(input.keyId, 'kid', 128) }));
  const payload = base64url(JSON.stringify({
    schema: NEXYCAD_HANDOFF_SCHEMA,
    iss: bounded(input.issuer, 'issuer', 512),
    aud: bounded(input.audience, 'audience'),
    sub: bounded(input.subject, 'subject'),
    jti: bounded(input.handoffId ?? randomUUID(), 'handoff_id'),
    organization_id: input.organizationId === null ? null : bounded(input.organizationId, 'organization_id'),
    project_id: bounded(input.projectId, 'project_id'),
    project_role: input.projectRole,
    iat: now,
    nbf: now,
    exp: expiresAt,
  }));
  const signature = sign(null, Buffer.from(`${header}.${payload}`), input.privateKey);
  return { token: `${header}.${payload}.${base64url(signature)}`, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export function buildNexyCadLaunchUrl(studioUrl: string, token: string, production = process.env.NODE_ENV === 'production'): string {
  const target = new URL(studioUrl);
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (target.username || target.password || target.search || target.hash || (target.protocol !== 'https:' && (production || !localDevelopment))) {
    throw new Error('nexycad_studio_url_invalid');
  }
  target.hash = new URLSearchParams({ handoff: token }).toString();
  return target.toString();
}
