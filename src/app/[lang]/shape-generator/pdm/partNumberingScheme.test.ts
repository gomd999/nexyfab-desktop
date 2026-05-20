import { describe, it, expect } from 'vitest';
import {
  generatePartNumber,
  validateNumber,
  checksum,
  hashString,
  SequenceCounter,
  SCHEMES,
  type PartNumberScheme,
} from './partNumberingScheme';

describe('SequenceCounter', () => {
  it('increments per scope independently', () => {
    const c = new SequenceCounter();
    expect(c.next('a')).toBe(1);
    expect(c.next('a')).toBe(2);
    expect(c.next('b')).toBe(1);
  });

  it('snapshot round-trips', () => {
    const c = new SequenceCounter();
    c.next('a'); c.next('a');
    const snap = c.toSnapshot();
    const c2 = new SequenceCounter();
    c2.setFromSnapshot(snap);
    expect(c2.peek('a')).toBe(2);
  });
});

describe('generatePartNumber — preset SCHEMES', () => {
  it('category_year_seq produces dash-separated number', () => {
    const counter = new SequenceCounter();
    const num = generatePartNumber(SCHEMES.category_year_seq!, {
      date: new Date('2026-05-19T00:00:00Z'),
      attributes: { category: 'bracket' },
    }, counter);
    expect(num).toMatch(/^BR-2026-0001$/);
  });

  it('sequence increments on repeated calls', () => {
    const counter = new SequenceCounter();
    const meta = { date: new Date('2026-05-19T00:00:00Z'), attributes: { category: 'bracket' } };
    generatePartNumber(SCHEMES.category_year_seq!, meta, counter);
    const second = generatePartNumber(SCHEMES.category_year_seq!, meta, counter);
    expect(second).toMatch(/0002$/);
  });

  it('unknown category falls back', () => {
    const counter = new SequenceCounter();
    const num = generatePartNumber(SCHEMES.category_year_seq!, {
      date: new Date('2026-05-19T00:00:00Z'),
      attributes: { category: 'unknown' },
    }, counter);
    expect(num).toMatch(/^GN-/);
  });

  it('short_hash scheme produces fixed-length hash', () => {
    const counter = new SequenceCounter();
    const num = generatePartNumber(SCHEMES.short_hash!, {
      attributes: { projectId: 'project_123' },
    }, counter);
    expect(num).toMatch(/^PN-[0-9A-Z]{6}$/);
  });

  it('iso_check scheme has trailing checksum', () => {
    const counter = new SequenceCounter();
    const num = generatePartNumber(SCHEMES.iso_check!, {
      attributes: { category: 'bracket' },
    }, counter);
    expect(num.split('-')).toHaveLength(3);
  });
});

describe('generatePartNumber — custom segments', () => {
  it('literal + month + attribute', () => {
    const scheme: PartNumberScheme = {
      name: 'test',
      separator: '/',
      segments: [
        { kind: 'literal', value: 'A' },
        { kind: 'month' },
        { kind: 'attribute', attributeKey: 'finish', upperCase: true, maxLength: 3 },
      ],
    };
    const num = generatePartNumber(scheme, {
      date: new Date('2026-03-15T00:00:00Z'),
      attributes: { finish: 'anodized' },
    }, new SequenceCounter());
    expect(num).toBe('A/03/ANO');
  });

  it('year 2-digit', () => {
    const scheme: PartNumberScheme = {
      name: 't', separator: '-',
      segments: [{ kind: 'year', digits: 2 }],
    };
    const num = generatePartNumber(scheme, {
      date: new Date('2026-01-01T00:00:00Z'),
      attributes: {},
    }, new SequenceCounter());
    expect(num).toBe('26');
  });
});

describe('checksum', () => {
  it('Luhn of "7992739871" = 3', () => {
    expect(checksum('7992739871', 'luhn')).toBe('3');
  });

  it('mod26 returns a letter A-Z', () => {
    const c = checksum('HELLO', 'mod26');
    expect(/^[A-Z]$/.test(c)).toBe(true);
  });

  it('iso7064 returns a char in alphabet', () => {
    const c = checksum('ABC123', 'iso7064-mod37-2');
    expect(c).toMatch(/^[0-9A-Z*]$/);
  });
});

describe('hashString', () => {
  it('deterministic for same input', () => {
    expect(hashString('hello', 36, 6)).toBe(hashString('hello', 36, 6));
  });

  it('produces requested length', () => {
    expect(hashString('hello', 36, 8)).toHaveLength(8);
  });

  it('uses correct alphabet for base', () => {
    expect(hashString('test', 16, 4)).toMatch(/^[0-9A-F]+$/);
    expect(hashString('test', 26, 4)).toMatch(/^[0-9A-P]+$/);
  });
});

describe('validateNumber', () => {
  it('valid number passes', () => {
    const counter = new SequenceCounter();
    const num = generatePartNumber(SCHEMES.category_year_seq!, {
      date: new Date('2026-05-19T00:00:00Z'),
      attributes: { category: 'bracket' },
    }, counter);
    const r = validateNumber(SCHEMES.category_year_seq!, num);
    expect(r.valid).toBe(true);
  });

  it('wrong segment count flagged', () => {
    const r = validateNumber(SCHEMES.category_year_seq!, 'BR-2026');
    expect(r.valid).toBe(false);
    expect(r.issues.some(i => i.includes('Expected 3 segments'))).toBe(true);
  });

  it('wrong sequence width flagged', () => {
    const r = validateNumber(SCHEMES.category_year_seq!, 'BR-2026-12');
    expect(r.issues.some(i => i.includes('width'))).toBe(true);
  });
});
