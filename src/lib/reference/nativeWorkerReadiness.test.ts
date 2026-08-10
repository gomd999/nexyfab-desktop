import { describe, expect, it } from 'vitest';
import { evaluateNativeWorkerReadiness } from './nativeWorkerReadiness';

const now = 2_000_000;
const env = { NEXYFAB_SOLIDWORKS_WORKER_COMMAND: 'worker.exe' };

describe('native worker operational readiness', () => {
  it('does not treat a configured command as a ready worker', () => {
    const result = evaluateNativeWorkerReadiness(env, null, null, { nowMs: now });
    expect(result.workers.find((item) => item.workerKind === 'solidworks-native')).toMatchObject({
      configured: true, status: 'configured_unprobed', batchEligible: false,
    });
    expect(result.releaseReady).toBe(false);
  });

  it('requires fresh health and then a fresh accepted canary', () => {
    const health = { observedAtMs: now - 1000, results: [{ workerKind: 'solidworks-native' as const, status: 'pass' as const, validated: true }] };
    expect(evaluateNativeWorkerReadiness(env, health, null, { nowMs: now }).workers[0]).toMatchObject({ status: 'ready_for_canary', batchEligible: false });
    const canary = { observedAtMs: now - 500, validUntilMs: now + 1000, manifestSha256: 'a'.repeat(64), gates: [{ workerKind: 'solidworks-native' as const, status: 'pass' as const, workerIdentitySha256: 'b'.repeat(64) }] };
    expect(evaluateNativeWorkerReadiness(env, health, canary, { nowMs: now }).workers[0]).toMatchObject({ status: 'canary_passed', batchEligible: true });
  });

  it('fails closed when health evidence is stale', () => {
    const health = { observedAtMs: now - 86_400_001, results: [{ workerKind: 'solidworks-native' as const, status: 'pass' as const, validated: true }] };
    expect(evaluateNativeWorkerReadiness(env, health, null, { nowMs: now }).workers[0]).toMatchObject({ status: 'health_stale', batchEligible: false });
  });

  it('rejects expired canary health and missing worker identity binding', () => {
    const health = { observedAtMs: now - 1000, results: [{ workerKind: 'solidworks-native' as const, status: 'pass' as const, validated: true }] };
    const expired = { observedAtMs: now - 500, validUntilMs: now - 1, manifestSha256: 'a'.repeat(64), gates: [{ workerKind: 'solidworks-native' as const, status: 'pass' as const, workerIdentitySha256: 'b'.repeat(64) }] };
    const expiredResult = evaluateNativeWorkerReadiness(env, health, expired, { nowMs: now });
    expect(expiredResult.workers[0]).toMatchObject({ status: 'ready_for_canary', batchEligible: false, canaryStatus: 'blocked_health' });
    expect(expiredResult.evidenceStatus.canary).toBe('expired');
    const unbound = { ...expired, validUntilMs: now + 1000, gates: [{ ...expired.gates[0]!, workerIdentitySha256: null }] };
    expect(evaluateNativeWorkerReadiness(env, health, unbound, { nowMs: now }).workers[0]).toMatchObject({ status: 'ready_for_canary', batchEligible: false, canaryStatus: 'blocked_health' });
  });

  it('does not trust an unvalidated health pass label', () => {
    const health = { observedAtMs: now - 1000, results: [{ workerKind: 'solidworks-native' as const, status: 'pass' as const, validated: false }] };
    expect(evaluateNativeWorkerReadiness(env, health, null, { nowMs: now }).workers[0]).toMatchObject({ status: 'health_failed', batchEligible: false });
  });

  it('fails closed on duplicate evidence rows for one worker', () => {
    const row = { workerKind: 'solidworks-native' as const, status: 'pass' as const, validated: true };
    const health = { observedAtMs: now - 1000, results: [row, row] };
    expect(evaluateNativeWorkerReadiness(env, health, null, { nowMs: now }).workers[0]).toMatchObject({ status: 'health_failed', batchEligible: false });
  });
});
