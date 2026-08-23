import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  access: null as null | { role: 'owner'; canEdit: true },
  existing: null as null | Record<string, unknown>,
  executed: [] as Array<{ sql: string; args: unknown[] }>,
}));

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => ({ userId: 'u-owner', email: 'e2e-owner@example.com' })),
}));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/nfProjectAccess', () => ({
  resolveProjectAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    execute: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.executed.push({ sql, args });
      return { changes: 1 };
    }),
    queryOne: vi.fn(async () => state.existing),
    queryAll: vi.fn(async () => []),
  })),
}));

import { GET, POST } from './route';

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/nexyfab/collab', {
    method: 'POST',
    body,
    headers: { origin: 'http://localhost', 'content-type': 'application/json', ...headers },
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

beforeEach(() => {
  state.access = null;
  state.existing = null;
  state.executed = [];
});

describe('collaboration project boundary', () => {
  it('hides presence from an authenticated non-member', async () => {
    const response = await GET(new NextRequest('http://localhost/api/nexyfab/collab?projectId=private'));
    expect(response.status).toBe(404);
  });

  it('rejects a non-member join before session mutation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/nexyfab/collab', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'private', sessionId: 'session-a', action: 'join' }),
    }));
    expect(response.status).toBe(404);
    expect(state.executed).toHaveLength(0);
  });

  it('scopes leave deletion to project and authenticated user', async () => {
    state.access = { role: 'owner', canEdit: true };
    const response = await POST(new NextRequest('http://localhost/api/nexyfab/collab', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', sessionId: 'session-a', action: 'leave' }),
    }));
    expect(response.status).toBe(200);
    const deletion = state.executed.find(item => item.sql.includes('DELETE FROM nf_collab_sessions WHERE session_id'));
    expect(deletion?.sql).toContain('AND user_id = ?');
    expect(deletion?.args).toEqual(['session-a', 'project-a', 'u-owner']);
  });

  it('does not allow a member to refresh another user session id', async () => {
    state.access = { role: 'owner', canEdit: true };
    state.existing = { project_id: 'project-a', user_id: 'u-other' };
    const response = await POST(new NextRequest('http://localhost/api/nexyfab/collab', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', sessionId: 'collision', action: 'ping' }),
    }));
    expect(response.status).toBe(404);
  });

  it('rejects a declared oversized body and cancels before database access', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const response = await POST(streamedRequest(stream, { 'content-length': '65537' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(state.executed).toHaveLength(0);
  });

  it('does not trust a false-small Content-Length and cancels actual overflow', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(state.executed).toHaveLength(0);
  });

  it('preserves the malformed-body contract for invalid UTF-8', async () => {
    const response = await POST(new NextRequest('http://localhost/api/nexyfab/collab', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: new Uint8Array([0xff]),
    }));
    expect(response.status).toBe(400);
    expect(state.executed).toHaveLength(0);
  });
});
