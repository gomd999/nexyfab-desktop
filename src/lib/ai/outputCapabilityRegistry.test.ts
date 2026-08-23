import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  OUTPUT_CAPABILITIES,
  assertOutputExportable,
  canExportOutput,
  getOutputCapability,
  validateOutputCapabilityRegistry,
} from './outputCapabilityRegistry';

describe('cross-domain output capability truth', () => {
  it('contains no contradictory release, export, or advertisement claim', () => {
    expect(validateOutputCapabilityRegistry()).toEqual([]);
    expect(OUTPUT_CAPABILITIES.length).toBeGreaterThan(30);
    expect(OUTPUT_CAPABILITIES.every(item => item.releaseReady === false)).toBe(true);
  });

  it('binds every claimed implementation and evidence path to a real source file', () => {
    for (const item of OUTPUT_CAPABILITIES) {
      for (const path of [...item.implementationPaths, ...item.evidencePaths]) {
        expect(existsSync(path), `${item.id}: ${path}`).toBe(true);
      }
    }
  });

  it('separates exact STEP, mesh STL, bounded DXF, and internal BOM truth', () => {
    expect(getOutputCapability('mechanical.part.step')?.artifactTruth).toBe('exact_exchange');
    expect(getOutputCapability('mechanical.part.stl')?.artifactTruth).toBe('mesh_exchange');
    expect(getOutputCapability('mechanical.drawing.dxf')?.artifactTruth).toBe('bounded_exchange');
    expect(getOutputCapability('mechanical.bom.internal')?.artifactTruth).toBe('structured_internal');
    expect(OUTPUT_CAPABILITIES.every(item => item.releaseReady === false)).toBe(true);
  });

  it('fails closed for unknown, HOLD, NOT_RUN, and verification-only outputs', () => {
    expect(canExportOutput('missing.output')).toBe(false);
    expect(canExportOutput('architecture.dxf.roundtrip')).toBe(false);
    expect(canExportOutput('interior.ifc.structured-semantic')).toBe(false);
    expect(canExportOutput('specialty.sheet-metal.verify')).toBe(false);
    expect(() => assertOutputExportable('specialty.ecad-mcad.native-output')).toThrow('OUTPUT_EXPORT_HOLD');
  });
});
