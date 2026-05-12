import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPromptVariant,
  _parseRolloutsForTests,
  _hashForTests,
} from '../index';

const ENV_KEY = 'AI_PROMPT_VARIANTS';

describe('A/B variant selection', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[ENV_KEY]; delete process.env[ENV_KEY]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  // ─── parser ─────────────────────────────────────────────────────────────

  it('parses empty / undefined as no rollouts', () => {
    expect(_parseRolloutsForTests(undefined)).toEqual([]);
    expect(_parseRolloutsForTests('')).toEqual([]);
  });

  it('parses well-formed config', () => {
    const r = _parseRolloutsForTests('scad-intent-from-nl:tighter@0.5');
    expect(r).toHaveLength(1);
    expect(r[0].baseId).toBe('scad-intent-from-nl');
    expect(r[0].variantId).toBe('scad-intent-from-nl:tighter');
    expect(r[0].fraction).toBe(0.5);
  });

  it('clamps fraction to [0,1]', () => {
    expect(_parseRolloutsForTests('scad-intent-from-nl:tighter@1.5')[0].fraction).toBe(1);
    expect(_parseRolloutsForTests('scad-intent-from-nl:tighter@-0.2')[0].fraction).toBe(0);
  });

  it('drops malformed entries', () => {
    expect(_parseRolloutsForTests('not-a-config')).toEqual([]);
    expect(_parseRolloutsForTests('does-not-exist:variant@0.5')).toEqual([]);
    expect(_parseRolloutsForTests('shape-chat:nonexistent-variant@0.5')).toEqual([]);
  });

  // ─── selection ──────────────────────────────────────────────────────────

  it('returns default when no rollout configured', () => {
    const p = getPromptVariant('scad-intent-from-nl', 'user-1');
    expect(p.id).toBe('scad-intent-from-nl');
  });

  it('returns default when stableKey is missing (no anonymous A/B)', () => {
    process.env[ENV_KEY] = 'scad-intent-from-nl:tighter@1.0';
    const p = getPromptVariant('scad-intent-from-nl');
    expect(p.id).toBe('scad-intent-from-nl');
  });

  it('routes 100% rollout to variant for any user', () => {
    process.env[ENV_KEY] = 'scad-intent-from-nl:tighter@1.0';
    expect(getPromptVariant('scad-intent-from-nl', 'user-a').id).toBe('scad-intent-from-nl:tighter');
    expect(getPromptVariant('scad-intent-from-nl', 'user-b').id).toBe('scad-intent-from-nl:tighter');
  });

  it('routes 0% rollout to default for any user', () => {
    process.env[ENV_KEY] = 'scad-intent-from-nl:tighter@0.0';
    expect(getPromptVariant('scad-intent-from-nl', 'user-a').id).toBe('scad-intent-from-nl');
  });

  it('same user always lands in same bucket (deterministic)', () => {
    process.env[ENV_KEY] = 'scad-intent-from-nl:tighter@0.5';
    const a = getPromptVariant('scad-intent-from-nl', 'user-x').id;
    const b = getPromptVariant('scad-intent-from-nl', 'user-x').id;
    const c = getPromptVariant('scad-intent-from-nl', 'user-x').id;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('rollout distribution roughly matches fraction over many users', () => {
    process.env[ENV_KEY] = 'scad-intent-from-nl:tighter@0.3';
    let variantHits = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (getPromptVariant('scad-intent-from-nl', `user-${i}`).id.endsWith(':tighter')) variantHits++;
    }
    // Allow ±0.1 tolerance for hash distribution noise on this sample size.
    const ratio = variantHits / N;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.4);
  });

  it('hash is stable across calls and non-trivial', () => {
    expect(_hashForTests('user-x')).toBe(_hashForTests('user-x'));
    expect(_hashForTests('user-x')).not.toBe(_hashForTests('user-y'));
  });
});
