/**
 * stepValidator — ISO 10303-21 compliance validator tests.
 *
 * Coverage:
 *   - happy path: valid AP214 box from stepWrite
 *   - marker / section ordering errors
 *   - missing required HEADER entities
 *   - protocol detection (AP203 / AP214 / AP242 long + short)
 *   - unknown schema warning
 *   - entity-id uniqueness + dangling reference
 *   - balance (parens / quotes / comments)
 *   - DATA section absence
 *   - MANIFOLD_SOLID_BREP consistency (CLOSED_SHELL + ADVANCED_FACE)
 *   - PRODUCT recommendation
 *   - empty / whitespace-only input
 *   - non-string input
 *   - false-positive avoidance (strings, comments, escaped quotes)
 */
import { describe, it, expect } from 'vitest';
import { validateStep } from './stepValidator';
import { writeExtrudeAsStep, writeStepHeader } from './stepWrite';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

const BOX_EXTRUDE: ExtrudeFeature = {
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

/** Minimal but compliant skeleton for AP214 — used as the baseline for
 *  negative-test mutations. */
const MIN_AP214 = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('test'),'2;1');
FILE_NAME('t.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(1.,0.,0.));
#12=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

const MIN_AP242_LONG = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('test'),'2;1');
FILE_NAME('t.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

const MIN_AP242_SHORT = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('test'),'2;1');
FILE_NAME('t.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AP242 { 1 0 10303 442 1 1 4 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

const MIN_AP203 = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('test'),'2;1');
FILE_NAME('t.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

// ─── happy path ───────────────────────────────────────────────────────────

describe('validateStep — happy path', () => {
  it('accepts a valid AP214 box emitted by writeExtrudeAsStep', () => {
    const src = writeExtrudeAsStep(BOX_EXTRUDE);
    const r = validateStep(src);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.protocol).toBe('AP214');
    expect(r.schema).toContain('AUTOMOTIVE_DESIGN');
    expect(r.entityCount).toBeGreaterThan(50); // box requires ~80 entities
  });

  it('reports no errors and no warnings on full stepWrite output', () => {
    const src = writeExtrudeAsStep(BOX_EXTRUDE);
    const r = validateStep(src);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]); // PRODUCT entity is emitted
  });

  it('accepts the minimal AP214 skeleton', () => {
    const r = validateStep(MIN_AP214);
    expect(r.ok).toBe(true);
    expect(r.protocol).toBe('AP214');
    expect(r.entityCount).toBe(3);
  });
});

// ─── protocol detection ──────────────────────────────────────────────────

describe('validateStep — protocol detection', () => {
  it('detects AP242 from long-form schema literal', () => {
    const r = validateStep(MIN_AP242_LONG);
    expect(r.ok).toBe(true);
    expect(r.protocol).toBe('AP242');
    expect(r.schema).toContain('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING');
  });

  it('detects AP242 from short AP242 token', () => {
    const r = validateStep(MIN_AP242_SHORT);
    expect(r.ok).toBe(true);
    expect(r.protocol).toBe('AP242');
  });

  it('detects AP203 from CONFIG_CONTROL_DESIGN schema', () => {
    const r = validateStep(MIN_AP203);
    expect(r.ok).toBe(true);
    expect(r.protocol).toBe('AP203');
  });

  it('AP242 wins over AUTOMOTIVE_DESIGN backward-compat tag when both present', () => {
    const src = MIN_AP214.replace(
      `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));`,
      `FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING','AUTOMOTIVE_DESIGN'));`,
    );
    const r = validateStep(src);
    expect(r.protocol).toBe('AP242');
  });

  it('warns when FILE_SCHEMA is unrecognised', () => {
    const src = MIN_AP214.replace(
      `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));`,
      `FILE_SCHEMA(('SOME_PROPRIETARY_SCHEMA'));`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(true); // unknown schema is a warning, not an error
    expect(r.protocol).toBeUndefined();
    expect(r.warnings.some((w) => w.startsWith('unknown_schema'))).toBe(true);
  });
});

// ─── HEADER required entities ────────────────────────────────────────────

describe('validateStep — HEADER required entities', () => {
  it('errors when FILE_DESCRIPTION is missing', () => {
    const src = MIN_AP214.replace(
      `FILE_DESCRIPTION(('test'),'2;1');\n`,
      '',
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('missing_file_description'))).toBe(
      true,
    );
  });

  it('errors when FILE_NAME is missing', () => {
    const src = MIN_AP214.replace(
      `FILE_NAME('t.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');\n`,
      '',
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('missing_file_name'))).toBe(true);
  });

  it('errors when FILE_SCHEMA is missing', () => {
    const src = MIN_AP214.replace(
      `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));\n`,
      '',
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('missing_file_schema'))).toBe(true);
  });
});

// ─── markers & sections ──────────────────────────────────────────────────

describe('validateStep — markers & sections', () => {
  it('errors on empty string', () => {
    const r = validateStep('');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('empty_source'))).toBe(true);
    expect(r.entityCount).toBe(0);
  });

  it('errors on whitespace-only input', () => {
    const r = validateStep('   \n\t  \n');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('empty_source'))).toBe(true);
  });

  it('errors when ISO-10303-21; start marker is missing', () => {
    const src = MIN_AP214.replace('ISO-10303-21;\n', '');
    const r = validateStep(src);
    expect(r.errors.some((e) => e.startsWith('missing_iso_header'))).toBe(true);
  });

  it('errors when END-ISO-10303-21; end marker is missing', () => {
    const src = MIN_AP214.replace('END-ISO-10303-21;\n', '');
    const r = validateStep(src);
    expect(r.errors.some((e) => e.startsWith('missing_end_iso'))).toBe(true);
  });

  it('errors when HEADER; section is missing', () => {
    const src = MIN_AP214.replace('HEADER;\n', '');
    const r = validateStep(src);
    expect(r.errors.some((e) => e.startsWith('missing_header_section'))).toBe(
      true,
    );
  });

  it('errors when DATA; section is missing', () => {
    const src = MIN_AP214.replace('DATA;\n', '');
    const r = validateStep(src);
    expect(r.errors.some((e) => e.startsWith('missing_data_section'))).toBe(
      true,
    );
  });

  it('errors when DATA appears before HEADER (section order)', () => {
    const src = `ISO-10303-21;
DATA;
#10=PRODUCT('','','',(#11));
#11=APPLICATION_CONTEXT('');
ENDSEC;
HEADER;
FILE_DESCRIPTION(('x'),'2;1');
FILE_NAME('','',('',),('',),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
END-ISO-10303-21;`;
    const r = validateStep(src);
    expect(r.errors.some((e) => e.startsWith('section_order'))).toBe(true);
  });

  it('errors when too few ENDSEC; markers are present', () => {
    const src = MIN_AP214.replace(/ENDSEC;\n/g, '').replace(
      'END-ISO-10303-21;',
      'ENDSEC;\nEND-ISO-10303-21;',
    );
    const r = validateStep(src);
    expect(r.errors.some((e) => e.startsWith('endsec_count'))).toBe(true);
  });
});

// ─── entity ids ──────────────────────────────────────────────────────────

describe('validateStep — entity ids', () => {
  it('errors on duplicate entity ids', () => {
    const src = MIN_AP214.replace(
      `#11=CARTESIAN_POINT('',(1.,0.,0.));`,
      `#10=CARTESIAN_POINT('',(1.,0.,0.));`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('duplicate_entity_id'))).toBe(true);
    expect(r.errors.find((e) => e.startsWith('duplicate_entity_id'))).toContain(
      '#10',
    );
  });

  it('errors on dangling reference (#999 not defined)', () => {
    const src = MIN_AP214.replace(
      `#12=PRODUCT('part','part','',(#10));`,
      `#12=PRODUCT('part','part','',(#999));`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('dangling_reference'))).toBe(true);
    expect(r.errors.find((e) => e.startsWith('dangling_reference'))).toContain(
      '#999',
    );
  });

  it('counts the right number of definitions in the DATA block', () => {
    const r = validateStep(MIN_AP214);
    expect(r.entityCount).toBe(3);
  });

  it('does not flag refs that resolve to composite entities', () => {
    // Composite (complex) entity: `#13=( SUB_A() SUB_B() )` has no top-level
    // name but is still a definition.
    const src = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('t'),'2;1');
FILE_NAME('t.step','t',(''),(''),'s','s','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#13=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#14=PRODUCT('p','p','',(#13));
ENDSEC;
END-ISO-10303-21;`;
    const r = validateStep(src);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

// ─── balance ─────────────────────────────────────────────────────────────

describe('validateStep — balance', () => {
  it('errors on unbalanced parens (extra "(")', () => {
    const src = MIN_AP214.replace(
      `#10=CARTESIAN_POINT('',(0.,0.,0.));`,
      `#10=CARTESIAN_POINT('',((0.,0.,0.));`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('unbalanced_parens'))).toBe(true);
  });

  it('errors on unbalanced parens (extra ")")', () => {
    const src = MIN_AP214.replace(
      `#10=CARTESIAN_POINT('',(0.,0.,0.));`,
      `#10=CARTESIAN_POINT('',(0.,0.,0.)));`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('unbalanced_parens'))).toBe(true);
  });

  it('errors on unterminated string literal', () => {
    const src = MIN_AP214.replace(
      `FILE_DESCRIPTION(('test'),'2;1');`,
      `FILE_DESCRIPTION(('unterminated),'2;1');`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('unbalanced_quotes'))).toBe(true);
  });

  it('errors on unterminated /* ... */ comment', () => {
    const src = MIN_AP214.replace(
      'DATA;',
      `DATA;\n/* this comment is never closed\n`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('unterminated_comment'))).toBe(
      true,
    );
  });

  it('accepts escaped single quotes ("" inside a literal)', () => {
    const src = MIN_AP214.replace(
      `FILE_DESCRIPTION(('test'),'2;1');`,
      `FILE_DESCRIPTION(('it''s fine'),'2;1');`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('ignores parens and semicolons that live inside string literals', () => {
    const src = MIN_AP214.replace(
      `FILE_DESCRIPTION(('test'),'2;1');`,
      `FILE_DESCRIPTION(('text with ( and ) and ; inside'),'2;1');`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(true);
  });

  it('ignores #N references that live inside STEP comments', () => {
    const src = MIN_AP214.replace(
      `#12=PRODUCT('part','part','',(#10));`,
      `/* dangling: #999 should NOT be counted */\n#12=PRODUCT('part','part','',(#10));`,
    );
    const r = validateStep(src);
    expect(r.ok).toBe(true);
    expect(r.errors.find((e) => e.startsWith('dangling_reference'))).toBeUndefined();
  });
});

// ─── MANIFOLD_SOLID_BREP consistency ─────────────────────────────────────

describe('validateStep — MANIFOLD_SOLID_BREP consistency', () => {
  it('passes when MANIFOLD_SOLID_BREP + CLOSED_SHELL + ADVANCED_FACE all present', () => {
    const src = writeExtrudeAsStep(BOX_EXTRUDE);
    const r = validateStep(src);
    expect(r.ok).toBe(true);
  });

  it('errors when MANIFOLD_SOLID_BREP present but CLOSED_SHELL is missing', () => {
    const src = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('t'),'2;1');
FILE_NAME('t','t',(''),(''),'s','s','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=ADVANCED_FACE('',(),#12,.T.);
#12=PLANE('',#10);
#13=MANIFOLD_SOLID_BREP('',#14);
#14=PRODUCT('p','p','',(#10));
ENDSEC;
END-ISO-10303-21;`;
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) => e.startsWith('inconsistent_brep') && e.includes('CLOSED_SHELL'),
      ),
    ).toBe(true);
  });

  it('errors when MANIFOLD_SOLID_BREP present but ADVANCED_FACE is missing', () => {
    const src = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('t'),'2;1');
FILE_NAME('t','t',(''),(''),'s','s','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CLOSED_SHELL('',(#10));
#12=MANIFOLD_SOLID_BREP('',#11);
#13=PRODUCT('p','p','',(#10));
ENDSEC;
END-ISO-10303-21;`;
    const r = validateStep(src);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) => e.startsWith('inconsistent_brep') && e.includes('ADVANCED_FACE'),
      ),
    ).toBe(true);
  });

  it('does not invoke BREP consistency when MANIFOLD_SOLID_BREP is absent', () => {
    // MIN_AP214 has no MANIFOLD_SOLID_BREP so the consistency check is moot.
    const r = validateStep(MIN_AP214);
    expect(
      r.errors.filter((e) => e.startsWith('inconsistent_brep')),
    ).toEqual([]);
  });
});

// ─── warnings ────────────────────────────────────────────────────────────

describe('validateStep — warnings', () => {
  it('warns when PRODUCT entity is missing (recommendation)', () => {
    const src = MIN_AP214.replace(
      `#12=PRODUCT('part','part','',(#10));\n`,
      '',
    );
    const r = validateStep(src);
    expect(r.ok).toBe(true); // missing PRODUCT is a warning, not an error
    expect(r.warnings.some((w) => w.startsWith('missing_product'))).toBe(true);
  });

  it('warns when content precedes the ISO-10303-21; marker', () => {
    const src = `noise before marker\n${MIN_AP214}`;
    const r = validateStep(src);
    expect(r.warnings.some((w) => w.startsWith('leading_content'))).toBe(true);
  });
});

// ─── non-string input ────────────────────────────────────────────────────

describe('validateStep — defensive', () => {
  it('errors on non-string input (undefined)', () => {
    const r = validateStep(undefined as unknown as string);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('empty_source'))).toBe(true);
  });

  it('errors on non-string input (null)', () => {
    const r = validateStep(null as unknown as string);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('empty_source'))).toBe(true);
  });

  it('returns the schema literal even when protocol is unknown', () => {
    const src = MIN_AP214.replace(
      `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));`,
      `FILE_SCHEMA(('CUSTOM_FOO_BAR_SCHEMA'));`,
    );
    const r = validateStep(src);
    expect(r.schema).toBe('CUSTOM_FOO_BAR_SCHEMA');
    expect(r.protocol).toBeUndefined();
  });

  it('emits no protocol when FILE_SCHEMA is absent altogether', () => {
    const src = MIN_AP214.replace(
      `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));\n`,
      '',
    );
    const r = validateStep(src);
    expect(r.protocol).toBeUndefined();
    expect(r.schema).toBeUndefined();
  });
});

// ─── stepWrite round-trip ────────────────────────────────────────────────

describe('validateStep — stepWrite round-trip', () => {
  it('validates the writeStepHeader-only output as missing DATA (graceful)', () => {
    const header = writeStepHeader();
    const r = validateStep(header);
    // Header-only is not a complete file — should error on missing DATA + END.
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('missing_data_section'))).toBe(
      true,
    );
    expect(r.errors.some((e) => e.startsWith('missing_end_iso'))).toBe(true);
  });

  it('validates a custom-product extrude output as AP214', () => {
    const src = writeExtrudeAsStep(BOX_EXTRUDE, { productName: 'widget' });
    const r = validateStep(src);
    expect(r.ok).toBe(true);
    expect(r.protocol).toBe('AP214');
    expect(r.warnings).toEqual([]);
  });
});
