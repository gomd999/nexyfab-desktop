import { describe, expect, it } from 'vitest';
import {
  FEA_DEFAULT_MEMORY_MB,
  FEA_MAX_DOF,
  isTerminalFeaStatus,
  publicFeaJob,
  type SerializedFeaJob,
  validateFeaJobRequest,
} from './contracts';

function binaryStlBase64(triangles = 1): string {
  const out = Buffer.alloc(84 + triangles * 50);
  out.writeUInt32LE(triangles, 80);
  return out.toString('base64');
}

describe('FEA async job contract', () => {
  it('normalizes a bounded precision STL request', () => {
    const out = validateFeaJobRequest({
      source: { kind: 'stl', dataBase64: binaryStlBase64() },
      materialKey: 'steel', loadN: 9810, precise: true,
    });
    expect(out).toEqual(expect.objectContaining({ ok: true }));
    if (!out.ok) return;
    expect(out.request.limits).toEqual({ maxDof: FEA_MAX_DOF, timeoutMs: 180_000, memoryMb: FEA_DEFAULT_MEMORY_MB });
  });

  it('rejects malformed binary STL instead of accepting arbitrary base64', () => {
    expect(validateFeaJobRequest({
      source: { kind: 'stl', dataBase64: Buffer.from('not an stl').toString('base64') }, loadN: 10,
    })).toMatchObject({ ok: false, code: 'INVALID_STL' });
  });

  it('blocks SCAD external file access but permits parametric primitives', () => {
    expect(validateFeaJobRequest({ source: { kind: 'scad', source: 'import("secret.stl"); cube([1,2,3]);' }, loadN: 10 }))
      .toMatchObject({ ok: false, code: 'SCAD_EXTERNAL_ACCESS_BLOCKED' });
    expect(validateFeaJobRequest({ source: { kind: 'scad', source: 'difference(){cube([10,10,2]); cylinder(h=2,d=3);}' }, loadN: 10 }))
      .toMatchObject({ ok: true });
  });

  it('enforces load, DOF and timeout ceilings', () => {
    const source = { kind: 'stl', dataBase64: binaryStlBase64() };
    expect(validateFeaJobRequest({ source, loadN: 0 })).toMatchObject({ ok: false, code: 'LOAD_LIMIT' });
    expect(validateFeaJobRequest({ source, loadN: 10, limits: { maxDof: FEA_MAX_DOF + 1 } }))
      .toMatchObject({ ok: false, code: 'DOF_LIMIT_INVALID' });
    expect(validateFeaJobRequest({ source, loadN: 10, limits: { timeoutMs: 300_001 } }))
      .toMatchObject({ ok: false, code: 'TIMEOUT_LIMIT_INVALID' });
  });

  it('never exposes owner, request payload, hashes, or worker lease', () => {
    const job: SerializedFeaJob = {
      id: 'fea-0123456789abcdef01234567', ownerUserId: 'secret-user', scopeId: 'user:secret-user',
      status: 'processing', progress: { percent: 20, stage: 'solving' }, createdAt: 1, updatedAt: 2,
      attempts: 1, maxAttempts: 3, requestHash: 'request-hash', idempotencyHash: 'idem-hash',
      leaseToken: 'secret-lease', request: {
        source: { kind: 'scad', source: 'cube([1,1,1]);' }, materialKey: 'steel', loadN: 1,
        loadNote: 'test', precise: true, limits: { maxDof: 90_000, timeoutMs: 180_000, memoryMb: 1024 },
      },
    };
    expect(publicFeaJob(job)).not.toHaveProperty('ownerUserId');
    expect(publicFeaJob(job)).not.toHaveProperty('request');
    expect(publicFeaJob(job)).not.toHaveProperty('requestHash');
    expect(publicFeaJob(job)).not.toHaveProperty('idempotencyHash');
    expect(publicFeaJob(job)).not.toHaveProperty('leaseToken');
    expect(publicFeaJob(job)).not.toHaveProperty('leaseExpiresAt');
    expect(publicFeaJob(job)).not.toHaveProperty('heartbeatAt');
  });

  it('recognizes only final states as terminal', () => {
    expect(isTerminalFeaStatus('complete')).toBe(true);
    expect(isTerminalFeaStatus('failed')).toBe(true);
    expect(isTerminalFeaStatus('cancelled')).toBe(true);
    expect(isTerminalFeaStatus('cancel_requested')).toBe(false);
    expect(isTerminalFeaStatus('retrying')).toBe(false);
  });
});
