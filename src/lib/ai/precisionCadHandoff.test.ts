import { describe, expect, it } from 'vitest';
import { buildPrecisionCadHandoff } from './precisionCadHandoff';

describe('precision CAD handoff', () => {
  it('marks supported canonical primitives ready but requires review', () => {
    const result = buildPrecisionCadHandoff({ definitionId: 'plate', sourceRef: 'ai', moduleSource: 'module x(){ cube([100,50,8]); }' });
    expect(result).toMatchObject({ schema: 'nexyfab.precision-cad-handoff.v1', status: 'ready', requiresReview: true });
    expect(result.editableProgram?.features[0]).toMatchObject({ type: 'sketchExtrude', shape: 'rect', width: 100, depth: 50, height: 8 });
    expect(result.supportedOperations).toContain('box');
    expect(result.blockedReasons).toEqual(expect.arrayContaining(['MATERIAL_CONFIRMATION_REQUIRED', 'PROCESS_CONFIRMATION_REQUIRED']));
  });

  it('blocks unsupported SCAD operations instead of pretending conversion succeeded', () => {
    const result = buildPrecisionCadHandoff({ definitionId: 'freeform', sourceRef: 'ai', moduleSource: 'module x(){ sphere(r=10); }' });
    expect(result.status).toBe('blocked');
    expect(result.blockedReasons).toContain('SCAD_FEATURE_OPERATION_UNSUPPORTED:sphere');
    expect(result.editableProgram).toBeUndefined();
  });
});
