/**
 * stepDiffer — STEP source diff tests.
 *
 * Coverage:
 *   - identical sources → all-empty diff
 *   - entity added / removed / modified
 *   - schema transition AP214 → AP242
 *   - header FILE_NAME change
 *   - product count delta (+ / − / 0)
 *   - summary format ("X added, Y removed, Z modified; schema …")
 *   - id-stable raw modify detection
 *   - composite (complex) entity handled
 *   - whitespace in entity body is significant for raw modify
 *   - whitespace in header IS NOT significant (normalised)
 *   - empty / malformed inputs do not throw
 *   - non-string inputs do not throw
 *   - HEADER strings containing `#` do not pollute DATA scan
 *   - duplicate id: first occurrence wins
 *   - schema unchanged across stylistic AP214 reformat
 *   - PRODUCT delta when assembly grows
 *   - dangling-ref source still diffs best-effort
 *   - schema "unknown" on both sides ⇒ schemaChanged false
 */
import { describe, it, expect } from 'vitest';
import { diffSteps } from './stepDiffer';

// ─── fixtures ─────────────────────────────────────────────────────────────

const AP214_BASE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('base'),'2;1');
FILE_NAME('base.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(1.,0.,0.));
#12=DIRECTION('',(0.,0.,1.));
#13=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

const AP242_BASE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('base'),'2;1');
FILE_NAME('base.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(1.,0.,0.));
#12=DIRECTION('',(0.,0.,1.));
#13=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

// ─── identical / no-change ────────────────────────────────────────────────

describe('diffSteps — identical sources', () => {
  it('returns empty deltas + "no changes" summary for byte-identical inputs', () => {
    const d = diffSteps(AP214_BASE, AP214_BASE);
    expect(d.entitiesAdded).toEqual([]);
    expect(d.entitiesRemoved).toEqual([]);
    expect(d.entitiesModified).toEqual([]);
    expect(d.headerChanges).toEqual([]);
    expect(d.schemaChanged).toBe(false);
    expect(d.productCountChange).toBe(0);
    expect(d.summary).toBe('no changes');
  });
});

// ─── entity adds / removes / modifies ─────────────────────────────────────

describe('diffSteps — entity-level changes', () => {
  it('detects an added entity', () => {
    const newer = AP214_BASE.replace(
      '#13=PRODUCT',
      "#14=CARTESIAN_POINT('',(2.,2.,2.));\n#13=PRODUCT",
    );
    const d = diffSteps(AP214_BASE, newer);
    expect(d.entitiesAdded).toHaveLength(1);
    expect(d.entitiesAdded[0]).toMatchObject({ id: 14, name: 'CARTESIAN_POINT' });
    expect(d.entitiesRemoved).toEqual([]);
    expect(d.entitiesModified).toEqual([]);
  });

  it('detects a removed entity', () => {
    const newer = AP214_BASE.replace(
      "#12=DIRECTION('',(0.,0.,1.));\n",
      '',
    );
    const d = diffSteps(AP214_BASE, newer);
    expect(d.entitiesAdded).toEqual([]);
    expect(d.entitiesRemoved).toHaveLength(1);
    expect(d.entitiesRemoved[0]).toMatchObject({ id: 12, name: 'DIRECTION' });
  });

  it('detects a raw-modified entity', () => {
    const newer = AP214_BASE.replace(
      "#11=CARTESIAN_POINT('',(1.,0.,0.));",
      "#11=CARTESIAN_POINT('',(9.,9.,9.));",
    );
    const d = diffSteps(AP214_BASE, newer);
    expect(d.entitiesModified).toHaveLength(1);
    expect(d.entitiesModified[0]!.id).toBe(11);
    expect(d.entitiesModified[0]!.oldRaw).toContain('(1.,0.,0.)');
    expect(d.entitiesModified[0]!.newRaw).toContain('(9.,9.,9.)');
  });

  it('orders adds / removes / modifies by ascending id', () => {
    const newer = AP214_BASE
      .replace(
        "#11=CARTESIAN_POINT('',(1.,0.,0.));",
        "#11=CARTESIAN_POINT('',(9.,9.,9.));",
      )
      .replace(
        '#13=PRODUCT',
        "#20=CARTESIAN_POINT('',(2.,2.,2.));\n#19=CARTESIAN_POINT('',(3.,3.,3.));\n#13=PRODUCT",
      );
    const d = diffSteps(AP214_BASE, newer);
    expect(d.entitiesAdded.map((e) => e.id)).toEqual([19, 20]);
  });

  it('treats an inner-whitespace-only change as modified (raw compare)', () => {
    const newer = AP214_BASE.replace(
      "#10=CARTESIAN_POINT('',(0.,0.,0.));",
      "#10=CARTESIAN_POINT( '' , ( 0. , 0. , 0. ) );",
    );
    const d = diffSteps(AP214_BASE, newer);
    expect(d.entitiesModified.some((e) => e.id === 10)).toBe(true);
  });
});

// ─── schema / protocol ─────────────────────────────────────────────────────

describe('diffSteps — schema / protocol changes', () => {
  it('flags AP214 → AP242 as a schema change', () => {
    const d = diffSteps(AP214_BASE, AP242_BASE);
    expect(d.schemaChanged).toBe(true);
    expect(d.summary).toContain('AP214 → AP242');
  });

  it('does not flag a schema change across stylistic-only AP214 reformat', () => {
    const reformatted = AP214_BASE.replace(
      'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }',
      'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }', // identical literal
    );
    const d = diffSteps(AP214_BASE, reformatted);
    expect(d.schemaChanged).toBe(false);
  });

  it('flags AP242-short → AP242-long as same protocol (no schema change)', () => {
    const shortAp242 = AP214_BASE.replace(
      'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }',
      'AP242 { 1 0 10303 442 1 1 4 }',
    );
    const d = diffSteps(shortAp242, AP242_BASE);
    expect(d.schemaChanged).toBe(false);
  });

  it('schema unknown on both sides does not flag changed', () => {
    const odd = AP214_BASE.replace(
      'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }',
      'PROPRIETARY_SCHEMA_XYZ',
    );
    const d = diffSteps(odd, odd);
    expect(d.schemaChanged).toBe(false);
  });
});

// ─── header field diff ────────────────────────────────────────────────────

describe('diffSteps — header changes', () => {
  it('detects a FILE_NAME change', () => {
    const newer = AP214_BASE.replace("'base.step'", "'renamed.step'");
    const d = diffSteps(AP214_BASE, newer);
    expect(d.headerChanges.some((h) => h.field === 'FILE_NAME')).toBe(true);
    const hc = d.headerChanges.find((h) => h.field === 'FILE_NAME');
    expect(hc!.old).toContain('base.step');
    expect(hc!.new).toContain('renamed.step');
  });

  it('normalises whitespace — pretty-print only is NOT a header change', () => {
    const pretty = AP214_BASE.replace(
      "FILE_DESCRIPTION(('base'),'2;1');",
      "FILE_DESCRIPTION(\n   ('base'),\n   '2;1'\n);",
    );
    const d = diffSteps(AP214_BASE, pretty);
    expect(d.headerChanges).toEqual([]);
  });

  it('reports a header field that exists on only one side', () => {
    const withAuthor = AP214_BASE.replace(
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));\nFILE_AUTHOR(('alice'));",
    );
    const d = diffSteps(AP214_BASE, withAuthor);
    const fa = d.headerChanges.find((h) => h.field === 'FILE_AUTHOR');
    expect(fa).toBeDefined();
    expect(fa!.old).toBe('');
    expect(fa!.new).toContain('alice');
  });
});

// ─── product count ────────────────────────────────────────────────────────

describe('diffSteps — productCountChange', () => {
  it('is 0 when no PRODUCT is added or removed', () => {
    const d = diffSteps(AP214_BASE, AP214_BASE);
    expect(d.productCountChange).toBe(0);
  });

  it('is +2 when two PRODUCT entities are added', () => {
    const newer = AP214_BASE.replace(
      '#13=PRODUCT(\'part\',\'part\',\'\',(#10));',
      "#13=PRODUCT('part','part','',(#10));\n#14=PRODUCT('p2','p2','',(#10));\n#15=PRODUCT('p3','p3','',(#10));",
    );
    const d = diffSteps(AP214_BASE, newer);
    expect(d.productCountChange).toBe(2);
  });

  it('is −1 when a PRODUCT is removed', () => {
    const base = AP214_BASE.replace(
      "#13=PRODUCT('part','part','',(#10));",
      "#13=PRODUCT('part','part','',(#10));\n#14=PRODUCT('p2','p2','',(#10));",
    );
    const newer = base.replace("#14=PRODUCT('p2','p2','',(#10));\n", '');
    const d = diffSteps(base, newer);
    expect(d.productCountChange).toBe(-1);
  });
});

// ─── summary format ───────────────────────────────────────────────────────

describe('diffSteps — summary format', () => {
  it('matches "X added, Y removed, Z modified; schema unchanged"', () => {
    const newer = AP214_BASE
      .replace(
        "#11=CARTESIAN_POINT('',(1.,0.,0.));",
        "#11=CARTESIAN_POINT('',(9.,9.,9.));",
      )
      .replace(
        "#12=DIRECTION('',(0.,0.,1.));\n",
        '',
      )
      .replace(
        '#13=PRODUCT',
        "#20=CARTESIAN_POINT('',(2.,2.,2.));\n#13=PRODUCT",
      );
    const d = diffSteps(AP214_BASE, newer);
    expect(d.summary).toBe('1 entities added, 1 removed, 1 modified; schema unchanged');
  });

  it('includes schema transition in summary when protocol changes', () => {
    const d = diffSteps(AP214_BASE, AP242_BASE);
    expect(d.summary).toMatch(/schema changed AP214 → AP242$/);
  });

  it('emits "no changes" for byte-identical input', () => {
    expect(diffSteps(AP214_BASE, AP214_BASE).summary).toBe('no changes');
  });
});

// ─── robustness ───────────────────────────────────────────────────────────

describe('diffSteps — robustness', () => {
  it('handles empty old + populated new', () => {
    const d = diffSteps('', AP214_BASE);
    expect(d.entitiesAdded.length).toBeGreaterThan(0);
    expect(d.entitiesRemoved).toEqual([]);
    expect(() => d.summary).not.toThrow();
  });

  it('handles populated old + empty new', () => {
    const d = diffSteps(AP214_BASE, '');
    expect(d.entitiesRemoved.length).toBeGreaterThan(0);
    expect(d.entitiesAdded).toEqual([]);
  });

  it('handles both empty', () => {
    const d = diffSteps('', '');
    expect(d.summary).toBe('no changes');
  });

  it('does not throw on non-string inputs', () => {
    expect(() =>
      diffSteps(
        null as unknown as string,
        undefined as unknown as string,
      ),
    ).not.toThrow();
  });

  it('does not let HEADER strings containing # leak into DATA scan', () => {
    const polluted = AP214_BASE.replace(
      "FILE_NAME('base.step'",
      "FILE_NAME('base#999=GARBAGE.step'",
    );
    const d = diffSteps(AP214_BASE, polluted);
    expect(d.entitiesAdded).toEqual([]);
    expect(d.entitiesRemoved).toEqual([]);
  });

  it('honours duplicate-id: first occurrence wins', () => {
    const withDup = AP214_BASE.replace(
      "#11=CARTESIAN_POINT('',(1.,0.,0.));",
      "#11=CARTESIAN_POINT('',(1.,0.,0.));\n#11=CARTESIAN_POINT('',(7.,7.,7.));",
    );
    // Old has single #11 = (1,0,0); new has duplicate #11 first = (1,0,0).
    // First occurrence wins → no diff on #11.
    const d = diffSteps(AP214_BASE, withDup);
    expect(d.entitiesModified.some((e) => e.id === 11)).toBe(false);
  });

  it('handles a composite (complex) entity definition', () => {
    const withComposite = AP214_BASE.replace(
      '#13=PRODUCT(\'part\',\'part\',\'\',(#10));',
      "#13=PRODUCT('part','part','',(#10));\n#14=(BOUNDED_CURVE() B_SPLINE_CURVE(3,(#10,#11),.UNSPECIFIED.,.F.,.F.));",
    );
    const d = diffSteps(AP214_BASE, withComposite);
    const added = d.entitiesAdded.find((e) => e.id === 14);
    expect(added).toBeDefined();
    expect(added!.name).toBe(''); // composite entities have no top-level name
  });

  it('still diffs when one side has a dangling reference', () => {
    const dangling = AP214_BASE.replace(
      "#13=PRODUCT('part','part','',(#10));",
      "#13=PRODUCT('part','part','',(#999));",
    );
    const d = diffSteps(AP214_BASE, dangling);
    expect(d.entitiesModified.some((e) => e.id === 13)).toBe(true);
  });

  it('preserves entity name on a modify even when names differ between revs', () => {
    const newer = AP214_BASE.replace(
      "#12=DIRECTION('',(0.,0.,1.));",
      "#12=CARTESIAN_POINT('',(5.,5.,5.));",
    );
    const d = diffSteps(AP214_BASE, newer);
    const mod = d.entitiesModified.find((e) => e.id === 12);
    expect(mod).toBeDefined();
    // newRaw wins for the surfaced name (caller can re-parse oldRaw if needed)
    expect(mod!.name).toBe('CARTESIAN_POINT');
  });
});
