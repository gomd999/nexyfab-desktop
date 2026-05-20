import { describe, it, expect } from 'vitest';
import {
  detectEncoding,
  decodeBytes,
  detectLineEnding,
  normalizeLineEndings,
  analyzeText,
  preflightStep,
  applyRepairs,
} from './stepRobustness';

const MINIMAL_STEP = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('A minimal STEP file'), '2;1');
FILE_NAME('test.step', '2026-05-19T10:00:00', ('NexyFab'), ('NexyFab'), 'NexyFab STEP', 'NexyFab', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',1994,#2);
#2=APPLICATION_CONTEXT('automotive design');
ENDSEC;
END-ISO-10303-21;`;

describe('detectEncoding', () => {
  it('UTF-8 with BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x49, 0x53, 0x4f]);
    const r = detectEncoding(bytes);
    expect(r.encoding).toBe('utf-8');
    expect(r.hasBom).toBe(true);
  });

  it('UTF-16LE with BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x49, 0x00, 0x53, 0x00]);
    expect(detectEncoding(bytes).encoding).toBe('utf-16le');
  });

  it('UTF-16BE with BOM', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x49, 0x00, 0x53]);
    expect(detectEncoding(bytes).encoding).toBe('utf-16be');
  });

  it('plain ASCII → utf-8', () => {
    const bytes = new TextEncoder().encode('hello world');
    expect(detectEncoding(bytes).encoding).toBe('utf-8');
  });

  it('empty → unknown', () => {
    expect(detectEncoding(new Uint8Array(0)).encoding).toBe('unknown');
  });
});

describe('decodeBytes', () => {
  it('strips BOM when requested', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    const r = decodeBytes(bytes, 'utf-8', true);
    expect(r).toBe('hi');
  });

  it('decodes plain ASCII without BOM', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(decodeBytes(bytes, 'utf-8', false)).toBe('hello');
  });
});

describe('detectLineEnding', () => {
  it('LF', () => {
    expect(detectLineEnding('a\nb\nc')).toBe('lf');
  });

  it('CRLF', () => {
    expect(detectLineEnding('a\r\nb\r\nc')).toBe('crlf');
  });

  it('CR-only', () => {
    expect(detectLineEnding('a\rb\rc')).toBe('cr');
  });

  it('mixed', () => {
    expect(detectLineEnding('a\nb\r\nc')).toBe('mixed');
  });

  it('none', () => {
    expect(detectLineEnding('abc')).toBe('none');
  });
});

describe('normalizeLineEndings', () => {
  it('CRLF → LF', () => {
    expect(normalizeLineEndings('a\r\nb')).toBe('a\nb');
  });

  it('CR → LF', () => {
    expect(normalizeLineEndings('a\rb')).toBe('a\nb');
  });
});

describe('analyzeText', () => {
  it('detects valid framing', () => {
    const r = analyzeText(MINIMAL_STEP);
    expect(r.validFraming).toBe(true);
  });

  it('counts entity records', () => {
    const r = analyzeText(MINIMAL_STEP);
    expect(r.entityCount).toBe(2);
  });

  it('extracts AP214 schema name', () => {
    const r = analyzeText(MINIMAL_STEP);
    expect(r.schemaName).toBe('AP214');
  });

  it('flags missing framing', () => {
    const r = analyzeText('HEADER; ENDSEC; DATA; ENDSEC;');
    expect(r.validFraming).toBe(false);
  });

  it('handles AP203 schema', () => {
    const ap203 = MINIMAL_STEP.replace('AUTOMOTIVE_DESIGN', 'CONFIG_CONTROL_DESIGN');
    expect(analyzeText(ap203).schemaName).toBe('AP203');
  });
});

describe('preflightStep', () => {
  it('produces a complete report for minimal STEP', () => {
    const bytes = new TextEncoder().encode(MINIMAL_STEP);
    const r = preflightStep(bytes);
    expect(r.encoding).toBe('utf-8');
    expect(r.validIso10303Framing).toBe(true);
    expect(r.entityCount).toBe(2);
    expect(r.schemaName).toBe('AP214');
    expect(r.repairs).toEqual([]); // clean file
  });

  it('suggests strip-bom when present', () => {
    const stepBytes = new TextEncoder().encode(MINIMAL_STEP);
    const withBom = new Uint8Array(stepBytes.length + 3);
    withBom[0] = 0xef; withBom[1] = 0xbb; withBom[2] = 0xbf;
    withBom.set(stepBytes, 3);
    const r = preflightStep(withBom);
    expect(r.hasBom).toBe(true);
    expect(r.repairs.some(x => x.kind === 'strip-bom')).toBe(true);
  });

  it('suggests CRLF normalization', () => {
    const crlf = MINIMAL_STEP.replace(/\n/g, '\r\n');
    const r = preflightStep(new TextEncoder().encode(crlf));
    expect(r.lineEnding).toBe('crlf');
    expect(r.repairs.some(x => x.kind === 'normalize-line-endings')).toBe(true);
  });
});

describe('applyRepairs', () => {
  it('normalizes CRLF', () => {
    const crlf = MINIMAL_STEP.replace(/\n/g, '\r\n');
    const bytes = new TextEncoder().encode(crlf);
    const report = preflightStep(bytes);
    const { text } = applyRepairs(bytes, report);
    expect(text.includes('\r')).toBe(false);
  });

  it('strips trailing nulls', () => {
    const original = MINIMAL_STEP + '\0\0';
    const bytes = new TextEncoder().encode(original);
    const report = preflightStep(bytes);
    const { text } = applyRepairs(bytes, report);
    expect(text.endsWith('\0')).toBe(false);
  });
});
