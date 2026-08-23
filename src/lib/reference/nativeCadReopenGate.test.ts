import { describe, expect, it } from 'vitest';
import {
  CAD_INTEROP_AXES,
  buildCadInteropPreservationReceipt,
  type ExternalCadReopenEvidence,
} from '../../../packages/cad-contracts/src/index';
import { evaluateNativeCadReopenGate } from './nativeCadReopenGate';

const hash = (char: string) => char.repeat(64);
const receipt = buildCadInteropPreservationReceipt({
  sourceFormat: 'STEP', resultFormat: 'STEP', sourceContentSha256: hash('a'), resultContentSha256: hash('b'),
  unsupportedReasons: [],
  axes: CAD_INTEROP_AXES.map(axis => ({
    axis, required: ['units', 'coordinate', 'topology'].includes(axis),
    state: 'PASS', method: axis, before: {}, after: {}, tolerance: null, reasons: [],
  })),
});
const evidence: ExternalCadReopenEvidence = {
  format: 'STEP', application: 'SOLIDWORKS', applicationVersion: '2026',
  workerIdentitySha256: hash('c'), openedContentSha256: hash('b'), execution: 'PASS',
  licenseVerified: true, documentOpened: true, nativeRegenerationCompleted: true,
  savedRoundtripContentSha256: hash('d'), reasons: [],
};

describe('native CAD reopen gate', () => {
  it('keeps missing licensed CAD execution as NOT_RUN', () => {
    expect(evaluateNativeCadReopenGate(receipt, null)).toMatchObject({ state: 'NOT_RUN', releaseReady: false });
  });

  it('passes only hash-bound licensed open and regeneration evidence', () => {
    expect(evaluateNativeCadReopenGate(receipt, evidence)).toMatchObject({ state: 'PASS', releaseReady: true, reasons: [] });
  });

  it('fails a result opened from different bytes', () => {
    expect(evaluateNativeCadReopenGate(receipt, { ...evidence, openedContentSha256: hash('e') }))
      .toMatchObject({ state: 'FAIL', releaseReady: false, reasons: ['external_cad_opened_hash_mismatch'] });
  });
});
