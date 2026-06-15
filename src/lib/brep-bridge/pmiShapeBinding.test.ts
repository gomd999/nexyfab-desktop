/**
 * pmiShapeBinding — Phase 5.3 Phase 2 shape-binding tests.
 *
 * Round-trips through `writePmiFragment` / `writePmiFragmentWithSavedView`
 * so the TODO comment shape consumed by the patcher is verified against the
 * REAL emitter output (no hand-rolled fixtures that could drift).
 */
import { describe, it, expect } from 'vitest';
import {
  writePmiFragment,
  writePmiFragmentWithSavedView,
} from './pmiExport';
import {
  bindPmiToShape,
  __internal,
  type RefBinding,
} from './pmiShapeBinding';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';

// ─── fixture helpers ──────────────────────────────────────────────────────

function makeSheet(opts: {
  dimensions?: ReadonlyArray<Dimension>;
  gdtCallouts?: ReadonlyArray<GdtCallout>;
} = {}): Sheet {
  return {
    id: 'sheet-bind',
    name: 'Binding Test',
    paperSize: 'A3',
    viewports: [
      {
        id: 'vp-1',
        sourceId: 'part-1',
        projection: { kind: 'standard', view: 'front' },
        centerOnSheet: { x: 100, y: 100 },
        widthOnSheet: 150,
        scale: 1,
      },
    ],
    dimensions: opts.dimensions,
    gdtCallouts: opts.gdtCallouts,
  };
}

function linearDim(overrides: Partial<Dimension> = {}): Dimension {
  return {
    id: 'dim-lin-1',
    viewportId: 'vp-1',
    kind: 'linear',
    refs: ['face_07', 'face_08'],
    valueOverride: 20,
    ...overrides,
  } as Dimension;
}

function flatnessGdt(overrides: Partial<GdtCallout> = {}): GdtCallout {
  return {
    id: 'gdt-flt-1',
    viewportId: 'vp-1',
    kind: 'flatness',
    targetRef: 'face_07',
    toleranceValue: 0.05,
    ...overrides,
  };
}

// ─── tests: empty / no-op ─────────────────────────────────────────────────

describe('bindPmiToShape — empty bindings', () => {
  it('empty bindings → identical patched + empty additionalSource', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [],
      pmiFragment: frag,
      startEntityId: frag.lastEntityId + 1,
    });
    expect(res.additionalSource).toBe('');
    expect(res.patchedPmi).toBe(frag.source);
    expect(res.mapping.size).toBe(0);
    expect(res.lastEntityId).toBe(frag.lastEntityId); // startId-1
    expect(res.warnings).toEqual([]);
  });

  it('empty bindings + empty PMI → empty everywhere', () => {
    const sheet = makeSheet();
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [],
      pmiFragment: frag,
      startEntityId: 200,
    });
    expect(res.additionalSource).toBe('');
    expect(res.patchedPmi).toBe('');
    expect(res.mapping.size).toBe(0);
    expect(res.lastEntityId).toBe(199);
  });
});

// ─── tests: single binding ────────────────────────────────────────────────

describe('bindPmiToShape — single binding', () => {
  it('1 face binding → 1 SHAPE_ASPECT emitted, mapping has 1 entry', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    // linearDim normally needs 2 refs, but `validateDimension` is not called
    // by writePmiFragment — we sidestep it to test the binding logic with
    // exactly one ref to keep assertions tight.
    const frag = writePmiFragment(sheet, 100);
    const bindings: RefBinding[] = [
      { ref: 'face_07', entityId: 7423, kind: 'face' },
    ];
    const res = bindPmiToShape({
      bindings,
      pmiFragment: frag,
      startEntityId: frag.lastEntityId + 1,
    });
    expect(res.additionalSource).toContain('SHAPE_ASPECT(');
    expect(res.additionalSource).toContain("'face_07'");
    expect(res.additionalSource).toContain('face@#7423');
    // SHAPE_ASPECT gets the FIRST allocated id (startEntityId), which is
    // frag.lastEntityId + 1. The SHAPE_DEFINITION_REPRESENTATION gets +2.
    expect(res.mapping.get('face_07')).toBe(frag.lastEntityId + 1);
    expect(res.mapping.size).toBe(1);
    expect(res.warnings).toEqual([]);
  });

  it('emits SHAPE_DEFINITION_REPRESENTATION linking SA → geometry', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [{ ref: 'face_07', entityId: 7423, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.additionalSource).toContain('SHAPE_DEFINITION_REPRESENTATION(');
    // SA is #500, geometry is #7423 → wired explicitly.
    expect(res.additionalSource).toMatch(
      /SHAPE_DEFINITION_REPRESENTATION\(#500,#7423\)/,
    );
  });
});

// ─── tests: multiple bindings ─────────────────────────────────────────────

describe('bindPmiToShape — multiple bindings', () => {
  it('2 bindings (face + edge) → 2 SHAPE_ASPECTs', () => {
    const sheet = makeSheet({
      dimensions: [linearDim()], // refs: face_07, face_08
      gdtCallouts: [flatnessGdt({ targetRef: 'edge_42' })],
    });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_07', entityId: 100, kind: 'face' },
        { ref: 'edge_42', entityId: 200, kind: 'edge' },
      ],
      pmiFragment: frag,
      startEntityId: 500,
    });
    // 2 SHAPE_ASPECTs.
    const saMatches = res.additionalSource.match(/SHAPE_ASPECT\(/g);
    expect(saMatches?.length).toBe(2);
    expect(res.additionalSource).toContain('face@#100');
    expect(res.additionalSource).toContain('edge@#200');
    expect(res.mapping.size).toBe(2);
  });

  it('same ref appears in multiple PMI items → exactly 1 SHAPE_ASPECT', () => {
    const sheet = makeSheet({
      // Same ref 'face_07' used in dim AND gdt target.
      dimensions: [linearDim({ refs: ['face_07', 'face_07'] })],
      gdtCallouts: [flatnessGdt({ targetRef: 'face_07' })],
    });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [{ ref: 'face_07', entityId: 999, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: 500,
    });
    const saMatches = res.additionalSource.match(/SHAPE_ASPECT\(/g);
    expect(saMatches?.length).toBe(1);
    // Patched PMI should reference the SAME id everywhere face_07 appeared.
    const allMentions = [...res.patchedPmi.matchAll(/#500 \(face_07\)/g)];
    // dim comment has TWO face_07 refs → joined into one bound comment with
    // both bindings. GD&T comment has ONE → also one mention. So at least
    // 2 occurrences across both comments.
    expect(allMentions.length).toBeGreaterThanOrEqual(2);
  });

  it('duplicate bindings (first-wins) → 1 SHAPE_ASPECT', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_07', entityId: 1, kind: 'face' },
        // Duplicate ref — should be ignored.
        { ref: 'face_07', entityId: 2, kind: 'face' },
      ],
      pmiFragment: frag,
      startEntityId: 500,
    });
    const saMatches = res.additionalSource.match(/SHAPE_ASPECT\(/g);
    expect(saMatches?.length).toBe(1);
    // First binding wins → entityId 1 referenced.
    expect(res.additionalSource).toContain('face@#1');
    expect(res.additionalSource).not.toContain('face@#2');
  });
});

// ─── tests: warnings / skip ───────────────────────────────────────────────

describe('bindPmiToShape — skip + warnings', () => {
  it('binding ref not present in PMI → skipped + warning emitted', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_99', entityId: 999, kind: 'face' }, // not in PMI
      ],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.mapping.has('face_99')).toBe(false);
    expect(res.mapping.size).toBe(0);
    expect(res.additionalSource).toBe('');
    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0]).toContain('face_99');
  });

  it('mixed present + absent bindings → only present emitted', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_07', entityId: 1, kind: 'face' },
        { ref: 'ghost', entityId: 2, kind: 'face' },
      ],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.mapping.size).toBe(1);
    expect(res.mapping.has('face_07')).toBe(true);
    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0]).toContain('ghost');
  });
});

// ─── tests: patching ──────────────────────────────────────────────────────

describe('bindPmiToShape — TODO patching', () => {
  it('dimension TODO comment is rewritten to reference SHAPE_ASPECT', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    expect(frag.source).toContain('(Phase 2 OCCT plumbing)');
    const res = bindPmiToShape({
      bindings: [{ ref: 'face_07', entityId: 7423, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.patchedPmi).not.toMatch(
      /dimension dim-lin-1 refs: face_07 \(Phase 2 OCCT plumbing\)/,
    );
    expect(res.patchedPmi).toContain('dim-lin-1 bound to #500 (face_07)');
  });

  it('GD&T TODO comment is rewritten to reference SHAPE_ASPECT', () => {
    const sheet = makeSheet({ gdtCallouts: [flatnessGdt()] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [{ ref: 'face_07', entityId: 7423, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.patchedPmi).not.toContain('(Phase 2 OCCT plumbing)');
    expect(res.patchedPmi).toContain('GD&T gdt-flt-1 bound to #500 (face_07)');
  });

  it('partial resolution → resolved + unresolved both surfaced', () => {
    const sheet = makeSheet({
      dimensions: [linearDim({ refs: ['face_07', 'face_99'] })],
    });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.patchedPmi).toContain('bound to #500 (face_07)');
    expect(res.patchedPmi).toContain('unresolved: face_99');
  });

  it('no resolved refs → original TODO comment preserved verbatim', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [{ ref: 'no-match', entityId: 1, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.patchedPmi).toBe(frag.source);
    expect(res.patchedPmi).toContain('(Phase 2 OCCT plumbing)');
  });
});

// ─── tests: entity id ordering ────────────────────────────────────────────

describe('bindPmiToShape — entity id ordering', () => {
  it('startEntityId honoured; ids are consecutive', () => {
    const sheet = makeSheet({
      dimensions: [linearDim()],
      gdtCallouts: [flatnessGdt({ targetRef: 'edge_42' })],
    });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_07', entityId: 1, kind: 'face' },
        { ref: 'edge_42', entityId: 2, kind: 'edge' },
      ],
      pmiFragment: frag,
      startEntityId: 800,
    });
    // 1st binding: SA #800 + SDR #801. 2nd: SA #802 + SDR #803.
    expect(res.mapping.get('face_07')).toBe(800);
    expect(res.mapping.get('edge_42')).toBe(802);
    expect(res.lastEntityId).toBe(803);
  });

  it('lastEntityId == startEntityId-1 when nothing emitted', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [{ ref: 'face_99', entityId: 1, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: 777,
    });
    expect(res.lastEntityId).toBe(776);
    expect(res.mapping.size).toBe(0);
  });
});

// ─── tests: kind variants ─────────────────────────────────────────────────

describe('bindPmiToShape — kind tagging', () => {
  it('face/edge/vertex kinds → distinct descriptions in SHAPE_ASPECT', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({ id: 'd1', refs: ['face_07'] }),
        linearDim({ id: 'd2', refs: ['edge_42'] }),
        linearDim({ id: 'd3', refs: ['vertex_3'] }),
      ],
    });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_07', entityId: 1, kind: 'face' },
        { ref: 'edge_42', entityId: 2, kind: 'edge' },
        { ref: 'vertex_3', entityId: 3, kind: 'vertex' },
      ],
      pmiFragment: frag,
      startEntityId: 500,
    });
    expect(res.additionalSource).toContain('face@#1');
    expect(res.additionalSource).toContain('edge@#2');
    expect(res.additionalSource).toContain('vertex@#3');
  });

  it('invalid kind → throws', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    expect(() =>
      bindPmiToShape({
        // Cast through unknown — the public type forbids 'curve', which is
        // exactly the guard we're exercising.
        bindings: [
          { ref: 'face_07', entityId: 1, kind: 'curve' as unknown as RefBinding['kind'] },
        ],
        pmiFragment: frag,
        startEntityId: 500,
      }),
    ).toThrow(/unknown kind/);
  });

  it('invalid entityId (non-integer) → throws', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    expect(() =>
      bindPmiToShape({
        bindings: [{ ref: 'face_07', entityId: 1.5, kind: 'face' }],
        pmiFragment: frag,
        startEntityId: 500,
      }),
    ).toThrow(/invalid entityId/);
  });

  it('invalid startEntityId → throws', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    expect(() =>
      bindPmiToShape({
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        pmiFragment: frag,
        startEntityId: 0,
      }),
    ).toThrow(/startEntityId/);
  });
});

// ─── tests: round-trip with saved-view variant ────────────────────────────

describe('bindPmiToShape — round-trip', () => {
  it('writePmiFragment → bindPmiToShape → combined source contains all entities', () => {
    const sheet = makeSheet({
      dimensions: [linearDim()],
      gdtCallouts: [flatnessGdt()],
    });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_07', entityId: 1, kind: 'face' },
        { ref: 'face_08', entityId: 2, kind: 'face' },
      ],
      pmiFragment: frag,
      startEntityId: frag.lastEntityId + 1,
    });
    const combined = res.patchedPmi + res.additionalSource;
    // Geometry hints + new entities both present.
    expect(combined).toContain('DIMENSIONAL_SIZE(');
    expect(combined).toContain('FLATNESS_TOLERANCE(');
    expect(combined).toContain('SHAPE_ASPECT(');
    expect(combined).toContain('SHAPE_DEFINITION_REPRESENTATION(');
    // No TODO comments survive for resolved refs.
    expect(combined).not.toContain(
      'dimension dim-lin-1 refs: face_07, face_08 (Phase 2 OCCT plumbing)',
    );
  });

  it('writePmiFragmentWithSavedView → bindPmiToShape preserves saved-view', () => {
    const sheet = makeSheet({
      dimensions: [linearDim({ refs: ['face_07'] })],
    });
    const frag = writePmiFragmentWithSavedView(sheet, 100, {
      viewName: 'Manuf View 1',
    });
    expect(frag.source).toContain('DRAUGHTING_MODEL(');
    const res = bindPmiToShape({
      bindings: [{ ref: 'face_07', entityId: 7423, kind: 'face' }],
      pmiFragment: frag,
      startEntityId: frag.lastEntityId + 1,
    });
    // Saved-view container still present in patched source.
    expect(res.patchedPmi).toContain('DRAUGHTING_MODEL(');
    expect(res.patchedPmi).toContain('Manuf View 1');
    // Binding artefacts emitted.
    expect(res.additionalSource).toContain('SHAPE_ASPECT(');
    expect(res.mapping.get('face_07')).toBeDefined();
  });

  it('full pipeline: TODO comment ids do not collide with binding ids', () => {
    const sheet = makeSheet({
      dimensions: [linearDim()],
      gdtCallouts: [flatnessGdt()],
    });
    const frag = writePmiFragment(sheet, 100);
    // Start binding ids ABOVE frag.lastEntityId so #N tokens don't collide.
    const res = bindPmiToShape({
      bindings: [
        { ref: 'face_07', entityId: 1, kind: 'face' },
        { ref: 'face_08', entityId: 2, kind: 'face' },
      ],
      pmiFragment: frag,
      startEntityId: frag.lastEntityId + 100,
    });
    // Collect every `#N=` in the combined source — should be unique.
    const combined = res.patchedPmi + res.additionalSource;
    const ids = [...combined.matchAll(/^#(\d+)=/gm)].map((m) => Number(m[1]));
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ─── tests: internal helpers (white-box) ──────────────────────────────────

describe('pmiShapeBinding internals', () => {
  it('collectReferencedRefs picks up dim + GD&T refs', () => {
    const sheet = makeSheet({
      dimensions: [linearDim({ refs: ['face_07', 'face_08'] })],
      gdtCallouts: [flatnessGdt({ targetRef: 'edge_42' })],
    });
    const frag = writePmiFragment(sheet, 100);
    const found = __internal.collectReferencedRefs(frag.source);
    expect(found.has('face_07')).toBe(true);
    expect(found.has('face_08')).toBe(true);
    expect(found.has('edge_42')).toBe(true);
    expect(found.size).toBe(3);
  });

  it('collectReferencedRefs returns empty for empty source', () => {
    const found = __internal.collectReferencedRefs('');
    expect(found.size).toBe(0);
  });

  it('patchTodoComments no-op when mapping is empty', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const frag = writePmiFragment(sheet, 100);
    const patched = __internal.patchTodoComments(frag.source, new Map());
    expect(patched).toBe(frag.source);
  });

  it('esc doubles single quotes', () => {
    expect(__internal.esc("o'brien")).toBe("o''brien");
  });
});
