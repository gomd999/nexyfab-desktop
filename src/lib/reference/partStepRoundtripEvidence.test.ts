import { describe, expect, it } from 'vitest';
import { comparePartStepRoundtrip, type PartGeometryMeasurement } from './partStepRoundtripEvidence';

const source: PartGeometryMeasurement = {
  engineIdentity: 'replicad-occt', role: 'authoring-brep', unit: 'mm', solidCount: 1,
  volumeMm3: 8000, surfaceAreaMm2: 2400, bbox: { min: [0, 0, 0], max: [40, 20, 10] },
  centroidMm: [20, 10, 5], faceCount: 6, edgeCount: 12, validSolid: true, watertight: true,
};

describe('part STEP roundtrip evidence', () => {
  it('passes a separately imported shape inside engineering tolerances', () => {
    const evidence = comparePartStepRoundtrip(source, {
      ...source, engineIdentity: 'occt-import-js', role: 'isolated-step-import', volumeMm3: 7999.5,
      bbox: { min: [0, 0, 0], max: [40.001, 20, 10] },
    });
    expect(evidence.status).toBe('pass');
    expect(evidence.blockers).toEqual([]);
  });

  it('fails closed for a same-engine verifier or topology/geometry drift', () => {
    const evidence = comparePartStepRoundtrip(source, {
      ...source, role: 'isolated-step-import', volumeMm3: 7000, faceCount: 7,
    });
    expect(evidence.status).toBe('fail');
    expect(evidence.blockers).toEqual(expect.arrayContaining(['verifier-not-isolated', 'volumeRelative-outside-tolerance', 'faceCount-outside-tolerance']));
  });
});
