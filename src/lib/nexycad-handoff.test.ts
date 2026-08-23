import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildNexyCadLaunchUrl, NEXYCAD_HANDOFF_SCHEMA, signNexyCadProjectHandoff } from './nexycad-handoff';

describe('NEXYCAD project handoff issuer', () => {
  it('issues a minimal Ed25519 project token with a maximum 60 second lifetime', () => {
    const keys = generateKeyPairSync('ed25519');
    const issued = signNexyCadProjectHandoff({
      issuer: 'https://nexyfab.com', audience: 'nexycad-commercial', subject: 'user-1', organizationId: 'org-1',
      projectId: 'project-1', projectRole: 'EDITOR', keyId: 'nf-2026-08', privateKey: keys.privateKey,
      handoffId: 'handoff-1', nowEpochSeconds: 1_787_011_200,
    });
    const [header, payload, signature] = issued.token.split('.') as [string, string, string];
    expect(verify(null, Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(claims).toEqual({
      schema: NEXYCAD_HANDOFF_SCHEMA, iss: 'https://nexyfab.com', aud: 'nexycad-commercial', sub: 'user-1', jti: 'handoff-1',
      organization_id: 'org-1', project_id: 'project-1', project_role: 'EDITOR',
      iat: 1_787_011_200, nbf: 1_787_011_200, exp: 1_787_011_260,
    });
    expect(JSON.stringify(claims)).not.toMatch(/email|name|plan|token|cookie/i);
    expect(() => signNexyCadProjectHandoff({
      issuer: 'https://nexyfab.com', audience: 'nexycad-commercial', subject: 'user-1', organizationId: null,
      projectId: 'project-1', projectRole: 'VIEWER', keyId: 'key', privateKey: keys.privateKey, lifetimeSeconds: 61,
    })).toThrow('nexycad_handoff_lifetime_invalid');
  });

  it('keeps the token in a fragment and requires HTTPS outside local development', () => {
    expect(buildNexyCadLaunchUrl('https://cad-preview.nexyfab.com/', 'a.b.c', true)).toBe('https://cad-preview.nexyfab.com/#handoff=a.b.c');
    expect(() => buildNexyCadLaunchUrl('http://cad-preview.nexyfab.com/', 'a.b.c', true)).toThrow('nexycad_studio_url_invalid');
    expect(buildNexyCadLaunchUrl('http://localhost:8080/', 'a.b.c', false)).toBe('http://localhost:8080/#handoff=a.b.c');
  });
});
