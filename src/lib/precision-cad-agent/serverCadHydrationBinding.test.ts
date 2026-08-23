import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  issueServerCadHydrationBinding,
  validateServerCadHydrationBinding,
  verifyServerCadHydrationBinding,
} from './serverCadHydrationBinding';

const secret = 'server-cad-hydration-binding-secret-0123456789';
const mapping = {
  projectId: 'project-1',
  workspaceId: 'project-1',
  revision: 7,
  workspaceContentHash: 'a'.repeat(64),
  geometryContentHash: 'b'.repeat(64),
  shapeIdentityHash: 'c'.repeat(64),
  sourceRecordId: 'source-record-1',
} as const;

beforeEach(() => { process.env.NEXYFAB_CAD_WORKER_BINDING_SECRET = secret; });
afterEach(() => { delete process.env.NEXYFAB_CAD_WORKER_BINDING_SECRET; });

describe('server CAD hydration binding', () => {
  it('signs only the canonical CAS key and verifies user, expiry, and tamper binding', () => {
    const binding = issueServerCadHydrationBinding({ userId: 'user-1', mapping, now: 1_700_000_000_000 });
    expect(binding).toMatchObject({ schema: 'nexyfab.precision-cad-worker-hydration.v1', projectId: 'project-1', sourceRecordId: 'source-record-1' });
    expect(binding).not.toHaveProperty('parts');
    expect(binding).not.toHaveProperty('artifactId');
    expect(binding).not.toHaveProperty('runtimeHandle');
    expect(verifyServerCadHydrationBinding({ binding, userId: 'user-1', now: 1_700_000_001_000 })).toBe(true);
    expect(verifyServerCadHydrationBinding({ binding, userId: 'user-2', now: 1_700_000_001_000 })).toBe(false);
    expect(verifyServerCadHydrationBinding({ binding: { ...binding!, revision: 8 }, userId: 'user-1', now: 1_700_000_001_000 })).toBe(false);
    expect(verifyServerCadHydrationBinding({ binding, userId: 'user-1', now: binding!.expiresAt })).toBe(false);
  });

  it('rejects unknown keys and missing signing secret', () => {
    const binding = issueServerCadHydrationBinding({ userId: 'user-1', mapping, now: 1_700_000_000_000 });
    expect(validateServerCadHydrationBinding({ ...binding, runtimeHandle: 'occt:forged' })).toContain('binding_keys_invalid');
    const fallbackKeys = ['SCAD_AGENT_SESSION_SECRET', 'JWT_SECRET', 'NEXYFAB_SERVER_SECRET'] as const;
    const previous = Object.fromEntries(fallbackKeys.map(key => [key, process.env[key]]));
    for (const key of fallbackKeys) delete process.env[key];
    delete process.env.NEXYFAB_CAD_WORKER_BINDING_SECRET;
    expect(issueServerCadHydrationBinding({ userId: 'user-1', mapping, now: 1_700_000_000_000 })).toBeNull();
    for (const key of fallbackKeys) if (previous[key] !== undefined) process.env[key] = previous[key];
  });
});
