/**
 * assemblyConstraints — unit tests (Phase 4.6).
 *
 * Covers the 6 constraint kinds (total_mass_limit, bbox_envelope,
 * part_count_limit, manufacturing_volume_min, cost_limit,
 * material_homogeneity) plus the cross-cutting orchestration shape
 * (severity bubbling, multi-constraint result, empty-constraint trivia).
 */
import { describe, it, expect } from 'vitest';
import {
  checkAssemblyConstraints,
  DEFAULT_COST_RATES_USD_PER_MM3,
  DEFAULT_FX_PER_USD,
  type AssemblyConstraint,
} from './assemblyConstraints';
import {
  IDENTITY_QUAT,
  partInstance,
  type AssemblyState,
  type PartInstance,
} from './assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── helpers ─────────────────────────────────────────────────────────────

function makePart(
  id: string,
  opts: Partial<{
    name: string;
    fixed: boolean;
    position: { x: number; y: number; z: number };
  }> = {},
): PartInstance {
  return partInstance({
    id,
    name: opts.name ?? id,
    partTemplateId: 'tpl',
    position: opts.position ?? { x: 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: opts.fixed ?? false,
  });
}

const SQUARE_10x10: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** 10×10×depth box rooted at the origin → volume = 100 × depth. */
function boxTree(depth: number): FeatureTree {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: SQUARE_10x10,
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
  return {
    nodes: [{ id: 'e', name: 'e', dependencies: [], payload }],
  };
}

function makeAssembly(parts: PartInstance[]): AssemblyState {
  return { parts, mates: [] };
}

// ─── empty-constraint / trivia ───────────────────────────────────────────

describe('checkAssemblyConstraints — empty / shape', () => {
  it('returns ok with no violations when constraints is empty', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(state, []);
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('returns ok for an empty assembly + empty constraints', () => {
    const state = makeAssembly([]);
    const res = checkAssemblyConstraints(state, []);
    expect(res.ok).toBe(true);
  });

  it('preserves constraintIndex in violation entries (per input order)', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const constraints: AssemblyConstraint[] = [
      { kind: 'part_count_limit', max: 0 }, // fails @ index 0
      { kind: 'part_count_limit', max: 5 }, // passes
    ];
    const res = checkAssemblyConstraints(state, constraints);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]!.constraintIndex).toBe(0);
  });

  it('echoes constraint.kind in the violation.kind field', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'part_count_limit', max: 0 },
    ]);
    expect(res.violations[0]!.kind).toBe('part_count_limit');
  });
});

// ─── total_mass_limit ────────────────────────────────────────────────────

describe('checkAssemblyConstraints — total_mass_limit', () => {
  it('passes when mass is under the limit', () => {
    // 100 × 5 mm = 500 mm³ of aluminum (0.0027 g/mm³) = 1.35 g
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'total_mass_limit', maxGrams: 10 }],
      { featureTrees: { p1: boxTree(5) }, materials: { p1: 'aluminum' } },
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('fails with error when mass exceeds the limit', () => {
    // 100 × 100 mm = 10_000 mm³ of steel (0.00785 g/mm³) = 78.5 g
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'total_mass_limit', maxGrams: 10 }],
      { featureTrees: { p1: boxTree(100) }, materials: { p1: 'steel' } },
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]!.severity).toBe('error');
    expect(res.violations[0]!.limit).toBe(10);
    expect(res.violations[0]!.actual).toBeCloseTo(78.5, 1);
  });

  it('warns when no part produces a mass measurement', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    // No featureTrees → no volume → no mass.
    const res = checkAssemblyConstraints(state, [
      { kind: 'total_mass_limit', maxGrams: 10 },
    ]);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]!.severity).toBe('warning');
    // Warnings do NOT flip ok to false.
    expect(res.ok).toBe(true);
  });
});

// ─── bbox_envelope ───────────────────────────────────────────────────────

describe('checkAssemblyConstraints — bbox_envelope', () => {
  it('passes when every part fits inside the envelope', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'bbox_envelope', size: { x: 100, y: 100, z: 100 } }],
      { featureTrees: { p1: boxTree(5) } },
    );
    expect(res.ok).toBe(true);
  });

  it('fails when union bbox exceeds the envelope on x', () => {
    // box is 10x10x5; envelope only 5 wide on x.
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'bbox_envelope', size: { x: 5, y: 100, z: 100 } }],
      { featureTrees: { p1: boxTree(5) } },
    );
    expect(res.ok).toBe(false);
    expect(res.violations[0]!.severity).toBe('error');
    expect((res.violations[0]!.actual as { x: number }).x).toBe(10);
  });

  it('honours PartInstance.position when unioning bboxes', () => {
    // Two boxes 10 wide, second offset by +50 → total span = 60.
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2', { position: { x: 50, y: 0, z: 0 } }),
    ]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'bbox_envelope', size: { x: 30, y: 100, z: 100 } }],
      {
        featureTrees: { p1: boxTree(5), p2: boxTree(5) },
      },
    );
    expect(res.ok).toBe(false);
  });

  it('warns when no part contributes a bbox', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'bbox_envelope', size: { x: 10, y: 10, z: 10 } },
    ]);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]!.severity).toBe('warning');
    expect(res.ok).toBe(true);
  });
});

// ─── part_count_limit ────────────────────────────────────────────────────

describe('checkAssemblyConstraints — part_count_limit', () => {
  it('passes when count equals the limit (≤ is allowed)', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'part_count_limit', max: 2 },
    ]);
    expect(res.ok).toBe(true);
  });

  it('fails when count exceeds the limit', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
      makePart('p3'),
    ]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'part_count_limit', max: 2 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.violations[0]!.actual).toBe(3);
    expect(res.violations[0]!.limit).toBe(2);
  });

  it('passes for an empty assembly with max=0', () => {
    const state = makeAssembly([]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'part_count_limit', max: 0 },
    ]);
    expect(res.ok).toBe(true);
  });
});

// ─── manufacturing_volume_min ────────────────────────────────────────────

describe('checkAssemblyConstraints — manufacturing_volume_min', () => {
  it('passes when every part meets the minimum volume', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'manufacturing_volume_min', minMm3: 100 }],
      { featureTrees: { p1: boxTree(5) } }, // 500 mm³
    );
    expect(res.ok).toBe(true);
  });

  it('fails per-part when a part is below the minimum', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'manufacturing_volume_min', minMm3: 200 }],
      { featureTrees: { p1: boxTree(5), p2: boxTree(1) } }, // 500, 100
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]!.severity).toBe('error');
    expect(res.violations[0]!.detail).toContain('p2');
  });

  it('warns per-part when volume cannot be measured', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]);
    // p1 has a tree, p2 does not.
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'manufacturing_volume_min', minMm3: 50 }],
      { featureTrees: { p1: boxTree(5) } },
    );
    const warnings = res.violations.filter((v) => v.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.detail).toContain('p2');
    expect(res.ok).toBe(true);
  });

  it('reports multiple per-part errors for the same constraint', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'manufacturing_volume_min', minMm3: 1000 }],
      { featureTrees: { p1: boxTree(5), p2: boxTree(5) } }, // both 500
    );
    expect(res.violations).toHaveLength(2);
    expect(res.violations.every((v) => v.severity === 'error')).toBe(true);
  });
});

// ─── cost_limit ──────────────────────────────────────────────────────────

describe('checkAssemblyConstraints — cost_limit', () => {
  it('passes when material cost stays under the budget', () => {
    // 500 mm³ aluminum × 0.0001 USD/mm³ = $0.05
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'cost_limit', maxCurrency: 1, currency: 'USD' }],
      { featureTrees: { p1: boxTree(5) }, materials: { p1: 'aluminum' } },
    );
    expect(res.ok).toBe(true);
  });

  it('fails when material cost exceeds budget in USD', () => {
    // 100_000 mm³ titanium × 0.002 USD/mm³ = $200
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'cost_limit', maxCurrency: 50, currency: 'USD' }],
      { featureTrees: { p1: boxTree(1000) }, materials: { p1: 'titanium' } },
    );
    expect(res.ok).toBe(false);
    expect(res.violations[0]!.severity).toBe('error');
    expect(res.violations[0]!.actual).toBeCloseTo(200, 0);
  });

  it('honours FX conversion for non-USD currencies', () => {
    // 500 mm³ aluminum × 0.0001 = $0.05 → ≈ 67.5 KRW. Limit = 10 KRW fails.
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'cost_limit', maxCurrency: 10, currency: 'KRW' }],
      { featureTrees: { p1: boxTree(5) }, materials: { p1: 'aluminum' } },
    );
    expect(res.ok).toBe(false);
    expect(res.violations[0]!.actual).toBeCloseTo(
      500 *
        DEFAULT_COST_RATES_USD_PER_MM3.aluminum! *
        DEFAULT_FX_PER_USD.KRW,
      2,
    );
  });

  it('warns when no part contributes both volume + costed material', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    // No tree → no volume → no cost contribution.
    const res = checkAssemblyConstraints(state, [
      { kind: 'cost_limit', maxCurrency: 100, currency: 'USD' },
    ]);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]!.severity).toBe('warning');
  });

  it('warns when FX rate is unknown', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'cost_limit', maxCurrency: 1, currency: 'EUR' }],
      {
        featureTrees: { p1: boxTree(5) },
        materials: { p1: 'aluminum' },
        fxRates: { EUR: 0 }, // bad rate
      },
    );
    expect(res.violations[0]!.severity).toBe('warning');
  });

  it('honours costRatesUsdPerMm3 override', () => {
    // Override aluminum to a huge rate to push the cost over budget.
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'cost_limit', maxCurrency: 1, currency: 'USD' }],
      {
        featureTrees: { p1: boxTree(5) },
        materials: { p1: 'aluminum' },
        costRatesUsdPerMm3: { aluminum: 1.0 }, // $1/mm³ → $500
      },
    );
    expect(res.ok).toBe(false);
    expect(res.violations[0]!.actual).toBe(500);
  });
});

// ─── material_homogeneity ────────────────────────────────────────────────

describe('checkAssemblyConstraints — material_homogeneity', () => {
  it('passes when every part uses an allowed material', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]);
    const res = checkAssemblyConstraints(
      state,
      [
        {
          kind: 'material_homogeneity',
          allowedMaterials: ['aluminum', 'steel'],
        },
      ],
      {
        featureTrees: { p1: boxTree(5), p2: boxTree(5) },
        materials: { p1: 'aluminum', p2: 'steel' },
      },
    );
    expect(res.ok).toBe(true);
  });

  it('fails per-part for any disallowed material', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]);
    const res = checkAssemblyConstraints(
      state,
      [{ kind: 'material_homogeneity', allowedMaterials: ['aluminum'] }],
      {
        featureTrees: { p1: boxTree(5), p2: boxTree(5) },
        materials: { p1: 'aluminum', p2: 'titanium' },
      },
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]!.actual).toBe('titanium');
    expect(res.violations[0]!.detail).toContain('p2');
  });

  it('treats parts without a material as "unspecified" for the check', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'material_homogeneity', allowedMaterials: ['aluminum'] },
    ]);
    expect(res.ok).toBe(false);
    expect(res.violations[0]!.actual).toBe('unspecified');
  });

  it('passes when "unspecified" is explicitly in the allowed list', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const res = checkAssemblyConstraints(state, [
      {
        kind: 'material_homogeneity',
        allowedMaterials: ['unspecified', 'aluminum'],
      },
    ]);
    expect(res.ok).toBe(true);
  });
});

// ─── multi-constraint orchestration ──────────────────────────────────────

describe('checkAssemblyConstraints — multi-constraint orchestration', () => {
  it('accumulates violations across multiple constraints', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
      makePart('p3'),
    ]);
    const res = checkAssemblyConstraints(
      state,
      [
        { kind: 'part_count_limit', max: 1 }, // fails (count = 3)
        { kind: 'bbox_envelope', size: { x: 1, y: 1, z: 1 } }, // fails (10x10x5)
      ],
      { featureTrees: { p1: boxTree(5) } },
    );
    expect(res.violations.length).toBeGreaterThanOrEqual(2);
    expect(res.ok).toBe(false);
  });

  it('keeps ok=true when only warnings are produced', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    // No feature trees → mass + bbox + volume all unmeasurable → warnings.
    const res = checkAssemblyConstraints(state, [
      { kind: 'total_mass_limit', maxGrams: 1 },
      { kind: 'bbox_envelope', size: { x: 1, y: 1, z: 1 } },
      { kind: 'manufacturing_volume_min', minMm3: 100 },
    ]);
    expect(res.violations.every((v) => v.severity === 'warning')).toBe(true);
    expect(res.ok).toBe(true);
  });

  it('flips ok=false when any single violation is an error', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'part_count_limit', max: 5 }, // pass
      { kind: 'part_count_limit', max: 1 }, // fail
    ]);
    expect(res.ok).toBe(false);
    expect(res.violations).toHaveLength(1);
  });

  it('emits the same kind ordering as the input constraints array', () => {
    const state = makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
      makePart('p3'),
    ]);
    const res = checkAssemblyConstraints(state, [
      { kind: 'part_count_limit', max: 1 }, // fail @ 0
      { kind: 'part_count_limit', max: 0 }, // fail @ 1
    ]);
    expect(res.violations.map((v) => v.constraintIndex)).toEqual([0, 1]);
  });
});

// ─── purity / determinism ────────────────────────────────────────────────

describe('checkAssemblyConstraints — purity', () => {
  it('does not mutate the input state or constraints array', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const constraints: AssemblyConstraint[] = [
      { kind: 'part_count_limit', max: 5 },
    ];
    const stateSnap = JSON.stringify(state);
    const constraintsSnap = JSON.stringify(constraints);
    checkAssemblyConstraints(state, constraints);
    expect(JSON.stringify(state)).toBe(stateSnap);
    expect(JSON.stringify(constraints)).toBe(constraintsSnap);
  });

  it('produces stable output on repeated invocation', () => {
    const state = makeAssembly([makePart('p1', { fixed: true })]);
    const r1 = checkAssemblyConstraints(
      state,
      [{ kind: 'total_mass_limit', maxGrams: 0.01 }],
      { featureTrees: { p1: boxTree(5) }, materials: { p1: 'steel' } },
    );
    const r2 = checkAssemblyConstraints(
      state,
      [{ kind: 'total_mass_limit', maxGrams: 0.01 }],
      { featureTrees: { p1: boxTree(5) }, materials: { p1: 'steel' } },
    );
    expect(r1).toEqual(r2);
  });
});
