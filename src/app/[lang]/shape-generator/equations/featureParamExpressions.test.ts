import { describe, it, expect } from 'vitest';
import {
  parseParamInput,
  evaluateParamExpression,
  paramScopeFor,
  reevaluateFeatureParamExpressions,
  reevaluateFeatureParamExpressionsFixedPoint,
  type ExpressionParamNode,
} from './featureParamExpressions';

describe('parseParamInput', () => {
  it('classifies a plain number', () => {
    expect(parseParamInput('12.5')).toEqual({ kind: 'number', value: 12.5 });
    expect(parseParamInput('-3')).toEqual({ kind: 'number', value: -3 });
  });

  it('strips the SolidWorks-style leading "="', () => {
    expect(parseParamInput('=W/2')).toEqual({ kind: 'expression', expression: 'W/2' });
    expect(parseParamInput('= height * 2')).toEqual({ kind: 'expression', expression: 'height * 2' });
  });

  it('"=5" is just the number 5 (assigning a constant clears the expression)', () => {
    expect(parseParamInput('=5')).toEqual({ kind: 'number', value: 5 });
  });

  it('bare formulas without "=" also count as expressions', () => {
    expect(parseParamInput('W/2')).toEqual({ kind: 'expression', expression: 'W/2' });
  });

  it('empty / whitespace / lone "=" → empty', () => {
    expect(parseParamInput('')).toEqual({ kind: 'empty' });
    expect(parseParamInput('   ')).toEqual({ kind: 'empty' });
    expect(parseParamInput('=')).toEqual({ kind: 'empty' });
  });
});

describe('evaluateParamExpression', () => {
  const scope = [{ name: 'W', value: 80 }, { name: 'height', value: 30 }];

  it('evaluates against the scope', () => {
    expect(evaluateParamExpression('W/2', scope)).toEqual({ ok: true, value: 40 });
    expect(evaluateParamExpression('height * 2 + 1', scope)).toEqual({ ok: true, value: 61 });
  });

  it('reports missing variables explicitly (no silent NaN)', () => {
    const r = evaluateParamExpression('W / depth', scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(['depth']);
  });

  it('reports parse errors', () => {
    const r = evaluateParamExpression('W +* 2', scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual([]);
  });

  it('rejects non-finite results (division by zero)', () => {
    const r = evaluateParamExpression('W / 0', scope);
    expect(r.ok).toBe(false);
  });
});

describe('paramScopeFor', () => {
  it('appends sibling params after the shared scope so siblings shadow', () => {
    const node = { params: { radius: 5, count: 4 } };
    const merged = paramScopeFor(node, 'radius', [{ name: 'count', value: 99 }]);
    // sibling `count` (4) comes after scope `count` (99) — later wins in the parser
    expect(merged[merged.length - 1]).toEqual({ name: 'count', value: 4 });
    // the driven key itself is excluded (no trivial self-reference)
    expect(merged.some(v => v.name === 'radius')).toBe(false);
  });

  it('evaluating with sibling shadowing resolves to the sibling value', () => {
    const node = { params: { radius: 5, count: 4 } };
    const merged = paramScopeFor(node, 'radius', [{ name: 'count', value: 99 }]);
    expect(evaluateParamExpression('count * 2', merged)).toEqual({ ok: true, value: 8 });
  });
});

describe('reevaluateFeatureParamExpressions', () => {
  const scope = [{ name: 'W', value: 80 }];

  it('returns updates only for params whose value actually changed', () => {
    const nodes: ExpressionParamNode[] = [
      { id: 'f1', params: { radius: 10 }, paramExpressions: { radius: 'W/2' } },
      { id: 'f2', params: { depth: 40 }, paramExpressions: { depth: 'W/2' } }, // already in sync
      { id: 'f3', params: { angle: 15 } }, // no expressions
    ];
    const r = reevaluateFeatureParamExpressions(nodes, scope);
    expect(r.updates).toEqual([{ featureId: 'f1', key: 'radius', value: 40 }]);
    expect(r.errors).toEqual([]);
  });

  it('variable deleted → param keeps last value + error reported (no NaN write)', () => {
    const nodes: ExpressionParamNode[] = [
      { id: 'f1', params: { radius: 40 }, paramExpressions: { radius: 'W/2' } },
    ];
    // `W` was deleted from the global table:
    const r = reevaluateFeatureParamExpressions(nodes, []);
    expect(r.updates).toEqual([]); // last value 40 is preserved
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ featureId: 'f1', key: 'radius', expression: 'W/2', missing: ['W'] });
  });

  it('variable renamed → old name reported missing; the new name is not auto-rewritten', () => {
    const nodes: ExpressionParamNode[] = [
      { id: 'f1', params: { radius: 40 }, paramExpressions: { radius: 'W/2' } },
    ];
    // user renamed W → width
    const r = reevaluateFeatureParamExpressions(nodes, [{ name: 'width', value: 80 }]);
    expect(r.updates).toEqual([]);
    expect(r.errors[0].missing).toEqual(['W']);
  });

  it('variable edit cascades into multiple features in one pass', () => {
    const nodes: ExpressionParamNode[] = [
      { id: 'f1', params: { radius: 40 }, paramExpressions: { radius: 'W/2' } },
      { id: 'f2', params: { depth: 160 }, paramExpressions: { depth: 'W*2' } },
    ];
    const r = reevaluateFeatureParamExpressions(nodes, [{ name: 'W', value: 100 }]);
    expect(r.updates).toEqual([
      { featureId: 'f1', key: 'radius', value: 50 },
      { featureId: 'f2', key: 'depth', value: 200 },
    ]);
  });

  it('sibling param references re-evaluate too', () => {
    const nodes: ExpressionParamNode[] = [
      { id: 'f1', params: { radius: 10, count: 6 }, paramExpressions: { radius: 'count * 2' } },
    ];
    const r = reevaluateFeatureParamExpressions(nodes, []);
    expect(r.updates).toEqual([{ featureId: 'f1', key: 'radius', value: 12 }]);
  });
});

describe('reevaluateFeatureParamExpressionsFixedPoint', () => {
  it('settles sibling-expression chains in one call', () => {
    const nodes: ExpressionParamNode[] = [
      {
        id: 'f1',
        params: { count: 6, radius: 0, depth: 0 },
        paramExpressions: { radius: 'count * 2', depth: 'radius + 1' },
      },
    ];
    const r = reevaluateFeatureParamExpressionsFixedPoint(nodes, []);
    expect(r.converged).toBe(true);
    const byKey = Object.fromEntries(r.updates.map(u => [u.key, u.value]));
    expect(byKey).toEqual({ radius: 12, depth: 13 });
  });

  it('divergent sibling cycles return converged:false and NO updates', () => {
    const nodes: ExpressionParamNode[] = [
      {
        id: 'f1',
        params: { a: 1, b: 1 },
        paramExpressions: { a: 'b + 1', b: 'a + 1' },
      },
    ];
    const r = reevaluateFeatureParamExpressionsFixedPoint(nodes, []);
    expect(r.converged).toBe(false);
    expect(r.updates).toEqual([]); // params keep their last values — no runaway writes
  });

  it('does not mutate the input nodes', () => {
    const nodes: ExpressionParamNode[] = [
      { id: 'f1', params: { radius: 10 }, paramExpressions: { radius: 'W/2' } },
    ];
    reevaluateFeatureParamExpressionsFixedPoint(nodes, [{ name: 'W', value: 100 }]);
    expect(nodes[0].params.radius).toBe(10);
  });
});
