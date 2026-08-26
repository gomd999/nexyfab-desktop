import { describe, expect, it } from 'vitest';
import {
  canonicalSketchIssueToCadMessage,
  canonicalSketchIssuesToCadMessages,
} from './canonicalSketchIssues';

describe('canonical sketch issue i18n adapter', () => {
  it('maps stable issue families without putting locale text in the machine issue', () => {
    expect(canonicalSketchIssueToCadMessage({ code: 'CONSTRAINT_UNSUPPORTED', path: 'constraints[0].type' }, 'en')).toMatchObject({
      issue: { code: 'CONSTRAINT_UNSUPPORTED', path: 'constraints[0].type' },
      message: { code: 'CAD_FEATURE_UNSUPPORTED', params: { feature: 'CONSTRAINT_UNSUPPORTED@constraints[0].type' } },
    });
    expect(canonicalSketchIssueToCadMessage({ code: 'PREFLIGHT_INVALID' }, 'en').message.code).toBe('CAD_PREFLIGHT_HOLD');
    expect(canonicalSketchIssueToCadMessage({ code: 'SNAPSHOT_ACCESSOR' }, 'en').message.code).toBe('CAD_INPUT_INVALID');
    expect(canonicalSketchIssueToCadMessage({ code: 'SOLVER_NONDETERMINISTIC' }, 'en').message.code).toBe('CAD_VERIFICATION_FAILED');
    expect(canonicalSketchIssueToCadMessage({ code: 'SCHEMA_INVALID' }, 'en').message.code).toBe('CAD_ARTIFACT_VERSION_MISMATCH');
    expect(canonicalSketchIssueToCadMessage({ code: 'future_code' }, 'en').message.code).toBe('CAD_INPUT_INVALID');
  });

  it('resolves deterministically across all six locales with fallback', () => {
    const locales = ['ko', 'en', 'ja', 'zh', 'es', 'ar'];
    for (const locale of locales) {
      const result = canonicalSketchIssueToCadMessage({ code: 'SOLVER_NONFINITE', path: 'solver.residual' }, locale);
      expect(result.issue).toEqual({ code: 'SOLVER_NONFINITE', path: 'solver.residual' });
      expect(result.message).toEqual({ code: 'CAD_VERIFICATION_FAILED', params: { check: 'SOLVER_NONFINITE@solver.residual' } });
      expect(result.resolved.locale).toBe(locale);
      expect(result.resolved.text).toContain('SOLVER_NONFINITE@solver.residual');
    }
    expect(canonicalSketchIssueToCadMessage({ code: 'INPUT_INVALID' }, 'xx').resolved.resolvedLocale).toBe('en');
  });

  it('fails closed for hidden, symbol, getter, proxy, cycle, unknown and oversize values', () => {
    const hidden = { code: 'INPUT_INVALID' } as Record<string, unknown>;
    Object.defineProperty(hidden, 'hidden', { enumerable: false, value: 'x' });
    expect(canonicalSketchIssueToCadMessage(hidden, 'en').issue.code).toBe('ISSUE_INVALID');
    const symbol = { code: 'INPUT_INVALID' } as Record<string, unknown>;
    Object.defineProperty(symbol, Symbol('extra'), { enumerable: true, value: 'x' });
    expect(canonicalSketchIssueToCadMessage(symbol, 'en').issue.code).toBe('ISSUE_INVALID');
    const getter = {} as Record<string, unknown>;
    Object.defineProperty(getter, 'code', { enumerable: true, get: () => 'INPUT_INVALID' });
    expect(canonicalSketchIssueToCadMessage(getter, 'en').issue.code).toBe('ISSUE_INVALID');
    expect(canonicalSketchIssueToCadMessage(new Proxy({ code: 'INPUT_INVALID' }, {}), 'en').issue.code).toBe('ISSUE_INVALID');
    const cycle: Record<string, unknown> = { code: 'INPUT_INVALID' };
    cycle.path = cycle;
    expect(canonicalSketchIssueToCadMessage(cycle, 'en').issue.code).toBe('ISSUE_INVALID');
    expect(canonicalSketchIssueToCadMessage({ code: 'INPUT_INVALID', path: '<script>' }, 'en').issue.code).toBe('INPUT_INVALID');
    expect(canonicalSketchIssueToCadMessage({ code: 'INPUT_INVALID', path: 'x'.repeat(300) }, 'en').issue.code).toBe('ISSUE_INVALID');
    expect(canonicalSketchIssueToCadMessage({ code: 'INPUT_INVALID', path: 'x'.repeat(300) }, 'en').message.params).toEqual({ reason: 'ISSUE_INVALID' });
    expect(canonicalSketchIssuesToCadMessages(new Array(257).fill({ code: 'INPUT_INVALID' }), 'en')[0]!.issue.code).toBe('ISSUE_INVALID');
  });

  it('preserves stable machine issues in list order and keeps no release claim', () => {
    const result = canonicalSketchIssuesToCadMessages([
      { code: 'OUTPUT_STRUCTURAL_INVALID' },
      { code: 'RESOURCE_LIMIT', path: 'constraints' },
    ], 'ko');
    expect(result.map(item => item.issue.code)).toEqual(['OUTPUT_STRUCTURAL_INVALID', 'RESOURCE_LIMIT']);
    expect(result[0]!.message.code).toBe('CAD_VERIFICATION_FAILED');
    expect(result[1]!.message.code).toBe('CAD_INPUT_INVALID');
    expect('release' in result[0]!.message).toBe(false);
  });
});
