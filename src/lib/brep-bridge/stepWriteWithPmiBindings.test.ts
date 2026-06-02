/**
 * stepWriteWithPmiBindings — full integration orchestrator tests.
 *
 * Validates that geometry (stepWrite) + PMI (pmiExport) + shape binding
 * (pmiShapeBinding) compose into a single ISO-10303-21 STEP file with
 *   - non-colliding, monotonically-increasing entity ids,
 *   - all three regions in the canonical order (geom < PMI < SHAPE_ASPECT),
 *   - structural invariants identical to writeStepWithPmi (HEADER/DATA/tail),
 *   - graceful no-op + warning behaviour for the documented edge cases.
 */
import { describe, it, expect } from 'vitest';
import {
  writeStepWithPmiBindings,
  __internal,
  type StepWithPmiBindingsOptions,
} from './stepWriteWithPmiBindings';
import { writeStepWithPmi } from './stepWriteWithPmi';
import { writePmiFragment } from './pmiExport';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { AssemblyPart } from './stepWrite';
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

function pentagonFeature(): ExtrudeFeature {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 10, y: Math.sin(a) * 10 });
  }
  return {
    kind: 'extrude',
    loop: pts,
    depth: 4,
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

/**
 * Single-ref dimension helper — `radial` is the IR kind that validates with
 * exactly one ref (vs `linear` / `aligned` / `angular` which need two). Used
 * to keep tight assertions on "bind one ref → one SHAPE_ASPECT" cases.
 */
function radialDim(id: string, ref = 'face_07', value = 10): Dimension {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'radial',
    refs: [ref],
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
  overrides: Partial<StepWithPmiBindingsOptions> = {},
): StepWithPmiBindingsOptions {
  return {
    geometry: { kind: 'extrude', feature: rectFeature() },
    header: HEADER_FIXED,
    ...overrides,
  };
}

/** Extract every `#N=` id from a STEP source. */
function extractIds(source: string): number[] {
  return [...source.matchAll(/^#(\d+)\s*=/gm)].map((m) => Number.parseInt(m[1]!, 10));
}

// ─── geometry-only / no-PMI paths ─────────────────────────────────────────

describe('writeStepWithPmiBindings — no PMI', () => {
  it('geometry only (no pmi, no bindings) → byte-equal to writeStepWithPmi', () => {
    const res = writeStepWithPmiBindings(makeOpts());
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
    expect(res.pmiMapping.size).toBe(0);
    expect(res.warnings).toEqual([]);
  });

  it('bindings supplied but no pmi → bindings ignored + warning', () => {
    const res = writeStepWithPmiBindings(
      makeOpts({
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
    expect(res.pmiMapping.size).toBe(0);
    expect(res.warnings).toContain('bindings ignored: pmi undefined');
  });
});

// ─── empty bindings → identical to writeStepWithPmi ─────────────────────

describe('writeStepWithPmiBindings — empty bindings', () => {
  it('empty bindings + PMI → byte-equal to writeStepWithPmi(pmi)', () => {
    const sheet = sheetWith([linearDim('d1')]);
    const res = writeStepWithPmiBindings(
      makeOpts({ pmi: { sheet }, bindings: [] }),
    );
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      pmi: { sheet },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
    expect(res.pmiMapping.size).toBe(0);
    expect(res.warnings).toEqual([]);
  });

  it('bindings omitted + PMI → byte-equal to writeStepWithPmi(pmi)', () => {
    const sheet = sheetWith([linearDim('d1')]);
    const res = writeStepWithPmiBindings(makeOpts({ pmi: { sheet } }));
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      pmi: { sheet },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
  });
});

// ─── empty PMI sheet + bindings ──────────────────────────────────────────

describe('writeStepWithPmiBindings — empty PMI sheet', () => {
  it('empty sheet (0 dim, 0 gdt) + no bindings → geometry only', () => {
    const res = writeStepWithPmiBindings(
      makeOpts({ pmi: { sheet: emptySheet() } }),
    );
    const direct = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
    });
    expect(res.source).toBe(direct);
    expect(res.warnings).toEqual([]);
  });

  it('empty sheet + bindings supplied → bindings ignored + warning', () => {
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet: emptySheet() },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.warnings).toContain('bindings ignored: empty PMI fragment');
    expect(res.pmiMapping.size).toBe(0);
  });
});

// ─── single binding ─────────────────────────────────────────────────────

describe('writeStepWithPmiBindings — single face binding', () => {
  it('1 binding → SHAPE_ASPECT present and ids monotonic', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.source).toContain('SHAPE_ASPECT(');
    expect(res.source).toContain("'face_07'");
    expect(res.source).toContain('face@#1');
    expect(res.pmiMapping.get('face_07')).toBeDefined();
    expect(res.warnings).toEqual([]);

    const ids = extractIds(res.source);
    const sortedAscending = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sortedAscending);
  });

  it('1 binding → SHAPE_DEFINITION_REPRESENTATION links SA → geometry id', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 42, kind: 'face' }],
      }),
    );
    expect(res.source).toContain('SHAPE_DEFINITION_REPRESENTATION(');
    // The SDR slot points at #42 (the supplied geometry entity id).
    expect(res.source).toMatch(/SHAPE_DEFINITION_REPRESENTATION\(#\d+,#42\)/);
  });
});

// ─── 3 bindings → 3 SHAPE_ASPECTs ───────────────────────────────────────

describe('writeStepWithPmiBindings — three bindings', () => {
  it('3 unique refs → exactly 3 SHAPE_ASPECT entities', () => {
    const sheet = sheetWith(
      [
        radialDim('d1', 'face_07'),
        radialDim('d2', 'edge_42'),
        radialDim('d3', 'vertex_3'),
      ],
    );
    const bindings: RefBinding[] = [
      { ref: 'face_07', entityId: 11, kind: 'face' },
      { ref: 'edge_42', entityId: 22, kind: 'edge' },
      { ref: 'vertex_3', entityId: 33, kind: 'vertex' },
    ];
    const res = writeStepWithPmiBindings(
      makeOpts({ pmi: { sheet }, bindings }),
    );
    const saCount = (res.source.match(/=SHAPE_ASPECT\(/g) ?? []).length;
    expect(saCount).toBe(3);
    expect(res.pmiMapping.size).toBe(3);
    expect(res.source).toContain('face@#11');
    expect(res.source).toContain('edge@#22');
    expect(res.source).toContain('vertex@#33');
  });
});

// ─── saved-view variant ─────────────────────────────────────────────────

describe('writeStepWithPmiBindings — withSavedView', () => {
  it('withSavedView=true → DRAUGHTING_MODEL container appears', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        withSavedView: true,
        savedViewOptions: { viewName: 'View 1' },
        bindings: [{ ref: 'face_07', entityId: 7, kind: 'face' }],
      }),
    );
    expect(res.source).toContain('DRAUGHTING_MODEL(');
    expect(res.source).toContain("'View 1'");
    expect(res.source).toContain('SHAPE_ASPECT(');
  });

  it('withSavedView=true + empty sheet → wrapper emitted, bindings warned-out', () => {
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet: emptySheet() },
        withSavedView: true,
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    // The saved-view wrapper emits even for empty sheets, so the fragment is
    // NOT empty → we DO splice it; bindings, however, find no TODO comment
    // (empty body) so are warned-out by the binder itself.
    expect(res.source).toContain('DRAUGHTING_MODEL(');
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.some((w) => w.includes('face_07'))).toBe(true);
  });
});

// ─── warnings — ref not in PMI ───────────────────────────────────────────

describe('writeStepWithPmiBindings — warning propagation', () => {
  it('binding ref absent from PMI → warning forwarded from bindPmiToShape', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'ghost', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.pmiMapping.size).toBe(0);
    expect(res.warnings.length).toBeGreaterThanOrEqual(1);
    expect(res.warnings.some((w) => w.includes('ghost'))).toBe(true);
  });

  it('mixed present + absent → only present resolved', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [
          { ref: 'face_07', entityId: 1, kind: 'face' },
          { ref: 'ghost', entityId: 2, kind: 'face' },
        ],
      }),
    );
    expect(res.pmiMapping.has('face_07')).toBe(true);
    expect(res.pmiMapping.has('ghost')).toBe(false);
    expect(res.warnings.some((w) => w.includes('ghost'))).toBe(true);
  });
});

// ─── envelope invariants ────────────────────────────────────────────────

describe('writeStepWithPmiBindings — envelope structure', () => {
  it('starts with ISO-10303-21; and ends with END-ISO-10303-21;', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.source.startsWith('ISO-10303-21;')).toBe(true);
    expect(res.source.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('exactly 2 ENDSEC; markers (HEADER + DATA) — ENDSEC position is correct', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    const endsecCount = (res.source.match(/ENDSEC;/g) ?? []).length;
    expect(endsecCount).toBe(2);

    // ENDSEC for DATA appears AFTER the SHAPE_ASPECT (the SHAPE_ASPECT must
    // be inside the DATA section, not after it).
    const saIdx = res.source.lastIndexOf('SHAPE_ASPECT(');
    const endIso = res.source.indexOf('END-ISO-10303-21;');
    const dataEndsec = res.source.lastIndexOf('ENDSEC;', endIso);
    expect(saIdx).toBeGreaterThan(-1);
    expect(saIdx).toBeLessThan(dataEndsec);
  });

  it('HEADER block is byte-identical to no-PMI run (PMI lives in DATA only)', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const withBindings = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    const noPmi = writeStepWithPmi({
      geometry: { kind: 'extrude', feature: rectFeature() },
      header: HEADER_FIXED,
    });
    const headerOf = (s: string) => s.slice(0, s.indexOf('DATA;'));
    expect(headerOf(withBindings.source)).toBe(headerOf(noPmi));
  });
});

// ─── entity-id region separation (geom < PMI < SHAPE_ASPECT) ─────────────

describe('writeStepWithPmiBindings — entity-id region separation', () => {
  it('geom ids < PMI ids < SHAPE_ASPECT ids (monotonic regions)', () => {
    const sheet = sheetWith(
      [radialDim('d1', 'face_07')],
      [flatnessGdt('g1', 'face_07')],
    );
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    // Carve the source by section markers.
    const pmiMarker = res.source.indexOf('PMI from sheet');
    const saMarker = res.source.indexOf('PMI shape binding');
    expect(pmiMarker).toBeGreaterThan(-1);
    expect(saMarker).toBeGreaterThan(pmiMarker);

    const geomBlock = res.source.slice(0, pmiMarker);
    const pmiBlock = res.source.slice(pmiMarker, saMarker);
    const saBlock = res.source.slice(saMarker);

    // The geometry block also contains the SUPPLIED binding entityId (#1)
    // ONLY as a string-formatted reference inside the SHAPE_ASPECT's
    // description ('face@#1') — NOT as a real `#N=` line. So scanning the
    // geometry block for `^#N=` gives us only the writer-emitted ids.
    const geomIds = extractIds(geomBlock);
    const pmiIds = extractIds(pmiBlock);
    const saIds = extractIds(saBlock);

    expect(geomIds.length).toBeGreaterThan(0);
    expect(pmiIds.length).toBeGreaterThan(0);
    expect(saIds.length).toBeGreaterThan(0);

    const geomMax = Math.max(...geomIds);
    const pmiMin = Math.min(...pmiIds);
    const pmiMax = Math.max(...pmiIds);
    const saMin = Math.min(...saIds);

    expect(geomMax).toBeLessThan(pmiMin);
    expect(pmiMax).toBeLessThan(saMin);
  });

  it('all #N= ids in the final source are unique', () => {
    const sheet = sheetWith(
      [linearDim('d1'), linearDim('d2', ['face_09', 'face_10'], 8)],
      [flatnessGdt('g1', 'face_07'), flatnessGdt('g2', 'face_09', 0.02)],
    );
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [
          { ref: 'face_07', entityId: 1, kind: 'face' },
          { ref: 'face_08', entityId: 2, kind: 'face' },
          { ref: 'face_09', entityId: 3, kind: 'face' },
        ],
      }),
    );
    const ids = extractIds(res.source);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ─── geometry kind coverage ─────────────────────────────────────────────

describe('writeStepWithPmiBindings — geometry kinds', () => {
  it('polygon geometry + PMI + binding works end-to-end', () => {
    const sheet = sheetWith([], [flatnessGdt('g1', 'face_07')]);
    const res = writeStepWithPmiBindings({
      geometry: { kind: 'polygon', feature: pentagonFeature() },
      header: HEADER_FIXED,
      pmi: { sheet },
      bindings: [{ ref: 'face_07', entityId: 5, kind: 'face' }],
    });
    expect(res.source).toContain('FLATNESS_TOLERANCE(');
    expect(res.source).toContain('SHAPE_ASPECT(');
    expect(res.pmiMapping.get('face_07')).toBeDefined();
    // Pentagon → 7 ADVANCED_FACE (5 sides + top + bottom).
    const faces = (res.source.match(/=ADVANCED_FACE\(/g) ?? []).length;
    expect(faces).toBe(7);
  });

  it('assembly geometry + PMI + binding works end-to-end', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings({
      geometry: { kind: 'assembly', assemblyName: 'asm', parts: twoBoxAssembly() },
      header: HEADER_FIXED,
      pmi: { sheet },
      bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
    });
    const solids = (res.source.match(/=MANIFOLD_SOLID_BREP\(/g) ?? []).length;
    expect(solids).toBe(2);
    expect(res.source).toContain('DIMENSIONAL_SIZE(');
    expect(res.source).toContain('SHAPE_ASPECT(');
  });
});

// ─── TODO comment patching propagates through ──────────────────────────

describe('writeStepWithPmiBindings — TODO patching', () => {
  it('resolved dimension TODO comment is rewritten with bound SA ref', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 99, kind: 'face' }],
      }),
    );
    expect(res.source).toContain('d1 bound to');
    expect(res.source).toContain('(face_07)');
    // The TODO marker for face_07 is gone.
    expect(res.source).not.toMatch(
      /dimension d1 refs: face_07 \(Phase 2 OCCT plumbing\)/,
    );
  });

  it('unresolved refs in a partially-resolved dim are surfaced as "unresolved:"', () => {
    const sheet = sheetWith([linearDim('d1', ['face_07', 'face_99'])]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    expect(res.source).toContain('unresolved: face_99');
  });
});

// ─── duplicate bindings / dedup ──────────────────────────────────────────

describe('writeStepWithPmiBindings — duplicate ref handling', () => {
  it('duplicate ref bindings → first wins (only 1 SHAPE_ASPECT)', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [
          { ref: 'face_07', entityId: 11, kind: 'face' },
          { ref: 'face_07', entityId: 22, kind: 'face' },
        ],
      }),
    );
    const saCount = (res.source.match(/=SHAPE_ASPECT\(/g) ?? []).length;
    expect(saCount).toBe(1);
    expect(res.source).toContain('face@#11');
    expect(res.source).not.toContain('face@#22');
  });

  it('same ref used in dim AND gdt → exactly 1 SHAPE_ASPECT', () => {
    const sheet = sheetWith(
      [radialDim('d1', 'face_07')],
      [flatnessGdt('g1', 'face_07')],
    );
    const res = writeStepWithPmiBindings(
      makeOpts({
        pmi: { sheet },
        bindings: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
      }),
    );
    const saCount = (res.source.match(/=SHAPE_ASPECT\(/g) ?? []).length;
    expect(saCount).toBe(1);
  });
});

// ─── internal helpers ───────────────────────────────────────────────────

describe('writeStepWithPmiBindings internals', () => {
  it('ensureTrailingNewline appends \\n when missing', () => {
    expect(__internal.ensureTrailingNewline('abc')).toBe('abc\n');
    expect(__internal.ensureTrailingNewline('abc\n')).toBe('abc\n');
    expect(__internal.ensureTrailingNewline('')).toBe('\n');
  });

  it('emitPmiFragment dispatches to writePmiFragment by default', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const a = __internal.emitPmiFragment(sheet, 100, false, undefined);
    const b = writePmiFragment(sheet, 100);
    expect(a.source).toBe(b.source);
    expect(a.lastEntityId).toBe(b.lastEntityId);
  });

  it('emitPmiFragment dispatches to writePmiFragmentWithSavedView when flag set', () => {
    const sheet = sheetWith([radialDim('d1', 'face_07')]);
    const a = __internal.emitPmiFragment(sheet, 100, true, { viewName: 'V1' });
    expect(a.source).toContain('DRAUGHTING_MODEL(');
    expect(a.source).toContain("'V1'");
  });
});
