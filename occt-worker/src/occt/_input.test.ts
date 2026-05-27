/**
 * Shape input resolver tests. Real STEP import smoke (replicad
 * actually parses the bytes) belongs to W12 soak; here we cover
 * validation + per-user prefix gating.
 */

import { describe, it, expect } from 'vitest';
import { validateShapeInput } from './_input.js';

describe('validateShapeInput', () => {
  it('accepts host only', () => {
    expect(() => validateShapeInput(
      { host: { w: 10, h: 10, d: 10 } },
      'user-abc',
    )).not.toThrow();
  });

  it('accepts sourceR2Key only with matching prefix', () => {
    expect(() => validateShapeInput(
      { sourceR2Key: 'occt-ops/user-abc/boolean/123.step' },
      'user-abc',
    )).not.toThrow();
  });

  it('rejects when neither set', () => {
    expect(() => validateShapeInput({}, 'user-abc'))
      .toThrow(/exactly one of host or sourceR2Key/);
  });

  it('rejects when both set', () => {
    expect(() => validateShapeInput(
      { host: { w: 10, h: 10, d: 10 }, sourceR2Key: 'occt-ops/user-abc/x.step' },
      'user-abc',
    )).toThrow(/exactly one of host or sourceR2Key/);
  });

  it('rejects sourceR2Key for a different user', () => {
    expect(() => validateShapeInput(
      { sourceR2Key: 'occt-ops/other-user/boolean/123.step' },
      'user-abc',
    )).toThrow(/must start with occt-ops\/user-abc\//);
  });

  it('rejects sourceR2Key with path traversal', () => {
    expect(() => validateShapeInput(
      { sourceR2Key: 'occt-ops/user-abc/../other/secret.step' },
      'user-abc',
    )).toThrow(/illegal path components/);
  });

  it('rejects sourceR2Key with leading slash', () => {
    expect(() => validateShapeInput(
      { sourceR2Key: '/occt-ops/user-abc/x.step' },
      'user-abc',
    )).toThrow(/illegal path components/);
  });

  it('rejects oversize sourceR2Key', () => {
    const big = 'occt-ops/user-abc/' + 'x'.repeat(600);
    expect(() => validateShapeInput({ sourceR2Key: big }, 'user-abc'))
      .toThrow(/≤ 512 chars/);
  });

  it('rejects empty sourceR2Key', () => {
    // Empty string is defined → passes the XOR check, then length
    // guard catches it.
    expect(() => validateShapeInput({ sourceR2Key: '' }, 'user-abc'))
      .toThrow(/≤ 512 chars/);
  });
});
