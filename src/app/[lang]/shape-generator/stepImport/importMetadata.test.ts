import { describe, it, expect } from 'vitest';
import { extractMetadata, summarizeMetadata } from './importMetadata';

const FULL_STEP_HEADER = `
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('NexyFab test export','Brake bracket revision A'),'2;1');
FILE_NAME('brake_bracket.step','2026-04-12T10:33:00',('Park, J.'),('Acme Engineering'),'STEP AP242 v1.0','NX 2306','Internal');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#100=SI_UNIT(.MILLI.,.METRE.);
#101=SI_UNIT($,.RADIAN.);
#200=DESCRIPTIVE_REPRESENTATION_ITEM('Al6061-T6','material');
#300=PROPERTY_DEFINITION('weight','3.2 kg',#10);
#301=PROPERTY_DEFINITION('shape','default',#11);
ENDSEC;
END-ISO-10303-21;
`;

const MINIMAL = `
ISO-10303-21;
HEADER;
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;
`;

const INCH_FILE = `
ISO-10303-21;
HEADER;
FILE_NAME('legacy.step','','','','','SolidWorks 2020','');
ENDSEC;
DATA;
#1=CONVERSION_BASED_UNIT('INCH',#2);
ENDSEC;
END-ISO-10303-21;
`;

describe('extractMetadata', () => {
  it('parses FILE_NAME with author and organisation', () => {
    const m = extractMetadata(FULL_STEP_HEADER);
    expect(m.fileName).toBe('brake_bracket.step');
    expect(m.fileTimestamp).toBe('2026-04-12T10:33:00');
    expect(m.author).toEqual(['Park, J.']);
    expect(m.organisation).toEqual(['Acme Engineering']);
    expect(m.originatingSystem).toBe('NX 2306');
  });

  it('parses FILE_DESCRIPTION', () => {
    const m = extractMetadata(FULL_STEP_HEADER);
    expect(m.description).toContain('NexyFab test export');
    expect(m.description).toContain('Brake bracket revision A');
  });

  it('parses FILE_SCHEMA', () => {
    const m = extractMetadata(FULL_STEP_HEADER);
    expect(m.schema).toContain('AP242');
  });

  it('detects MILLI units → mm', () => {
    const m = extractMetadata(FULL_STEP_HEADER);
    expect(m.unitLength).toBe('mm');
    expect(m.unitAngle).toBe('rad');
  });

  it('detects CONVERSION_BASED_UNIT INCH → inch', () => {
    const m = extractMetadata(INCH_FILE);
    expect(m.unitLength).toBe('inch');
  });

  it('extracts material names from DESCRIPTIVE_REPRESENTATION_ITEM', () => {
    const m = extractMetadata(FULL_STEP_HEADER);
    expect(m.materials).toContain('Al6061-T6');
  });

  it('extracts custom properties but skips standard ones', () => {
    const m = extractMetadata(FULL_STEP_HEADER);
    expect(m.properties.weight).toBe('3.2 kg');
    expect(m.properties.shape).toBeUndefined();
  });

  it('returns sane defaults for minimal STEP', () => {
    const m = extractMetadata(MINIMAL);
    expect(m.materials).toEqual([]);
    expect(m.properties).toEqual({});
    expect(m.fileName).toBeUndefined();
    expect(m.unitLength).toBeUndefined();
  });

  it('handles non-STEP gibberish without throwing', () => {
    const m = extractMetadata('hello world\nnot a step file at all');
    expect(m.materials).toEqual([]);
    expect(m.properties).toEqual({});
  });
});

describe('summarizeMetadata', () => {
  it('produces a one-line summary of all metadata', () => {
    const m = extractMetadata(FULL_STEP_HEADER);
    const s = summarizeMetadata(m);
    expect(s).toContain('NX 2306');
    expect(s).toContain('Park, J.');
    expect(s).toContain('mm');
    expect(s).toContain('Al6061-T6');
  });

  it('falls back to "No metadata" for empty meta', () => {
    const m = extractMetadata(MINIMAL);
    const s = summarizeMetadata(m);
    expect(s).toBe('No metadata extracted');
  });
});
