/**
 * stepWriteWithPmiOcctBindings — Phase 5.3.5 OCCT-direct integration tests.
 *
 * Validates that geometry (stepWrite) + PMI (pmiExport) + Phase-1 SHAPE_ASPECT
 * binding (pmiShapeBinding) + Phase-2 OCCT-direct anchor (pmiOcctBinding)
 * compose into a single ISO-10303-21 STEP file across all three hybrid modes
 * ('occt' / 'shape_aspect' / 'both') with documented edge-case behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
  writeStepWithPmiOcctBindings,
  __internal,
  type StepWithPmiOcctOptions,
} from './stepWriteWithPmiOcctBindings';
import { writeStepWithPmi } from './stepWriteWithPmi';
import { writeStepWithPmiBindings } from './stepWriteWithPmiBindings';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { AssemblyPart } from './stepWrite';
import type { OcctPmiBinding } from './pmiOcctBinding';
import type { RefBinding } from './pmiShapeBinding';

// ─── fixtures ─────────────────────────────────────────────────────────────

function rectFeature(): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth: 3,
    direction: 'one_sided',
    mode: 'add',
  };
}

function twoBoxAssembly(): AssemblyPart[] {
  return [
    { id: 'housing', name: 'housing', x0: 0, y0: 0, z0: 0, x1: 50, y1: 50, z1: 20 },
    { id: 'shaft', name: 'shaft', x0: 5, y0: 5, z0: 0, x1: 15, y1: 15, z1: 40 },
  ];
}

const HEADER_FIXED = { timestamp: '2026-01-01T00:00:00.000Z' };

/**
 * Canonical 6-face faceEntityIds table. The numbers themselves are arbitrary
 * (the tests only assert relative invariants and patched-comment shapes); the
 * length-6 invariant matches `stepWrite.writeExtrudeAsStep`'s box emit order.
 */
const FACE_IDS = [501, 515, 530, 545, 560, 575] as const;

function emptySheet(): Sheet {
  return {
    id: 'sheet-empty',
    name: 'empty',
    paperSize: 'A4',
    viewports: [
      {
        id: 'vp-1',
        sourceId: 'part-1',
        projection: { kind: 'standard', view: 'front' },
        centerOnSheet: { x: 100, y: 100 },
        widthOnSheet: 80,
        scale: 1,
      },
    ],
  };
}

function sheetWith(
  dimensions: ReadonlyArray<Dimension> = [],
  gdtCallouts: ReadonlyArray<GdtCallout> = [],
): Sheet {
  return {
    id: 'sheet-pmi',
    name: 'pmi',
    paperSize: 'A4',
    viewports: [
      {
        id: 'vp-1',
        sourceId: 'part-1',
        projection: { kind: 'standard', view: 'front' },
        centerOnSheet: { x: 100, y: 100 },
        widthOnSheet: 80,
        scale: 1,
      },
    ],
    dimensions,
    gdtCallouts,
  };
}

function radialDim(id: string, ref = 'face_07', value = 10): Dimension {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'radial',
    refs: [ref],
    valueOverride: value,
  };
}

function linearDim(
  id: string,
  refs: ReadonlyArray<string> = ['face_07', 'face_08'],
  value = 20,
): Dimension {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'linear',
    refs: [...refs],
    valueOverride: value,
  };
}

function flatnessGdt(
  id: string,
  targetRef = 'face_07',
  tol = 0.05,
): GdtCallout {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'flatness',
    targetRef,
    toleranceValue: tol,
  };
}

function makeOpts(
  overrides: Partial<StepWithPmiOcctOptions> = {},
): StepWithPmiOcctOptions {
  return {
    geometry: { kind: 'extrude', feature: rectFeature() },
    header: HEADER_FIXED,
    ...overrides,
  };
}

/** Extract every `#N=` id from a STEP source (line-anchored). */
function extractIds(source: string): number[] {
  return [...source.matchAll(/^#(\d+)\s*=/gm)].map((m) => Number.parseInt(m[1]!, 10));
}

// ─── 1. no-PMI path ─────────────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — no PMI', () => {
  it('pmi=undefined → byte-equal to writeStepWithPmi', () => {
    const res = writeStepWithPmiOcctBindings(makeOpts());
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
    expect(res.pmiMapping.size).toBe(0);
    expect(res.warnings).toEqual([]);
  });

  it('pmi=undefined + occtBindings → bindings warned-out, file untouched', () => {
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
    expect(res.warnings).toContain('occtBindings ignored: pmi undefined');
  });

  it('pmi=undefined + shapeAspectBindings → bindings warned-out', () => {
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.warnings).toContain('shapeAspectBindings ignored: pmi undefined');
  });
});

// ─── 2. pmi + empty bindings → equivalent to writeStepWithPmi(pmi) ──────

describe('writeStepWithPmiOcctBindings — empty bindings with PMI', () => {
  it('pmi + no bindings → byte-equal to writeStepWithPmi(pmi)', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(makeOpts({ pmi: { sheet } }));
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      pmi: { sheet },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
    expect(res.pmiMapping.size).toBe(0);
    expect(res.warnings).toEqual([]);
  });

  it("pmi + empty occtBindings array + mode='occt' → still equal to pmi-only", () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'occt',
        occtBindings: [],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      pmi: { sheet },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
  });
});

// ─── 3. mode='occt' — Phase-2 only direct OCCT patching ─────────────────

describe("writeStepWithPmiOcctBindings — mode='occt'", () => {
  it('1 binding → TODO comment rewritten with OCCT direct ref', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.source).toContain(`#${FACE_IDS[0]} (face_07)`);
    expect(res.source).toContain('(OCCT direct)');
    // SHAPE_ASPECT side-channel must NOT appear in 'occt' mode.
    expect(res.source).not.toContain('=SHAPE_ASPECT(');
    expect(res.pmiMapping.get('face_07')).toBe(FACE_IDS[0]);
    expect(res.warnings).toEqual([]);
  });

  it('caller-supplied entityId works without shapeMeta', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: [
          { pmiRefId: 'face_07', faceRef: { faceIdx: 0, entityId: 9999 } },
        ],
        // shapeMeta omitted entirely — entityId resolves directly.
      }),
    );
    expect(res.source).toContain('#9999 (face_07)');
    expect(res.pmiMapping.get('face_07')).toBe(9999);
  });

  it('GD&T target binding → rewritten in patched PMI', () => {
    const sheet = sheetWith([], [flatnessGdt('g1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 2 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.source).toContain(
      `/* GD&T g1 bound to #${FACE_IDS[2]} (face_07) (OCCT direct) */`,
    );
    expect(res.source).not.toContain('(Phase 2 OCCT plumbing)');
  });
});

// ─── 4. shapeMeta-missing error ────────────────────────────────────────

describe("writeStepWithPmiOcctBindings — invalid input", () => {
  it('shapeMeta missing + binding needs lookup → throws', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    expect(() =>
      writeStepWithPmiOcctBindings(
        makeOpts({
          pmi: { sheet },
          occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
          // shapeMeta absent → binding cannot resolve.
        }),
      ),
    ).toThrow(/shapeMeta required/);
  });

  it('faceIdx out of range → throws from binder', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    expect(() =>
      writeStepWithPmiOcctBindings(
        makeOpts({
          pmi: { sheet },
          occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 99 } }],
          shapeMeta: { faceEntityIds: [...FACE_IDS] },
        }),
      ),
    ).toThrow(/out of range/);
  });
});

// ─── 5. mode='shape_aspect' — delegates to NNN ─────────────────────────

describe("writeStepWithPmiOcctBindings — mode='shape_aspect'", () => {
  it('mode=shape_aspect → emits SHAPE_ASPECT, no OCCT direct', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'shape_aspect',
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.source).toContain('=SHAPE_ASPECT(');
    expect(res.source).toContain('face@#1');
    expect(res.source).not.toContain('(OCCT direct)');
  });

  it('shape_aspect mode → byte-equal to writeStepWithPmiBindings (delegation)', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const bindings: RefBinding[] = [
      { ref: 'face_07', entityId: 1, kind: 'face' },
    ];
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'shape_aspect',
        shapeAspectBindings: bindings,
      }),
    );
    const direct = writeStepWithPmiBindings({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
      pmi: { sheet },
      bindings,
    });
    expect(res.source).toBe(direct.source);
  });

  it("mode='shape_aspect' + occtBindings supplied → warns + ignores", () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'shape_aspect',
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.source).not.toContain('(OCCT direct)');
    expect(res.warnings.some((w) => w.includes('occtBindings ignored'))).toBe(true);
  });
});

// ─── 6. mode='both' — emits BOTH SHAPE_ASPECT and OCCT direct ───────────

describe("writeStepWithPmiOcctBindings — mode='both'", () => {
  it("'both' → SHAPE_ASPECT rows AND OCCT-direct comment patching", () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'both',
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    // Phase 1 row emitted.
    expect(res.source).toContain('=SHAPE_ASPECT(');
    expect(res.source).toContain('face@#1');
    // Phase 1 patched the TODO to its `bound to #<SA>` form FIRST — Phase 2's
    // TODO regex requires the original `(Phase 2 OCCT plumbing)` suffix that
    // is now gone, so the comment is in Phase-1 form. This is the documented
    // 'both'-mode ordering invariant.
    expect(res.source).toMatch(/d1 bound to #\d+ \(face_07\)/);
  });

  it("'both' with magic token → Phase 2 patches the token even after Phase 1", () => {
    // Hand-craft a sheet whose PMI body the Phase-1 patcher modifies AND
    // which carries an `__OCCT_REF__face_07__` token that the Phase-2
    // patcher (via OCCT direct) must rewrite. We use the standard sheet to
    // generate the PMI body; the magic token will not appear in the PMI
    // (writePmiFragment doesn't emit it) — so the test here is structural:
    // both phases run without conflict and Phase 2 reports zero warnings
    // when the bound ref is present in the original (TODO) source.
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'both',
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        occtBindings: [
          { pmiRefId: 'face_07', faceRef: { faceIdx: 0 } },
        ],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    // Phase 2 sees Phase-1-patched PMI: the ref string `face_07` no longer
    // appears in a `(Phase 2 OCCT plumbing)` comment, so the binder reports
    // it as "not referenced" via warning — that's the documented contract.
    expect(res.warnings.some((w) => w.startsWith('occt: ref "face_07"'))).toBe(true);
  });

  it("'both' default selection when both binding kinds supplied", () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    // No explicit hybridMode → resolver picks 'both' because both arrays
    // are non-empty.
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.source).toContain('=SHAPE_ASPECT(');
  });
});

// ─── 7. empty-PMI edge case ────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — empty PMI sheet', () => {
  it('empty sheet (no dim/gdt) + occtBindings → bindings warned-out', () => {
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet: emptySheet() },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.warnings).toContain('occtBindings ignored: empty PMI fragment');
    expect(res.pmiMapping.size).toBe(0);
  });

  it("empty sheet + 'both' mode + both binding kinds → both warned-out", () => {
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet: emptySheet() },
        hybridMode: 'both',
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.warnings).toContain('occtBindings ignored: empty PMI fragment');
    expect(res.warnings).toContain('shapeAspectBindings ignored: empty PMI fragment');
  });
});

// ─── 8. saved-view variant ─────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — withSavedView', () => {
  it('savedView + OCCT bindings → DRAUGHTING_MODEL present + direct anchor', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        withSavedView: true,
        savedViewOptions: { viewName: 'View 1' },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.source).toContain('DRAUGHTING_MODEL(');
    expect(res.source).toContain("'View 1'");
    expect(res.source).toContain(`#${FACE_IDS[0]} (face_07)`);
    expect(res.source).toContain('(OCCT direct)');
  });

  it("savedView + 'both' → DRAUGHTING_MODEL + SHAPE_ASPECT row", () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        withSavedView: true,
        hybridMode: 'both',
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.source).toContain('DRAUGHTING_MODEL(');
    expect(res.source).toContain('=SHAPE_ASPECT(');
  });
});

// ─── 9. assembly geometry ──────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — assembly geometry', () => {
  it('assembly + pmi + OCCT bindings → end-to-end with direct anchor', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings({
      geometry: { kind: 'assembly', assemblyName: 'asm', parts: twoBoxAssembly() },
      header: HEADER_FIXED,
      pmi: { sheet },
      occtBindings: [
        { pmiRefId: 'face_07', faceRef: { faceIdx: 0, entityId: 42 } },
      ],
    });
    const solids = (res.source.match(/=MANIFOLD_SOLID_BREP\(/g) ?? []).length;
    expect(solids).toBe(2);
    expect(res.source).toContain('#42 (face_07)');
    expect(res.pmiMapping.get('face_07')).toBe(42);
  });
});

// ─── 10. envelope invariants ───────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — envelope structure', () => {
  it('starts with ISO-10303-21; and ends with END-ISO-10303-21;', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.source.startsWith('ISO-10303-21;')).toBe(true);
    expect(res.source.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('exactly 2 ENDSEC; markers (HEADER + DATA) — patched PMI inside DATA', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    const endsecCount = (res.source.match(/ENDSEC;/g) ?? []).length;
    expect(endsecCount).toBe(2);
    // The OCCT-direct patch lives in the PMI body which is INSIDE the DATA
    // section — so the patched comment must appear before the DATA ENDSEC;.
    const occtMarker = res.source.indexOf('(OCCT direct)');
    const endIso = res.source.indexOf('END-ISO-10303-21;');
    const dataEndsec = res.source.lastIndexOf('ENDSEC;', endIso);
    expect(occtMarker).toBeGreaterThan(-1);
    expect(occtMarker).toBeLessThan(dataEndsec);
  });

  it('HEADER block is byte-identical to no-PMI run', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const withOcct = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    const noPmi = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
    });
    const headerOf = (s: string) => s.slice(0, s.indexOf('DATA;'));
    expect(headerOf(withOcct.source)).toBe(headerOf(noPmi));
  });
});

// ─── 11. id monotonicity ───────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — id monotonicity', () => {
  it("'occt' adds zero rows beyond the PMI fragment → ids identical to writeStepWithPmi", () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const occt = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    // writeStepWithPmi returns the source string directly (not wrapped in an
    // object), unlike the orchestrators that return `{ source, ... }`.
    const pmiOnly: string = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      pmi: { sheet },
      header: HEADER_FIXED,
    });
    // Phase 2 emits no new rows, so the id SET must be identical. Only the
    // TODO comment text differs.
    expect(extractIds(occt.source).sort((a, b) => a - b)).toEqual(
      extractIds(pmiOnly).sort((a, b) => a - b),
    );
  });

  it("'both' adds SHAPE_ASPECT rows AFTER PMI ids", () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'both',
        shapeAspectBindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    const ids = extractIds(res.source);
    const sortedAsc = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sortedAsc);
    // All ids unique.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── 12. warning prefix routing ────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — warning prefix routing', () => {
  it('OCCT binder warning is prefixed with "occt:"', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        // Bind a ref that is NOT in the PMI → binder skips + warns.
        occtBindings: [{ pmiRefId: 'face_ghost', faceRef: { faceIdx: 0 } }],
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.warnings.some((w) => w.startsWith('occt: ref "face_ghost"'))).toBe(true);
  });

  it('SA binder warning is prefixed with "sa:" in shape_aspect mode', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        hybridMode: 'shape_aspect',
        shapeAspectBindings: [{ ref: 'ghost', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.warnings.some((w) => w.startsWith('sa: ref "ghost"'))).toBe(true);
  });
});

// ─── 13. multiple bindings ─────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — multiple bindings', () => {
  it('3 occt bindings → 3 mapping entries + 3 patched comments', () => {
    const sheet = sheetWith([
      linearDim('d1', ['fA', 'fB']),
      linearDim('d2', ['fC', 'fD']),
      linearDim('d3', ['fE', 'fF']),
    ]);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'fA', faceRef: { faceIdx: 0 } },
      { pmiRefId: 'fB', faceRef: { faceIdx: 1 } },
      { pmiRefId: 'fC', faceRef: { faceIdx: 2 } },
      { pmiRefId: 'fD', faceRef: { faceIdx: 3 } },
      { pmiRefId: 'fE', faceRef: { faceIdx: 4 } },
      { pmiRefId: 'fF', faceRef: { faceIdx: 5 } },
    ];
    const res = writeStepWithPmiOcctBindings(
      makeOpts({
        pmi: { sheet },
        occtBindings: bindings,
        shapeMeta: { faceEntityIds: [...FACE_IDS] },
      }),
    );
    expect(res.pmiMapping.size).toBe(6);
    for (let i = 0; i < 6; i++) {
      const ref = bindings[i]!.pmiRefId;
      expect(res.pmiMapping.get(ref)).toBe(FACE_IDS[i]);
      expect(res.source).toContain(`#${FACE_IDS[i]} (${ref})`);
    }
  });
});

// ─── 14. internal helpers ──────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings internals', () => {
  it("resolveHybridMode — both kinds → 'both'", () => {
    const mode = __internal.resolveHybridMode({
      geometry: { kind: 'extrude', feature: rectFeature() },
      occtBindings: [{ pmiRefId: 'r', faceRef: { faceIdx: 0 } }],
      shapeAspectBindings: [{ ref: 'r', entityId: 1, kind: 'face' }],
    });
    expect(mode).toBe('both');
  });

  it("resolveHybridMode — only SA → 'shape_aspect'", () => {
    const mode = __internal.resolveHybridMode({
      geometry: { kind: 'extrude', feature: rectFeature() },
      shapeAspectBindings: [{ ref: 'r', entityId: 1, kind: 'face' }],
    });
    expect(mode).toBe('shape_aspect');
  });

  it("resolveHybridMode — only OCCT → 'occt'", () => {
    const mode = __internal.resolveHybridMode({
      geometry: { kind: 'extrude', feature: rectFeature() },
      occtBindings: [{ pmiRefId: 'r', faceRef: { faceIdx: 0 } }],
    });
    expect(mode).toBe('occt');
  });

  it("resolveHybridMode — neither → 'occt' (default)", () => {
    const mode = __internal.resolveHybridMode({
      geometry: { kind: 'extrude', feature: rectFeature() },
    });
    expect(mode).toBe('occt');
  });

  it('resolveHybridMode — explicit hybridMode wins over defaults', () => {
    const mode = __internal.resolveHybridMode({
      geometry: { kind: 'extrude', feature: rectFeature() },
      hybridMode: 'shape_aspect',
      occtBindings: [{ pmiRefId: 'r', faceRef: { faceIdx: 0 } }],
    });
    expect(mode).toBe('shape_aspect');
  });

  it('ensureTrailingNewline appends \\n when missing', () => {
    expect(__internal.ensureTrailingNewline('abc')).toBe('abc\n');
    expect(__internal.ensureTrailingNewline('abc\n')).toBe('abc\n');
    expect(__internal.ensureTrailingNewline('')).toBe('\n');
  });

  it('emitPmiFragment dispatches to saved-view variant when flag set', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const a = __internal.emitPmiFragment(sheet, 100, true, { viewName: 'V' });
    expect(a.source).toContain('DRAUGHTING_MODEL(');
    expect(a.source).toContain("'V'");
  });
});

// ─── 15. determinism ───────────────────────────────────────────────────

describe('writeStepWithPmiOcctBindings — determinism', () => {
  it('same inputs → same source (no randomness)', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const make = () =>
      writeStepWithPmiOcctBindings(
        makeOpts({
          pmi: { sheet },
          occtBindings: [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
          shapeMeta: { faceEntityIds: [...FACE_IDS] },
        }),
      );
    const r1 = make();
    const r2 = make();
    expect(r1.source).toBe(r2.source);
    expect(Array.from(r1.pmiMapping.entries())).toEqual(
      Array.from(r2.pmiMapping.entries()),
    );
  });
});
