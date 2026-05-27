import { describe, it, expect } from 'vitest';
import { evalExpressionSafe, resolveDimensionTargetsWithErrors } from './constraintSolver';
import type { SketchDimension } from './types';

const dim = (id: string, name: string, value: number, expression?: string): SketchDimension => ({
  id,
  name,
  type: 'linear',
  entityIds: [],
  value,
  position: { x: 0, y: 0 },
  locked: false,
  expression,
});

describe('evalExpressionSafe', () => {
  const emptyCtx = { vars: new Map<string, number>() };

  it('evaluates plain arithmetic', () => {
    const r = evalExpressionSafe('2 + 3 * 4', emptyCtx);
    expect(r).toEqual({ ok: true, value: 14 });
  });

  it('resolves math constants', () => {
    const r = evalExpressionSafe('PI * 2', emptyCtx);
    expect(r.ok && Math.abs(r.value - Math.PI * 2) < 1e-9).toBe(true);
  });

  it('supports trig with DEG conversion', () => {
    const r = evalExpressionSafe('sin(30 * DEG)', emptyCtx);
    expect(r.ok && Math.abs(r.value - 0.5) < 1e-9).toBe(true);
  });

  it('resolves variables from context', () => {
    const ctx = { vars: new Map([['D1', 5], ['D2', 7]]) };
    const r = evalExpressionSafe('D1 + 2 * D2', ctx);
    expect(r).toEqual({ ok: true, value: 19 });
  });

  it('rejects unknown identifiers', () => {
    const r = evalExpressionSafe('Dx + 1', emptyCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.reason).toBe('unknown-identifier');
      expect(r.error.detail).toBe('Dx');
    }
  });

  it('rejects illegal characters', () => {
    const r = evalExpressionSafe('1; alert(1)', emptyCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('syntax');
  });

  it('flags non-finite (division by zero)', () => {
    const r = evalExpressionSafe('1 / 0', emptyCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('non-finite');
  });

  it('does not leak globals — `process` is an unknown id', () => {
    const r = evalExpressionSafe('process', emptyCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('unknown-identifier');
  });

  it('chains math functions', () => {
    const r = evalExpressionSafe('sqrt(abs(-16)) + min(3, 7)', emptyCtx);
    expect(r).toEqual({ ok: true, value: 7 });
  });
});

describe('resolveDimensionTargetsWithErrors', () => {
  it('resolves a chain D1 → D2 → D3 in topological order', () => {
    const dims = [
      dim('id3', 'D3', 0, 'D2 + 1'),
      dim('id1', 'D1', 5),
      dim('id2', 'D2', 0, 'D1 * 2'),
    ];
    const { targets, errors } = resolveDimensionTargetsWithErrors(dims);
    expect(targets.get('id1')).toBe(5);
    expect(targets.get('id2')).toBe(10);
    expect(targets.get('id3')).toBe(11);
    expect(errors.size).toBe(0);
  });

  it('detects a direct cycle (A→B→A) and reports cycle error', () => {
    const dims = [
      dim('a', 'A', 1, 'B + 1'),
      dim('b', 'B', 1, 'A + 1'),
    ];
    const { targets, errors } = resolveDimensionTargetsWithErrors(dims);
    // Cycle members keep their fallback value
    expect(targets.get('a')).toBe(1);
    expect(targets.get('b')).toBe(1);
    expect(errors.get('a')?.reason).toBe('cycle');
    expect(errors.get('b')?.reason).toBe('cycle');
  });

  it('isolates one broken expression without breaking peers', () => {
    const dims = [
      dim('id1', 'D1', 10),
      dim('idBad', 'DBad', 99, 'unknownVar + 1'),
      dim('id2', 'D2', 0, 'D1 * 3'),
    ];
    const { targets, errors } = resolveDimensionTargetsWithErrors(dims);
    expect(targets.get('id2')).toBe(30); // unaffected
    expect(targets.get('idBad')).toBe(99); // fallback to value
    expect(errors.get('idBad')?.reason).toBe('unknown-identifier');
  });

  it('mixes math functions and variables', () => {
    const dims = [
      dim('a', 'angle', 30),
      dim('r', 'radius', 100),
      dim('x', 'X', 0, 'cos(angle * DEG) * radius'),
    ];
    const { targets, errors } = resolveDimensionTargetsWithErrors(dims);
    expect(errors.size).toBe(0);
    const expected = Math.cos(30 * Math.PI / 180) * 100;
    expect(Math.abs(targets.get('x')! - expected) < 1e-9).toBe(true);
  });
});
