import { describe, it, expect } from 'vitest';
import {
  BUDGET_DEFAULTS,
  makeInitialBudget,
  checkBudget,
  isWedged,
  recordTurn,
  recordToolCall,
  recordRenderResult,
} from '../budget';

describe('budget defaults', () => {
  it('caps are sane', () => {
    expect(BUDGET_DEFAULTS.tokensCap).toBeGreaterThan(10_000);
    expect(BUDGET_DEFAULTS.turnsCap).toBeLessThan(50);
    expect(BUDGET_DEFAULTS.toolCallsCap).toBeLessThan(200);
    expect(BUDGET_DEFAULTS.wedgeRenderFailThreshold).toBe(3);
  });
});

describe('checkBudget', () => {
  it('fresh budget is not exhausted', () => {
    const b = makeInitialBudget();
    expect(checkBudget(b).exhausted).toBe(false);
  });

  it('token cap → exhausted with reason=tokens', () => {
    const b = makeInitialBudget({ tokensCap: 100 });
    const used = recordTurn(b, 100);
    const c = checkBudget(used);
    expect(c.exhausted).toBe(true);
    expect(c.reason).toBe('tokens');
  });

  it('turn cap → exhausted with reason=turns', () => {
    let b = makeInitialBudget({ turnsCap: 2, tokensCap: 1_000_000 });
    b = recordTurn(b, 0);
    b = recordTurn(b, 0);
    const c = checkBudget(b);
    expect(c.exhausted).toBe(true);
    expect(c.reason).toBe('turns');
  });

  it('tool-call cap → exhausted with reason=tool_calls', () => {
    let b = makeInitialBudget({ toolCallsCap: 1 });
    b = recordToolCall(b);
    const c = checkBudget(b);
    expect(c.exhausted).toBe(true);
    expect(c.reason).toBe('tool_calls');
  });

  it('remainingPct goes from 1 → 0 as budget consumes', () => {
    let b = makeInitialBudget({ tokensCap: 100, turnsCap: 100, toolCallsCap: 100 });
    expect(checkBudget(b).remainingPct).toBe(1);
    b = recordTurn(b, 50);
    const r = checkBudget(b).remainingPct;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

describe('wedge detection', () => {
  it('not wedged on success run', () => {
    let b = makeInitialBudget();
    b = recordRenderResult(b, true);
    b = recordRenderResult(b, true);
    expect(isWedged(b)).toBe(false);
  });

  it('wedge trips at 3 consecutive failures', () => {
    let b = makeInitialBudget();
    b = recordRenderResult(b, false);
    expect(isWedged(b)).toBe(false);
    b = recordRenderResult(b, false);
    expect(isWedged(b)).toBe(false);
    b = recordRenderResult(b, false);
    expect(isWedged(b)).toBe(true);
  });

  it('one success resets the wedge counter', () => {
    let b = makeInitialBudget();
    b = recordRenderResult(b, false);
    b = recordRenderResult(b, false);
    b = recordRenderResult(b, true);
    expect(isWedged(b)).toBe(false);
    b = recordRenderResult(b, false);
    b = recordRenderResult(b, false);
    expect(isWedged(b)).toBe(false);
    b = recordRenderResult(b, false);
    expect(isWedged(b)).toBe(true);
  });
});
