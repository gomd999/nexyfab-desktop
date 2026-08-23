import { afterEach, describe, expect, it } from 'vitest';
import { issueBrepHandleAccessToken, verifyBrepHandleAccessToken } from './brepHandleAccessToken';

const secret = 'handle-capability-test-secret-0123456789';

afterEach(() => { delete process.env.SCAD_AGENT_HANDLE_TOKEN_SECRET; });

describe('SCAD BRep handle capabilities', () => {
  it('binds a short-lived token to the authenticated user and exact process handle', () => {
    process.env.SCAD_AGENT_HANDLE_TOKEN_SECRET = secret;
    const token = issueBrepHandleAccessToken({ userId: 'user-a', handle: 'occt:7', nowMs: 1_000 });
    expect(token).toBeTruthy();
    expect(verifyBrepHandleAccessToken({ token, userId: 'user-a', handle: 'occt:7', nowMs: 1_001 })).toBe(true);
    expect(verifyBrepHandleAccessToken({ token, userId: 'user-b', handle: 'occt:7', nowMs: 1_001 })).toBe(false);
    expect(verifyBrepHandleAccessToken({ token, userId: 'user-a', handle: 'occt:8', nowMs: 1_001 })).toBe(false);
  });

  it('expires and fails closed when the server secret is absent', () => {
    process.env.SCAD_AGENT_HANDLE_TOKEN_SECRET = secret;
    const token = issueBrepHandleAccessToken({ userId: 'user-a', handle: 'occt:7', nowMs: 1_000, ttlMs: 10 });
    expect(verifyBrepHandleAccessToken({ token, userId: 'user-a', handle: 'occt:7', nowMs: 1_010 })).toBe(false);
    delete process.env.SCAD_AGENT_HANDLE_TOKEN_SECRET;
    expect(verifyBrepHandleAccessToken({ token, userId: 'user-a', handle: 'occt:7', nowMs: 1_001 })).toBe(false);
  });
});

