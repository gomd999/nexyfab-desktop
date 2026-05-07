import { describe, it, expect } from 'vitest';
import { classifyFeatureError } from '@/app/[lang]/shape-generator/features/featureDiagnostics';
import { FEATURE_DEFS } from '@/app/[lang]/shape-generator/features';

describe('M2 pipeline diagnostics', () => {
  it('classifies pipelineManager empty-geometry messages', () => {
    const a = classifyFeatureError('fillet', 'Feature produced empty geometry');
    expect(a.code).toBe('emptyOutput');

    const b = classifyFeatureError('sketchExtrude', 'Sketch merge produced empty geometry');
    expect(b.code).toBe('empty');

    const c = classifyFeatureError('sketchExtrude', 'Sketch produced empty geometry');
    expect(c.code).toBe('emptySketch');
    expect(c.hintEn).toMatch(/depth|profile/i);
  });

  it('appends tree node id to hints when context.nodeId is set', () => {
    const d = classifyFeatureError('fillet', 'Feature produced empty geometry', { nodeId: 'node-abc' });
    expect(d.nodeId).toBe('node-abc');
    expect(d.hintEn).toContain('node-abc');
    expect(d.hintKo).toContain('node-abc');
  });

  it('classifies boolean messages from boolean.ts', () => {
    expect(
      classifyFeatureError('boolean', 'Boolean subtract: empty result — 도구와 본체가 교차하지 않거나 일치합니다')
        .code,
    ).toBe('booleanOp');
    expect(
      classifyFeatureError(
        'boolean',
        'Boolean operation produced no geometry — meshes may not intersect',
      ).code,
    ).toBe('booleanOp');
  });

  it('classifies merge and mesh-quality messages from features', () => {
    expect(classifyFeatureError('mirror', 'Mirror merge failed').code).toBe('mergeFail');
    expect(classifyFeatureError('flange', 'Failed to merge flange geometry').code).toBe('mergeFail');
    expect(classifyFeatureError('fillet', 'Fillet requires indexed (manifold) geometry').code).toBe(
      'indexedMesh',
    );
    expect(classifyFeatureError('fillet', 'Geometry has no bounding box').code).toBe('bounds');
    expect(classifyFeatureError('shell', 'Shell requires geometry with at least 4 vertices').code).toBe(
      'minimalGeometry',
    );
    expect(classifyFeatureError('bend', 'Invalid edgeIndex: 99').code).toBe('paramRange');
    expect(
      classifyFeatureError('boundarySurface', 'Boundary surface requires exactly 4 boundary curves').code,
    ).toBe('paramRange');
  });

  it('classifies OCCT, worker, and bounds messages used in app', () => {
    expect(
      classifyFeatureError(
        'boolean',
        'OCCT engine not initialized — call ensureOcctReady() before using OCCT features',
      ).code,
    ).toBe('occtInit');
    expect(classifyFeatureError('fillet', 'Failed to load OCCT WASM module: x').code).toBe('occtInit');
    expect(classifyFeatureError('boolean', 'Pipeline worker error').code).toBe('workerFail');
    expect(classifyFeatureError('boolean', 'Pipeline worker terminated').code).toBe('workerFail');
    expect(classifyFeatureError('boolean', 'Pipeline worker returned unknown error').code).toBe(
      'workerFail',
    );
    expect(classifyFeatureError('boolean', 'Failed to start pipeline worker: Error').code).toBe(
      'workerFail',
    );
    expect(classifyFeatureError('boolean', 'CSG worker terminated').code).toBe('workerFail');
    expect(classifyFeatureError('boolean', 'Failed to start CSG: TypeError').code).toBe('workerFail');
    expect(classifyFeatureError('fillet', 'Missing bounding box').code).toBe('bounds');
    expect(classifyFeatureError('boolean', 'CSG worker timed out (30s)').code).toBe('timeout');
    expect(classifyFeatureError('fillet', 'Pipeline superseded').code).toBe('cancelled');
    expect(classifyFeatureError('fillet', 'Pipeline cancelled').code).toBe('cancelled');
  });

  it('classifies sheet-metal profile, mesh attribute, and import messages', () => {
    expect(
      classifyFeatureError('bend', 'Profile produced no geometry segments').code,
    ).toBe('emptySketch');
    expect(classifyFeatureError('bend', 'Profile must have at least 2 points').code).toBe('paramRange');
    expect(classifyFeatureError('fillet', 'Geometry has no position attribute').code).toBe(
      'minimalGeometry',
    );
    expect(
      classifyFeatureError('fillet', 'Pipeline output has no position buffer (cannot serialise mesh).').code,
    ).toBe('minimalGeometry');
    expect(
      classifyFeatureError('sketchExtrude', 'OCCT import failed: no meshes produced').code,
    ).toBe('emptyOutput');
    expect(
      classifyFeatureError('sketchExtrude', 'DXF file contains no supported entities').code,
    ).toBe('emptyOutput');
    expect(classifyFeatureError('fillet', 'Unsupported format: .xyz. Supported: STEP').code).toBe(
      'unknown',
    );
  });

  it('classifies expression and extra worker bootstrap messages', () => {
    expect(classifyFeatureError('fillet', 'Empty expression').code).toBe('paramRange');
    expect(classifyFeatureError('fillet', 'Division by zero').code).toBe('paramRange');
    expect(classifyFeatureError('fillet', "Unexpected token 'foo' at position 3").code).toBe(
      'paramRange',
    );
    expect(classifyFeatureError('boolean', 'Failed to start FEA: Error').code).toBe('workerFail');
    expect(classifyFeatureError('boolean', 'IndexedDB not available').code).toBe('workerFail');
  });

  it('classifies stability / boolean style messages', () => {
    expect(classifyFeatureError('boolean', 'boolean operation failed: invalid operands').code).toBe(
      'booleanOp',
    );
    expect(classifyFeatureError('sweep', 'self-intersecting path').code).toBe('selfIntersect');
    expect(classifyFeatureError('fillet', 'Worker timed out').code).toBe('timeout');
  });

  it('classifies field B4 / OCCT rolling messages', () => {
    expect(classifyFeatureError('fillet', 'Out of memory').code).toBe('workerFail');
    expect(classifyFeatureError('boolean', 'Memory allocation failed').code).toBe('workerFail');
    expect(classifyFeatureError('shell', 'wasm memory limit').code).toBe('workerFail');
    expect(classifyFeatureError('fillet', 'Degenerate edge').code).toBe('paramRange');
    expect(classifyFeatureError('boolean', 'Topological validation failed').code).toBe('nonManifold');
    expect(classifyFeatureError('shell', 'Offset failed').code).toBe('paramRange');
    expect(classifyFeatureError('shell', 'failed to thicken').code).toBe('paramRange');
    expect(classifyFeatureError('fillet', 'Healing failed').code).toBe('mergeFail');
    expect(classifyFeatureError('loft', 'Loft error: profiles misaligned').code).toBe('mergeFail');
    expect(classifyFeatureError('sweep', 'Sweep failed: bad path').code).toBe('mergeFail');
    expect(classifyFeatureError('sweep', 'Sweep failed: self-intersecting path').code).toBe(
      'selfIntersect',
    );
  });

  it('keeps registry size aligned with modeling surface (see registryCompleteness)', () => {
    expect(FEATURE_DEFS.length).toBeGreaterThanOrEqual(20);
  });
});
