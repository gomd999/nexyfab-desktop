/**
 * pmiOcctBinding — Phase 5.3 Phase 2 (deep) direct-OCCT binding tests.
 *
 * Round-trips through the REAL `writePmiFragment` emitter wherever possible
 * so the placeholder shapes we patch are guaranteed to match the upstream
 * format, rather than drifting against hand-rolled fixtures.
 */
import { describe, it, expect } from 'vitest';
import { writePmiFragment } from './pmiExport';
import {
  bindPmiToOcctFace,
  __internal,
  type OcctPmiBinding,
} from './pmiOcctBinding';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';

// ─── fixture helpers ──────────────────────────────────────────────────────

function makeSheet(opts: {
  dimensions?: ReadonlyArray<Dimension>;
  gdtCallouts?: ReadonlyArray<GdtCallout>;
} = {}): Sheet {
  return {
    id: 'sheet-occt',
    name: 'OCCT Bind Test',
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

/** Canonical 6-face box-style faceEntityIds (matches stepWrite's emit order). */
const BOX_FACES = [501, 515, 530, 545, 560, 575] as const;

// ─── empty / no-op ────────────────────────────────────────────────────────

describe('bindPmiToOcctFace — empty bindings', () => {
  it('empty bindings → patched == source, empty mapping', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToOcctFace(frag.source, [], {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.patched).toBe(frag.source);
    expect(res.source).toBe(frag.source);
    expect(res.mapping.size).toBe(0);
    expect(res.warnings).toEqual([]);
  });

  it('empty bindings on empty PMI → empty everywhere', () => {
    const res = bindPmiToOcctFace('', [], { faceEntityIds: [...BOX_FACES] });
    expect(res.patched).toBe('');
    expect(res.source).toBe('');
    expect(res.mapping.size).toBe(0);
  });
});

// ─── single binding ──────────────────────────────────────────────────────

describe('bindPmiToOcctFace — single binding', () => {
  it('1 binding → faceIdx 0 → entityId mapping', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const frag = writePmiFragment(sheet, 100);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'face_07', faceRef: { faceIdx: 0 } },
    ];
    const res = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.mapping.get('face_07')).toBe(BOX_FACES[0]);
    expect(res.warnings).toEqual([]);
    expect(res.patched).toContain(`#${BOX_FACES[0]} (face_07)`);
    expect(res.patched).toContain('(OCCT direct)');
    // Original Phase-1 TODO comment must be gone for the resolved ref.
    expect(res.patched).not.toContain(
      'dimension dim-lin-1 refs: face_07, face_08 (Phase 2 OCCT plumbing)',
    );
  });

  it('caller-supplied entityId overrides faceEntityIds lookup', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const frag = writePmiFragment(sheet, 100);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'face_07', faceRef: { faceIdx: 0, entityId: 9999 } },
    ];
    const res = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.mapping.get('face_07')).toBe(9999);
    expect(res.patched).toContain(`#9999 (face_07)`);
  });

  it('faceIdx 5 (top face) → last entityId', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_top'] })] });
    const frag = writePmiFragment(sheet, 100);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'face_top', faceRef: { faceIdx: 5 } },
    ];
    const res = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.mapping.get('face_top')).toBe(BOX_FACES[5]);
    expect(res.patched).toContain(`#${BOX_FACES[5]} (face_top)`);
  });
});

// ─── multiple bindings ───────────────────────────────────────────────────

describe('bindPmiToOcctFace — 5 bindings mixed faceIdx', () => {
  it('5 bindings → distinct entityIds in patched output', () => {
    const dims: Dimension[] = [
      linearDim({ id: 'd1', refs: ['fA', 'fB'] }),
      linearDim({ id: 'd2', refs: ['fC', 'fD'] }),
      linearDim({ id: 'd3', refs: ['fE'] }),
    ];
    const sheet = makeSheet({ dimensions: dims });
    const frag = writePmiFragment(sheet, 100);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'fA', faceRef: { faceIdx: 0 } },
      { pmiRefId: 'fB', faceRef: { faceIdx: 1 } },
      { pmiRefId: 'fC', faceRef: { faceIdx: 2 } },
      { pmiRefId: 'fD', faceRef: { faceIdx: 3 } },
      { pmiRefId: 'fE', faceRef: { faceIdx: 4 } },
    ];
    const res = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.mapping.size).toBe(5);
    expect(res.mapping.get('fA')).toBe(BOX_FACES[0]);
    expect(res.mapping.get('fB')).toBe(BOX_FACES[1]);
    expect(res.mapping.get('fC')).toBe(BOX_FACES[2]);
    expect(res.mapping.get('fD')).toBe(BOX_FACES[3]);
    expect(res.mapping.get('fE')).toBe(BOX_FACES[4]);
    // Each entity ref appears in the patched output.
    for (const [refId, eid] of res.mapping) {
      expect(res.patched).toContain(`#${eid} (${refId})`);
    }
    expect(res.warnings).toEqual([]);
  });
});

// ─── placeholder substitution accuracy ───────────────────────────────────

describe('bindPmiToOcctFace — placeholder substitution', () => {
  it('GD&T target placeholder → exact #N rewrite', () => {
    const sheet = makeSheet({ gdtCallouts: [flatnessGdt()] });
    const frag = writePmiFragment(sheet, 100);
    expect(frag.source).toContain(
      '/* GD&T gdt-flt-1 target: face_07 (Phase 2 OCCT plumbing) */',
    );
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'face_07', faceRef: { faceIdx: 2 } },
    ];
    const res = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.patched).toContain(
      `/* GD&T gdt-flt-1 bound to #${BOX_FACES[2]} (face_07) (OCCT direct) */`,
    );
    // Original Phase-1 comment gone.
    expect(res.patched).not.toContain(
      '/* GD&T gdt-flt-1 target: face_07 (Phase 2 OCCT plumbing) */',
    );
  });

  it('dimension partial resolve — resolved + unresolved both surfaced', () => {
    const sheet = makeSheet({
      dimensions: [linearDim({ refs: ['face_07', 'face_99'] })],
    });
    const frag = writePmiFragment(sheet, 100);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'face_07', faceRef: { faceIdx: 0 } },
      // 'face_99' is NOT bound — should appear in the unresolved tail.
    ];
    const res = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.patched).toContain(
      `/* dimension dim-lin-1 bound to #${BOX_FACES[0]} (face_07) (unresolved: face_99) (OCCT direct) */`,
    );
  });

  it('magic-token __OCCT_REF__<id>__ → exact #N rewrite', () => {
    // We craft a snippet that includes BOTH a TODO comment (so the ref is
    // discoverable) AND a magic token in an actual entity slot.
    const snippet =
      `/* GD&T g1 target: refA (Phase 2 OCCT plumbing) */\n` +
      `#100=FLATNESS_TOLERANCE('g1','flatness',#50,__OCCT_REF__refA__);\n`;
    const res = bindPmiToOcctFace(
      snippet,
      [{ pmiRefId: 'refA', faceRef: { faceIdx: 1 } }],
      { faceEntityIds: [...BOX_FACES] },
    );
    expect(res.patched).toContain(
      `#100=FLATNESS_TOLERANCE('g1','flatness',#50,#${BOX_FACES[1]});`,
    );
    expect(res.patched).not.toContain('__OCCT_REF__refA__');
  });

  it('magic token in source but NOT in TODO comment is still patched if ref bound', () => {
    // Token discovery scans both comments AND tokens, so a token-only ref
    // is still considered "referenced" by the source.
    const snippet = `#100=DIMENSIONAL_SIZE(__OCCT_REF__faceX__,'d1');`;
    const res = bindPmiToOcctFace(
      snippet,
      [{ pmiRefId: 'faceX', faceRef: { faceIdx: 0 } }],
      { faceEntityIds: [...BOX_FACES] },
    );
    expect(res.patched).toBe(
      `#100=DIMENSIONAL_SIZE(#${BOX_FACES[0]},'d1');`,
    );
    expect(res.mapping.get('faceX')).toBe(BOX_FACES[0]);
    expect(res.warnings).toEqual([]);
  });
});

// ─── out-of-range / invalid input ────────────────────────────────────────

describe('bindPmiToOcctFace — invalid input', () => {
  it('faceIdx out of range → throws', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const frag = writePmiFragment(sheet, 100);
    expect(() =>
      bindPmiToOcctFace(
        frag.source,
        [{ pmiRefId: 'face_07', faceRef: { faceIdx: 10 } }],
        { faceEntityIds: [...BOX_FACES] },
      ),
    ).toThrow(/out of range/);
  });

  it('negative faceIdx → throws', () => {
    expect(() =>
      bindPmiToOcctFace(
        '',
        [{ pmiRefId: 'r', faceRef: { faceIdx: -1 } }],
        { faceEntityIds: [...BOX_FACES] },
      ),
    ).toThrow(/non-negative integer/);
  });

  it('non-integer faceIdx → throws', () => {
    expect(() =>
      bindPmiToOcctFace(
        '',
        [{ pmiRefId: 'r', faceRef: { faceIdx: 1.5 } }],
        { faceEntityIds: [...BOX_FACES] },
      ),
    ).toThrow(/non-negative integer/);
  });

  it('zero entityId override → throws', () => {
    expect(() =>
      bindPmiToOcctFace(
        '',
        [{ pmiRefId: 'r', faceRef: { faceIdx: 0, entityId: 0 } }],
        { faceEntityIds: [...BOX_FACES] },
      ),
    ).toThrow(/positive integer/);
  });

  it('shapeMeta.faceEntityIds not an array → throws', () => {
    // Cast through `unknown` so the runtime guard inside `bindPmiToOcctFace`
    // is exercised — TypeScript would otherwise reject the call at compile
    // time. We're intentionally testing the JS-runtime defensive branch.
    const badMeta = { faceEntityIds: 'oops' } as unknown as {
      faceEntityIds: ReadonlyArray<number>;
    };
    expect(() =>
      bindPmiToOcctFace('', [{ pmiRefId: 'r', faceRef: { faceIdx: 0 } }], badMeta),
    ).toThrow(/must be an array/);
  });
});

// ─── coalescing + warnings ───────────────────────────────────────────────

describe('bindPmiToOcctFace — coalescing + warnings', () => {
  it('duplicate pmiRefId → first wins', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'face_07', faceRef: { faceIdx: 0 } },
      { pmiRefId: 'face_07', faceRef: { faceIdx: 3 } },
    ];
    const res = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(res.mapping.get('face_07')).toBe(BOX_FACES[0]);
    expect(res.patched).toContain(`#${BOX_FACES[0]} (face_07)`);
    expect(res.patched).not.toContain(`#${BOX_FACES[3]} (face_07)`);
  });

  it('binding for ref not in PMI source → warning, no mapping entry', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToOcctFace(
      frag.source,
      [
        { pmiRefId: 'face_07', faceRef: { faceIdx: 0 } },
        { pmiRefId: 'face_ghost', faceRef: { faceIdx: 1 } },
      ],
      { faceEntityIds: [...BOX_FACES] },
    );
    expect(res.mapping.size).toBe(1);
    expect(res.mapping.get('face_07')).toBe(BOX_FACES[0]);
    expect(res.warnings).toContain(
      'ref "face_ghost" not referenced by any PMI item — skipped',
    );
  });

  it('all bindings unreferenced → patched == source', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ refs: ['face_07'] })] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToOcctFace(
      frag.source,
      [{ pmiRefId: 'face_ghost', faceRef: { faceIdx: 0 } }],
      { faceEntityIds: [...BOX_FACES] },
    );
    expect(res.patched).toBe(frag.source);
    expect(res.mapping.size).toBe(0);
    expect(res.warnings.length).toBe(1);
  });
});

// ─── internal helpers (whitebox) ─────────────────────────────────────────

describe('pmiOcctBinding internals', () => {
  it('resolveEntityId — caller entityId takes priority over lookup', () => {
    const id = __internal.resolveEntityId({ faceIdx: 0, entityId: 42 }, [100, 200]);
    expect(id).toBe(42);
  });

  it('resolveEntityId — lookup used when entityId absent', () => {
    const id = __internal.resolveEntityId({ faceIdx: 1 }, [100, 200]);
    expect(id).toBe(200);
  });

  it('collectReferencedRefs — picks up dimension + GD&T + magic tokens', () => {
    const src =
      `/* dimension d1 refs: r1, r2 (Phase 2 OCCT plumbing) */\n` +
      `/* GD&T g1 target: r3 (Phase 2 OCCT plumbing) */\n` +
      `#42=DIMENSIONAL_SIZE(__OCCT_REF__r4__,'d2');\n`;
    const refs = __internal.collectReferencedRefs(src);
    expect(refs.has('r1')).toBe(true);
    expect(refs.has('r2')).toBe(true);
    expect(refs.has('r3')).toBe(true);
    expect(refs.has('r4')).toBe(true);
    expect(refs.size).toBe(4);
  });

  it('escapeRegex — escapes all metacharacters', () => {
    const esc = __internal.escapeRegex('a.b+c*d?e^f$g{h}i(j)k|l[m]n\\o');
    // After escape, every metachar should be preceded by backslash. Sanity:
    // running a RegExp built from `esc` against the original string should
    // match at offset 0.
    const re = new RegExp(esc);
    expect(re.test('a.b+c*d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(true);
    // And should NOT match a string where the literal `.` is replaced.
    expect(re.test('aXb+c*d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(false);
  });
});

// ─── round-trip determinism ──────────────────────────────────────────────

describe('bindPmiToOcctFace — determinism', () => {
  it('same inputs → same patched output (no randomness)', () => {
    const sheet = makeSheet({
      dimensions: [linearDim()],
      gdtCallouts: [flatnessGdt()],
    });
    const frag = writePmiFragment(sheet, 100);
    const bindings: OcctPmiBinding[] = [
      { pmiRefId: 'face_07', faceRef: { faceIdx: 0 } },
      { pmiRefId: 'face_08', faceRef: { faceIdx: 1 } },
    ];
    const r1 = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    const r2 = bindPmiToOcctFace(frag.source, bindings, {
      faceEntityIds: [...BOX_FACES],
    });
    expect(r1.patched).toBe(r2.patched);
    expect(Array.from(r1.mapping.entries())).toEqual(
      Array.from(r2.mapping.entries()),
    );
  });

  it('source field is untouched (byte-for-byte)', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const frag = writePmiFragment(sheet, 100);
    const res = bindPmiToOcctFace(
      frag.source,
      [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
      { faceEntityIds: [...BOX_FACES] },
    );
    expect(res.source).toBe(frag.source);
    // Patched MUST differ from source when a binding resolved.
    expect(res.patched).not.toBe(frag.source);
  });
});
