import { describe, expect, it } from 'vitest';
import {
  CAD_INTEROP_AXES,
  buildCadInteropPreservationReceipt,
  validateExternalCadReopenEvidence,
  validateCadInteropPreservationReceipt,
  type CadInteropAxisEvidence,
} from './index';

const hash = (char: string) => char.repeat(64);
const axes = (state: CadInteropAxisEvidence['state'] = 'PASS'): CadInteropAxisEvidence[] =>
  CAD_INTEROP_AXES.map(axis => ({
    axis,
    required: ['units', 'coordinate', 'topology', 'assembly'].includes(axis),
    state,
    method: `measure-${axis}`,
    before: {},
    after: {},
    tolerance: null,
    reasons: [],
  }));

describe('CAD interop preservation receipt', () => {
  it('passes only when every required axis passed', () => {
    const receipt = buildCadInteropPreservationReceipt({
      sourceFormat: 'STEP', resultFormat: 'STEP', sourceContentSha256: hash('a'),
      resultContentSha256: hash('b'), axes: axes(), unsupportedReasons: [],
    });
    expect(receipt.execution).toBe('PASS');
    expect(validateCadInteropPreservationReceipt(receipt)).toEqual([]);
  });

  it('keeps an unexecuted required axis as NOT_RUN', () => {
    const evidence = axes();
    evidence.find(axis => axis.axis === 'assembly')!.state = 'NOT_RUN';
    const receipt = buildCadInteropPreservationReceipt({
      sourceFormat: 'IFC', resultFormat: 'NEXYFAB_IR', sourceContentSha256: hash('a'),
      resultContentSha256: hash('b'), axes: evidence, unsupportedReasons: [],
    });
    expect(receipt.execution).toBe('NOT_RUN');
  });

  it('rejects a forged aggregate PASS and duplicate axes', () => {
    const evidence = axes();
    evidence.find(axis => axis.axis === 'topology')!.state = 'FAIL';
    const receipt = { ...buildCadInteropPreservationReceipt({
      sourceFormat: 'STEP', resultFormat: 'STEP', sourceContentSha256: hash('a'),
      resultContentSha256: hash('b'), axes: evidence, unsupportedReasons: [],
    }), execution: 'PASS' };
    expect(validateCadInteropPreservationReceipt(receipt)).toContain('cad_interop_execution_inconsistent');
    expect(() => buildCadInteropPreservationReceipt({
      sourceFormat: 'STEP', resultFormat: 'STEP', sourceContentSha256: hash('a'),
      resultContentSha256: hash('b'), axes: [...axes(), axes()[0]!], unsupportedReasons: [],
    })).toThrow('cad_interop_axis_duplicate:units');
  });

  it('blocks formats declared unsupported instead of claiming support', () => {
    const receipt = buildCadInteropPreservationReceipt({
      sourceFormat: 'RVT', resultFormat: 'NEXYFAB_IR', sourceContentSha256: hash('a'),
      resultContentSha256: null, axes: axes('NOT_RUN'), unsupportedReasons: ['licensed_revit_worker_unavailable'],
    });
    expect(receipt.execution).toBe('BLOCKED');
  });

  it('never treats missing or unlicensed external CAD reopen evidence as PASS', () => {
    expect(validateExternalCadReopenEvidence(hash('a'), null).state).toBe('NOT_RUN');
    expect(validateExternalCadReopenEvidence(hash('a'), {
      format: 'STEP', application: 'SOLIDWORKS', applicationVersion: '2026',
      workerIdentitySha256: hash('c'), openedContentSha256: hash('a'), execution: 'PASS',
      licenseVerified: false, documentOpened: true, nativeRegenerationCompleted: true,
      savedRoundtripContentSha256: hash('d'), reasons: [],
    })).toMatchObject({ state: 'FAIL', reasons: ['external_cad_license_not_verified'] });
  });
});
