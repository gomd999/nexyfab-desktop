import { describe, it, expect } from 'vitest';
import {
  HOLE_FEATURE_SCHEMA_VERSION,
  ensureHoleFeatureV8,
  isHoleFeatureV8,
  migrateLegacyHoleFeature,
  type LegacyHoleParamsV7,
} from '../holeFeatureMigration';
import { validateHoleArray } from '../holeArray';

// ─── Version constant ──────────────────────────────────────────────────────

describe('HOLE_FEATURE_SCHEMA_VERSION constant', () => {
  it('is 8', () => {
    expect(HOLE_FEATURE_SCHEMA_VERSION).toBe(8);
  });
});

// ─── migrateLegacyHoleFeature (v7 → v8) ────────────────────────────────────

describe('migrateLegacyHoleFeature — single-position v7 hole', () => {
  it('through-all hole migrates to drilled + through termination', () => {
    const v7: LegacyHoleParamsV7 = {
      holeType: 0,
      diameter: 10,
      posX: 0,
      posZ: 0,
      depth: 999, // legacy sentinel
    };
    const v8 = migrateLegacyHoleFeature('node-1', v7);
    expect(v8.holeFeatureSchemaVersion).toBe(8);
    expect(v8.holeArrayDef.kind).toBe('manual');
    expect(v8.holeArrayDef.terminationKind).toBe('through');
    expect(v8.holeArrayDef.holeSpecDetail?.kind).toBe('drilled');
    expect(v8.holeArrayDef.holeSpecDetail?.diameter).toBe(10);
  });

  it('blind hole (depth < 999) migrates to blind termination', () => {
    const v7: LegacyHoleParamsV7 = {
      holeType: 0,
      diameter: 5,
      posX: 10,
      posZ: 20,
      depth: 15,
    };
    const v8 = migrateLegacyHoleFeature('blind-1', v7);
    expect(v8.holeArrayDef.terminationKind).toBe('blind');
    expect(v8.holeArrayDef.terminationParams.kind).toBe('blind');
    if (v8.holeArrayDef.terminationParams.kind === 'blind') {
      expect(v8.holeArrayDef.terminationParams.depth).toBe(15);
    }
  });

  it('counterbore hole (holeType=1) migrates to kind=counterbore', () => {
    const v7: LegacyHoleParamsV7 = {
      holeType: 1,
      diameter: 8,
      posX: 5,
      posZ: 5,
      depth: 999,
      counterboreDia: 14,
      counterboreDepth: 6,
    };
    const v8 = migrateLegacyHoleFeature('cb-1', v7);
    expect(v8.holeArrayDef.holeSpecDetail?.kind).toBe('counterbore');
    if (v8.holeArrayDef.holeSpecDetail?.kind === 'counterbore') {
      expect(v8.holeArrayDef.holeSpecDetail.headDiameter).toBe(14);
      expect(v8.holeArrayDef.holeSpecDetail.headDepth).toBe(6);
    }
  });

  it('countersink hole (holeType=2) migrates to kind=countersink', () => {
    const v7: LegacyHoleParamsV7 = {
      holeType: 2,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
      countersinkAngle: 82,
    };
    const v8 = migrateLegacyHoleFeature('csk-1', v7);
    expect(v8.holeArrayDef.holeSpecDetail?.kind).toBe('countersink');
    if (v8.holeArrayDef.holeSpecDetail?.kind === 'countersink') {
      expect(v8.holeArrayDef.holeSpecDetail.coneAngle).toBe(82);
    }
  });

  it('countersink without explicit angle defaults to 90°', () => {
    const v8 = migrateLegacyHoleFeature('csk-default', {
      holeType: 2,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
    });
    if (v8.holeArrayDef.holeSpecDetail?.kind === 'countersink') {
      expect(v8.holeArrayDef.holeSpecDetail.coneAngle).toBe(90);
    }
  });

  it('position is migrated XZ → XY (posZ → y)', () => {
    const v8 = migrateLegacyHoleFeature('pos-1', {
      holeType: 0,
      diameter: 5,
      posX: 12.5,
      posZ: 30,
      depth: 999,
    });
    const params = v8.holeArrayDef.params;
    expect(params.kind).toBe('manual');
    if (params.kind === 'manual') {
      expect(params.data.points).toHaveLength(1);
      expect(params.data.points[0].x).toBe(12.5);
      expect(params.data.points[0].y).toBe(30);
    }
  });

  it('counterbore without explicit cbore params synthesizes a sensible default', () => {
    const v8 = migrateLegacyHoleFeature('cb-default', {
      holeType: 1,
      diameter: 6,
      posX: 0,
      posZ: 0,
      depth: 999,
    });
    if (v8.holeArrayDef.holeSpecDetail?.kind === 'counterbore') {
      expect(v8.holeArrayDef.holeSpecDetail.headDiameter).toBeGreaterThan(6);
      expect(v8.holeArrayDef.holeSpecDetail.headDepth).toBeGreaterThan(0);
    }
  });

  it('migrated def passes validateHoleArray', () => {
    const v8 = migrateLegacyHoleFeature('valid-1', {
      holeType: 0,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
    });
    const result = validateHoleArray(v8.holeArrayDef);
    expect(result.ok).toBe(true);
  });

  it('migrated cbore def passes validateHoleArray', () => {
    const v8 = migrateLegacyHoleFeature('valid-cbore', {
      holeType: 1,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
      counterboreDia: 10,
      counterboreDepth: 4,
    });
    const result = validateHoleArray(v8.holeArrayDef);
    expect(result.ok).toBe(true);
  });

  it('migrated csk def passes validateHoleArray', () => {
    const v8 = migrateLegacyHoleFeature('valid-csk', {
      holeType: 2,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
      countersinkAngle: 90,
    });
    const result = validateHoleArray(v8.holeArrayDef);
    expect(result.ok).toBe(true);
  });

  it('idempotent — migrating an already-migrated node twice produces same shape', () => {
    const first = migrateLegacyHoleFeature('idem-1', {
      holeType: 0,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
    });
    const second = migrateLegacyHoleFeature('idem-1', first.legacyParams);
    expect(second.holeArrayDef.id).toBe(first.holeArrayDef.id);
    expect(second.holeArrayDef.holeSpecDetail).toEqual(first.holeArrayDef.holeSpecDetail);
  });

  it('preserves legacy engine selector field', () => {
    const v8 = migrateLegacyHoleFeature('engine-1', {
      holeType: 0,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
      engine: 1,
    });
    expect(v8.legacyParams.engine).toBe(1);
  });

  it('zero-depth maps to through (defensive)', () => {
    const v8 = migrateLegacyHoleFeature('zd-1', {
      holeType: 0,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 0,
    });
    expect(v8.holeArrayDef.terminationKind).toBe('through');
  });

  it('non-finite depth maps to through', () => {
    const v8 = migrateLegacyHoleFeature('nf-depth', {
      holeType: 0,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: NaN,
    });
    expect(v8.holeArrayDef.terminationKind).toBe('through');
  });

  it('unknown holeType (>2) falls back to drilled', () => {
    const v8 = migrateLegacyHoleFeature('weird-1', {
      holeType: 99,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 999,
    });
    expect(v8.holeArrayDef.holeSpecDetail?.kind).toBe('drilled');
  });
});

// ─── isHoleFeatureV8 / ensureHoleFeatureV8 ─────────────────────────────────

describe('isHoleFeatureV8 detection', () => {
  it('returns false for legacy v7 param bag', () => {
    expect(
      isHoleFeatureV8({
        holeType: 0,
        diameter: 5,
        posX: 0,
        posZ: 0,
        depth: 999,
      }),
    ).toBe(false);
  });

  it('returns true for explicit version stamp', () => {
    expect(isHoleFeatureV8({ holeFeatureSchemaVersion: 8 })).toBe(true);
  });

  it('returns true when holeArrayDef field is present and well-formed', () => {
    expect(
      isHoleFeatureV8({
        holeArrayDef: {
          id: 'a',
          kind: 'manual',
          params: { kind: 'manual', data: { points: [] } },
        },
      }),
    ).toBe(true);
  });

  it('returns false for null / non-object', () => {
    expect(isHoleFeatureV8(null)).toBe(false);
    expect(isHoleFeatureV8(undefined)).toBe(false);
    expect(isHoleFeatureV8('hello')).toBe(false);
    expect(isHoleFeatureV8(42)).toBe(false);
  });
});

describe('ensureHoleFeatureV8 — convenience wrapper', () => {
  it('passes through an already-v8 input without re-derivation', () => {
    const original = migrateLegacyHoleFeature('node-pre', {
      holeType: 0,
      diameter: 8,
      posX: 5,
      posZ: 5,
      depth: 999,
    });
    const wrapped = ensureHoleFeatureV8('node-pre', original);
    expect(wrapped.holeArrayDef).toEqual(original.holeArrayDef);
  });

  it('runs migration on v7 input', () => {
    const v8 = ensureHoleFeatureV8('node-fresh', {
      holeType: 1,
      diameter: 5,
      posX: 0,
      posZ: 0,
      depth: 20,
      counterboreDia: 10,
      counterboreDepth: 4,
    });
    expect(v8.holeFeatureSchemaVersion).toBe(8);
    expect(v8.holeArrayDef.holeSpecDetail?.kind).toBe('counterbore');
    expect(v8.holeArrayDef.terminationKind).toBe('blind');
  });

  it('handles undefined input without throwing', () => {
    const v8 = ensureHoleFeatureV8('node-empty', undefined);
    expect(v8.holeFeatureSchemaVersion).toBe(8);
    expect(v8.holeArrayDef.holeSpecDetail?.kind).toBe('drilled');
  });
});
