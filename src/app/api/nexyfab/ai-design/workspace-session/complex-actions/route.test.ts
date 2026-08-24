import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1' } as { userId: string } | null,
  origin: true,
  allowed: true,
  access: { canEdit: true } as { canEdit: boolean } | null,
  execute: vi.fn(async () => ({ ok: true, aggregate: { complexRevision: 1 }, replayed: false, createdArtifactIds: ['request-1'] })),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => mocks.origin) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: mocks.allowed })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/ai/aiDesignComplexWorkspaceService', () => ({ executeAiDesignComplexWorkspaceCommand: mocks.execute }));

import { POST } from './route';

const url = 'http://localhost/api/nexyfab/ai-design/workspace-session/complex-actions';
const base = {
  schema: 'nexyfab.ai-design-workspace-command.v3', commandId: 'command-1', projectId: 'project-1', sessionId: 'session-1',
  expectedRuntimeRevision: 0, expectedComplexRevision: 0, issuedAt: '2026-08-24T10:00:00.000Z',
};
const post = (body: unknown) => new NextRequest(url, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  mocks.auth = { userId: 'user-1' }; mocks.origin = true; mocks.allowed = true; mocks.access = { canEdit: true }; mocks.execute.mockClear();
});

describe('AI Design complex action route', () => {
  it('enforces origin, authentication, rate limits and editor access', async () => {
    mocks.origin = false; expect((await POST(post({}))).status).toBe(403);
    mocks.origin = true; mocks.auth = null; expect((await POST(post({}))).status).toBe(401);
    mocks.auth = { userId: 'user-1' }; mocks.allowed = false; expect((await POST(post({}))).status).toBe(429);
    mocks.allowed = true; mocks.access = { canEdit: false };
    const response = await POST(post({ ...base, type: 'REQUEST_PRECISION_VERIFICATION', payload: { structureNodeIds: ['part-a'], interfaceIds: [], partitionIds: [], gaugeIds: [] } }));
    expect(response.status).toBe(403);
  });

  it('passes only parsed V3 user requests to the authoritative service', async () => {
    const response = await POST(post({ ...base, type: 'REQUEST_PRECISION_VERIFICATION', payload: { structureNodeIds: ['part-a'], interfaceIds: [], partitionIds: [], gaugeIds: [] } }));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith('user-1:project-1', expect.objectContaining({ type: 'REQUEST_PRECISION_VERIFICATION' }), expect.any(Object));
  });

  it('rejects server-only receipt commands from the browser', async () => {
    const response = await POST(post({ ...base, type: 'RECORD_PRECISION_RECEIPT', payload: { receiptId: 'receipt-1', receiptDigest: 'a'.repeat(64) } }));
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
