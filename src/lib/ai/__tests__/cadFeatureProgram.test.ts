import { describe, expect, it } from 'vitest';
import { clarificationQuestions, compileIntentIRToBaseProgram, expectedAnalyticFeatureSignature, findUngroundedProgramDimensions, validateCadFeatureProgram, type CadFeatureProgram } from '../cadFeatureProgram';
import { structuredBriefToDesignIntentIR } from '../designIntentIR';

describe('CAD feature program contract', () => {
  const valid: CadFeatureProgram = {
    part: 'plate',
    features: [
      { id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 80, height: 8 },
      { id: 'hole', type: 'hole', diameter: 6, posX: 0, posY: 0 },
    ],
  };

  it('accepts an explicit deterministic program', () => {
    expect(validateCadFeatureProgram(valid)).toEqual({ ok: true, errors: [] });
  });

  it('rejects missing dimensions instead of inserting CAD defaults', () => {
    const invalid = { ...valid, features: [{ id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100 }] } as CadFeatureProgram;
    const result = validateCadFeatureProgram(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('base.depth must be a positive explicit dimension.');
    expect(result.errors).toContain('base.height must be a positive explicit dimension.');
  });

  it('rejects broken references and destructive geometry', () => {
    const result = validateCadFeatureProgram({
      part: 'bad',
      features: [
        { id: 'base', type: 'sketchExtrude', shape: 'circle', width: 20, height: 5 },
        { id: 'hole', type: 'hole', diameter: 20, posX: 0, posY: 0 },
        { id: 'pattern', type: 'circularPattern', feature: 'missing', count: 4, pcd: 10 },
      ],
    });
    expect(result.errors).toContain('pattern.feature references a missing id.');
    expect(result.errors).toContain('hole.diameter removes the entire base.');
  });

  it('compiles only fully confirmed IR values', () => {
    const ir = structuredBriefToDesignIntentIR({
      title: 'Plate', domain: 'mech', raw: '100 by 80 by 8 mm plate', questions: [], assumptions: [],
      components: [{ name: 'body', params: [
        { key: 'width', value: 100, unit: 'mm', source: 'given' },
        { key: 'depth', value: 80, unit: 'mm', source: 'given' },
        { key: 'thickness', value: 8, unit: 'mm', source: 'given' },
      ] }],
    });
    const result = compileIntentIRToBaseProgram(ir, 'component:body-1', 'rect');
    expect(result).toMatchObject({ ok: true, program: { intentIrVersion: 1 } });
    if (result.ok) expect(result.program.features[0]).toMatchObject({ width: 100, depth: 80, height: 8 });
  });

  it('detects dimensions invented by the model while accepting explicit x-separated values', () => {
    expect(findUngroundedProgramDimensions('plate 100x80x8 mm with a 6 mm center hole', valid)).toEqual([]);
    const invented = { ...valid, features: [
      ...valid.features,
      { id: 'fillet', type: 'fillet' as const, radius: 3 },
    ] };
    expect(findUngroundedProgramDimensions('plate 100x80x8 mm with a 6 mm center hole', invented)).toContain(
      'fillet.radius=3 has no numeric evidence in the prompt.',
    );
  });

  it('permits only the documented metric clearance derivation', () => {
    const metricHole: CadFeatureProgram = {
      part: 'm6_plate', features: [
        { id: 'base', type: 'sketchExtrude', shape: 'rect', width: 40, depth: 30, height: 5 },
        { id: 'hole', type: 'hole', diameter: 6.5, posX: 0, posY: 0 },
      ],
    };
    expect(findUngroundedProgramDimensions('40x30x5 plate with one M6 clearance hole', metricHole)).toEqual([]);
  });

  it('turns validation details into bounded clarification questions', () => {
    expect(clarificationQuestions([
      'base.height must be a positive explicit dimension.',
      'fillet.radius=3 has no numeric evidence in the prompt.',
    ])).toEqual([
      'What should the height of base be?',
      'Please confirm the radius for fillet (the generated value was 3).',
    ]);
  });

  it('expands patterned holes into an analytic cylinder-face expectation', () => {
    expect(expectedAnalyticFeatureSignature({
      part: 'flange', features: [
        { id: 'base', type: 'sketchExtrude', shape: 'circle', width: 100, height: 10 },
        { id: 'hole', type: 'hole', diameter: 6, posX: 0, posY: 0 },
        { id: 'pattern', type: 'circularPattern', feature: 'hole', count: 4, pcd: 70 },
      ],
    })).toEqual({ expectedCylinderFaces: 5, expectedThroughHoles: 4, unsupportedFeatureIds: [] });
  });
});
