/**
 * stepRead — unit detection / issue analysis / heal / validate tests.
 *
 * Phase 5.1 pure-TS STEP pre-processor (see ./stepRead.ts JSDoc).
 */
import { describe, it, expect } from 'vitest';
import {
  detectStepUnits,
  analyzeStepIssues,
  healStepSource,
  validateStepSyntax,
} from './stepRead';
import { writeExtrudeAsStep } from './stepWrite';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

/** Realistic mm-unit STEP fragment with explicit SI_UNIT(.MILLI.,.METRE.). */
const STEP_MM_REAL = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('NexyFab Pro test export'),'2;1');
FILE_NAME('cube.step','2026-06-01T00:00:00Z',(''),(''),'NEXYFAB-PRO','NEXYFAB-PRO','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(10.,0.,0.));
#20=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#21=( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
ENDSEC;
END-ISO-10303-21;
`;

/** STEP fragment using metres (no prefix). */
const STEP_METRES = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('metric build, units in meters'),'2;1');
FILE_NAME('part.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));
ENDSEC;
DATA;
#10=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );
ENDSEC;
END-ISO-10303-21;
`;

/** STEP fragment using inches via CONVERSION_BASED_UNIT. */
const STEP_INCHES = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('imperial part'),'2;1');
FILE_NAME('part.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));
ENDSEC;
DATA;
#10=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );
#11=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);
#12=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.0254),#10);
#13=CONVERSION_BASED_UNIT('INCH',#12);
ENDSEC;
END-ISO-10303-21;
`;

/** STEP fragment with no unit declarations at all. */
const STEP_NO_UNITS = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('bare file'),'2;1');
FILE_NAME('part.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;

// ─── detectStepUnits ──────────────────────────────────────────────────────

describe('detectStepUnits', () => {
  it('detects mm from explicit SI_UNIT(.MILLI.,.METRE.) — high confidence', () => {
    const out = detectStepUnits(STEP_MM_REAL);
    expect(out.unit).toBe('mm');
    expect(out.confidence).toBe('high');
    expect(out.raw).toContain('SI_UNIT');
    expect(out.raw).toContain('.MILLI.');
  });

  it('detects metre from SI_UNIT($,.METRE.) — high confidence', () => {
    const out = detectStepUnits(STEP_METRES);
    expect(out.unit).toBe('m');
    expect(out.confidence).toBe('high');
  });

  it('detects inch from CONVERSION_BASED_UNIT(\'INCH\', …) — high confidence', () => {
    const out = detectStepUnits(STEP_INCHES);
    expect(out.unit).toBe('inch');
    expect(out.confidence).toBe('high');
    expect(out.raw.toUpperCase()).toContain('INCH');
  });

  it('defaults to mm with low confidence when no unit info present', () => {
    const out = detectStepUnits(STEP_NO_UNITS);
    expect(out.unit).toBe('mm');
    expect(out.confidence).toBe('low');
    expect(out.raw).toBe('');
  });

  it('returns mm/low for empty string input', () => {
    const out = detectStepUnits('');
    expect(out.unit).toBe('mm');
    expect(out.confidence).toBe('low');
  });

  it('uses FILE_DESCRIPTION hint as medium-confidence fallback', () => {
    const src = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Sample part, dimensions in inches'),'2;1');
FILE_NAME('x.step','t',(''),(''),'s','s','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;
    const out = detectStepUnits(src);
    expect(out.unit).toBe('inch');
    expect(out.confidence).toBe('medium');
  });

  it('prefers explicit SI_UNIT match over FILE_DESCRIPTION hint', () => {
    const src = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('legacy inch master'),'2;1');
FILE_NAME('x.step','t',(''),(''),'s','s','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
ENDSEC;
END-ISO-10303-21;`;
    const out = detectStepUnits(src);
    expect(out.unit).toBe('mm');
    expect(out.confidence).toBe('high');
  });

  it('detects unit emitted by stepWrite output as mm/high', () => {
    const feature: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ],
      depth: 3,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = detectStepUnits(writeExtrudeAsStep(feature));
    expect(out.unit).toBe('mm');
    expect(out.confidence).toBe('high');
  });

  it('ignores SI_UNIT(.RADIAN.) angular entries when picking length unit', () => {
    const src = `DATA;
#1=( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
ENDSEC;`;
    const out = detectStepUnits(src);
    // No length unit found → fall back to mm/low.
    expect(out.unit).toBe('mm');
    expect(out.confidence).toBe('low');
  });
});

// ─── analyzeStepIssues ────────────────────────────────────────────────────

describe('analyzeStepIssues', () => {
  it('returns severity=ok and empty issues for a clean file', () => {
    const out = analyzeStepIssues(STEP_MM_REAL);
    expect(out.severity).toBe('ok');
    expect(out.issues).toEqual([]);
  });

  it('detects missing ISO-10303-21; start marker', () => {
    const broken = STEP_MM_REAL.replace(/^ISO-10303-21;\n/, '');
    const out = analyzeStepIssues(broken);
    expect(out.severity).toBe('error');
    expect(out.issues.some((i) => i.code === 'missing_iso_header')).toBe(true);
  });

  it('detects missing END-ISO-10303-21; trailer', () => {
    const broken = STEP_MM_REAL.replace(/END-ISO-10303-21;\n?$/, '');
    const out = analyzeStepIssues(broken);
    expect(out.severity).toBe('error');
    expect(out.issues.some((i) => i.code === 'missing_end_iso')).toBe(true);
  });

  it('detects missing DATA; section', () => {
    const broken = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('x'),'2;1');
FILE_NAME('x','t',(''),(''),'s','s','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
END-ISO-10303-21;`;
    const out = analyzeStepIssues(broken);
    expect(out.severity).toBe('error');
    expect(out.issues.some((i) => i.code === 'no_data_section')).toBe(true);
  });

  it('detects unknown FILE_SCHEMA as a warn', () => {
    const broken = STEP_MM_REAL.replace(
      /AUTOMOTIVE_DESIGN \{ 1 0 10303 214 3 1 1 1 \}/,
      'WIDGET_PROTOCOL_2099',
    );
    const out = analyzeStepIssues(broken);
    expect(out.issues.some((i) => i.code === 'unknown_schema')).toBe(true);
    // No structural error → severity is warn.
    expect(out.severity).toBe('warn');
  });

  it('detects CRLF line endings as auto-fixable warn', () => {
    const crlf = STEP_MM_REAL.replace(/\n/g, '\r\n');
    const out = analyzeStepIssues(crlf);
    const crlfIssue = out.issues.find((i) => i.code === 'crlf_line_endings');
    expect(crlfIssue).toBeDefined();
    expect(crlfIssue?.fix).toBe('auto');
    expect(out.severity).toBe('warn');
  });

  it('detects missing entity-line semicolon inside DATA', () => {
    const broken = STEP_MM_REAL.replace(
      `#10=CARTESIAN_POINT('',(0.,0.,0.));`,
      `#10=CARTESIAN_POINT('',(0.,0.,0.))`,
    );
    const out = analyzeStepIssues(broken);
    const semIssue = out.issues.find(
      (i) => i.code === 'missing_trailing_semicolon',
    );
    expect(semIssue).toBeDefined();
    expect(semIssue?.fix).toBe('auto');
  });

  it('returns severity=error for empty string input', () => {
    const out = analyzeStepIssues('');
    expect(out.severity).toBe('error');
    expect(out.issues[0]?.code).toBe('missing_iso_header');
  });

  it('detects missing FILE_SCHEMA record entirely', () => {
    const broken = STEP_MM_REAL.replace(
      /FILE_SCHEMA\(\('[^']+'\)\);\n/,
      '',
    );
    const out = analyzeStepIssues(broken);
    expect(out.issues.some((i) => i.code === 'unknown_schema')).toBe(true);
  });
});

// ─── healStepSource ───────────────────────────────────────────────────────

describe('healStepSource', () => {
  it('returns empty fix list for already-clean source', () => {
    const out = healStepSource(STEP_MM_REAL);
    expect(out.appliedFixes).toEqual([]);
    expect(out.healed).toBe(STEP_MM_REAL);
  });

  it('normalises CRLF → LF and reports the fix', () => {
    const crlf = STEP_MM_REAL.replace(/\n/g, '\r\n');
    const out = healStepSource(crlf);
    expect(out.appliedFixes).toContain('normalize_line_endings_lf');
    expect(out.healed.includes('\r')).toBe(false);
  });

  it('strips trailing whitespace and reports the fix', () => {
    const dirty = STEP_MM_REAL.replace(
      'HEADER;',
      'HEADER;   \t  ',
    );
    const out = healStepSource(dirty);
    expect(out.appliedFixes).toContain('strip_trailing_whitespace');
    expect(out.healed).toContain('HEADER;\n');
    expect(out.healed.includes('HEADER;   ')).toBe(false);
  });

  it('appends missing entity-line semicolons (balanced parens only)', () => {
    const broken = STEP_MM_REAL.replace(
      `#10=CARTESIAN_POINT('',(0.,0.,0.));`,
      `#10=CARTESIAN_POINT('',(0.,0.,0.))`,
    );
    const out = healStepSource(broken);
    expect(out.appliedFixes).toContain('add_missing_entity_semicolons');
    expect(out.healed).toContain(`#10=CARTESIAN_POINT('',(0.,0.,0.));`);
  });

  it('appends missing END-ISO-10303-21; marker', () => {
    const broken = STEP_MM_REAL.replace(/END-ISO-10303-21;\n?$/, '');
    const out = healStepSource(broken);
    expect(out.appliedFixes).toContain('add_missing_end_iso');
    expect(out.healed.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('handles empty input gracefully', () => {
    const out = healStepSource('');
    expect(out.healed).toBe('');
    expect(out.appliedFixes).toEqual([]);
  });

  it('combines multiple fixes (CRLF + trailing space + missing semicolon)', () => {
    const dirty =
      STEP_MM_REAL
        .replace(/\n/g, '\r\n')
        .replace('HEADER;', 'HEADER;   ')
        .replace(
          `#10=CARTESIAN_POINT('',(0.,0.,0.));`,
          `#10=CARTESIAN_POINT('',(0.,0.,0.))`,
        );
    const out = healStepSource(dirty);
    expect(out.appliedFixes).toContain('normalize_line_endings_lf');
    expect(out.appliedFixes).toContain('strip_trailing_whitespace');
    expect(out.appliedFixes).toContain('add_missing_entity_semicolons');
    // Healed source should now pass syntax validation.
    expect(validateStepSyntax(out.healed).valid).toBe(true);
  });
});

// ─── validateStepSyntax ───────────────────────────────────────────────────

describe('validateStepSyntax', () => {
  it('accepts output of writeExtrudeAsStep without errors', () => {
    const feature: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      depth: 2,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = validateStepSyntax(writeExtrudeAsStep(feature));
    expect(out.valid).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it('accepts the canonical mm fixture', () => {
    const out = validateStepSyntax(STEP_MM_REAL);
    expect(out.valid).toBe(true);
  });

  it('rejects missing ISO start marker', () => {
    const broken = STEP_MM_REAL.replace(/^ISO-10303-21;\n/, '');
    const out = validateStepSyntax(broken);
    expect(out.valid).toBe(false);
    expect(out.errors).toContain('missing_iso_start_marker');
  });

  it('rejects missing ISO end marker', () => {
    const broken = STEP_MM_REAL.replace(/END-ISO-10303-21;\n?$/, '');
    const out = validateStepSyntax(broken);
    expect(out.valid).toBe(false);
    expect(out.errors).toContain('missing_iso_end_marker');
  });

  it('rejects missing HEADER section', () => {
    const broken = STEP_MM_REAL.replace(/HEADER;\n/, '');
    const out = validateStepSyntax(broken);
    expect(out.valid).toBe(false);
    expect(out.errors).toContain('missing_header_section');
  });

  it('rejects missing DATA section', () => {
    const broken = STEP_MM_REAL.replace(/DATA;\n/, '');
    const out = validateStepSyntax(broken);
    expect(out.valid).toBe(false);
    expect(out.errors).toContain('missing_data_section');
  });

  it('rejects empty input', () => {
    const out = validateStepSyntax('');
    expect(out.valid).toBe(false);
    expect(out.errors).toContain('empty_source');
  });

  it('rejects a file with only one ENDSEC marker', () => {
    const broken = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('x','t',(''),(''),'s','s','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
DATA;
END-ISO-10303-21;`;
    const out = validateStepSyntax(broken);
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.startsWith('endsec_count_'))).toBe(true);
  });
});
