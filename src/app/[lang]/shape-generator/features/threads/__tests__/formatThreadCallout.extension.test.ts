/**
 * formatThreadCallout.extension.test.ts — Wave 2 Phase 2 Track D Week 8.
 *
 * Coverage for the D8 multi-standard callout extension. ISO 6410-1 case is
 * still covered by D5's `threadFeature.test.ts`; this suite focuses on the
 * **non-default** standards (ASME / JIS / DIN / GB) + edge cases that D5
 * did not exercise (left-hand × non-ISO standards, annotation-only
 * features × non-ISO standards, tap-drill override, etc.).
 */

import { describe, it, expect } from 'vitest';
import {
  formatThreadCalloutExt,
  SUPPORTED_CALLOUT_STANDARDS,
  type ThreadCalloutStandard,
} from '../formatThreadCalloutExt';
import { makeThreadFeature, type ThreadFeature } from '../threadFeature';

function feat(
  series: ThreadFeature['threadRef']['series'],
  designation: string,
  overrides: Partial<ThreadFeature> = {},
): ThreadFeature {
  return makeThreadFeature({
    id: 'f',
    threadRef: { series, designation },
    length: overrides.length ?? 20,
    class: overrides.class,
    threadDirection: overrides.threadDirection,
    threadKind: overrides.threadKind,
  });
}

describe('formatThreadCalloutExt — default standard (ISO 6410-1)', () => {
  it('matches the D5 ISO callout for ISO M coarse', () => {
    expect(formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8'))).toBe('M8-6H ↧ 20');
  });

  it('matches D5 ISO callout when standard is explicit', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8'), null, { standard: 'ISO_6410_1' }),
    ).toBe('M8-6H ↧ 20');
  });

  it('matches D5 for ISO M fine', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_FINE', 'M10×1.25', { length: 15 })),
    ).toBe('M10×1.25-6H ↧ 15');
  });

  it('matches D5 for left-hand thread', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8', { threadDirection: 'left_hand' })),
    ).toBe('M8-6H LH ↧ 20');
  });
});

describe('formatThreadCalloutExt — JIS B 0205', () => {
  it('JIS adds spaces around × and around the class hyphen for ISO M fine', () => {
    expect(
      formatThreadCalloutExt(
        feat('ISO_M_FINE', 'M10×1.25', { length: 15 }),
        null,
        { standard: 'JIS_B_0205' },
      ),
    ).toBe('M10 × 1.25 - 6H ↧ 15');
  });

  it('JIS for ISO M coarse adds the space before class', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8'), null, { standard: 'JIS_B_0205' }),
    ).toBe('M8 - 6H ↧ 20');
  });

  it('JIS supports left-hand suffix unchanged', () => {
    expect(
      formatThreadCalloutExt(
        feat('ISO_M_COARSE', 'M8', { threadDirection: 'left_hand' }),
        null,
        { standard: 'JIS_B_0205' },
      ),
    ).toBe('M8 - 6H LH ↧ 20');
  });

  it('JIS for annotation-only (length 0) has no depth marker', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8', { length: 0 }), null, {
        standard: 'JIS_B_0205',
      }),
    ).toBe('M8 - 6H');
  });

  it('JIS for UNC keeps the series tag intact', () => {
    expect(
      formatThreadCalloutExt(feat('UNC', '1/4-20 UNC'), null, { standard: 'JIS_B_0205' }),
    ).toBe('1/4-20 UNC - 2B ↧ 20');
  });
});

describe('formatThreadCalloutExt — DIN 13', () => {
  it('DIN strips the class from ISO M coarse', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8'), null, { standard: 'DIN_13' }),
    ).toBe('M8 ↧ 20');
  });

  it('DIN strips the class from ISO M fine but keeps the pitch', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_FINE', 'M10×1.25', { length: 15 }), null, {
        standard: 'DIN_13',
      }),
    ).toBe('M10×1.25 ↧ 15');
  });

  it('DIN keeps the LH marker', () => {
    expect(
      formatThreadCalloutExt(
        feat('ISO_M_COARSE', 'M8', { threadDirection: 'left_hand' }),
        null,
        { standard: 'DIN_13' },
      ),
    ).toBe('M8 LH ↧ 20');
  });

  it('DIN annotation-only has neither class nor depth', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8', { length: 0 }), null, {
        standard: 'DIN_13',
      }),
    ).toBe('M8');
  });
});

describe('formatThreadCalloutExt — GB 196', () => {
  it('GB uses 深 instead of ↧ for the depth marker', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8'), null, { standard: 'GB_196' }),
    ).toBe('M8-6H 深 20');
  });

  it('GB keeps the class and the LH marker on internal threads', () => {
    expect(
      formatThreadCalloutExt(
        feat('ISO_M_COARSE', 'M8', { threadDirection: 'left_hand' }),
        null,
        { standard: 'GB_196' },
      ),
    ).toBe('M8-6H LH 深 20');
  });

  it('GB for annotation-only has no depth marker (no 深 either)', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8', { length: 0 }), null, {
        standard: 'GB_196',
      }),
    ).toBe('M8-6H');
  });

  it('GB for ISO M fine prints the pitch in the body', () => {
    expect(
      formatThreadCalloutExt(feat('ISO_M_FINE', 'M10×1.25', { length: 15 }), null, {
        standard: 'GB_196',
      }),
    ).toBe('M10×1.25-6H 深 15');
  });
});

describe('formatThreadCalloutExt — ASME Y14.6', () => {
  it('ASME UNC appends decimal-inch tap drill suffix', () => {
    // 1/4-20 UNC → tap drill ~5.10 mm → 5.10 / 25.4 = 0.2008 → ".201"
    const out = formatThreadCalloutExt(feat('UNC', '1/4-20 UNC'), null, {
      standard: 'ASME_Y14_6',
    });
    expect(out).toMatch(/1\/4-20 UNC-2B \/ \.\d{3} ↧ 20$/);
    // Numeric check — value should be very close to 0.201".
    const m = /\/ \.(\d{3})/.exec(out)!;
    expect(parseInt(m[1]!, 10) / 1000).toBeCloseTo(5.10 / 25.4, 2);
  });

  it('ASME UNF appends decimal-inch tap drill suffix', () => {
    const out = formatThreadCalloutExt(feat('UNF', '1/4-28 UNF'), null, {
      standard: 'ASME_Y14_6',
    });
    expect(out).toMatch(/^1\/4-28 UNF-2B \/ \.\d{3} ↧ 20$/);
  });

  it('ASME ISO M (non-inch) keeps mm tap-drill suffix with two decimals', () => {
    const out = formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8'), null, {
      standard: 'ASME_Y14_6',
    });
    expect(out).toBe('M8-6H / 6.80 ↧ 20');
  });

  it('ASME respects an explicit tapDrillMm override', () => {
    const out = formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8'), null, {
      standard: 'ASME_Y14_6',
      tapDrillMm: 7.0,
    });
    expect(out).toBe('M8-6H / 7.00 ↧ 20');
  });

  it('ASME for annotation-only (length 0) inserts the slash before the now-empty depth', () => {
    const out = formatThreadCalloutExt(feat('ISO_M_COARSE', 'M8', { length: 0 }), null, {
      standard: 'ASME_Y14_6',
    });
    expect(out).toBe('M8-6H / 6.80');
  });

  it('ASME NPT uses inch tap drill suffix (pipe is inch-origin)', () => {
    const out = formatThreadCalloutExt(feat('NPT', 'NPT 1/2'), null, {
      standard: 'ASME_Y14_6',
    });
    expect(out).toMatch(/^NPT 1\/2 \/ \.\d{3} ↧ 20$/);
  });
});

describe('formatThreadCalloutExt — exhaustive coverage', () => {
  it('SUPPORTED_CALLOUT_STANDARDS lists all five standards in stable order', () => {
    expect(SUPPORTED_CALLOUT_STANDARDS).toEqual([
      'ISO_6410_1',
      'ASME_Y14_6',
      'JIS_B_0205',
      'DIN_13',
      'GB_196',
    ]);
  });

  it('every supported standard returns a non-empty string for a basic ISO M feature', () => {
    const f = feat('ISO_M_COARSE', 'M8');
    for (const std of SUPPORTED_CALLOUT_STANDARDS) {
      const out = formatThreadCalloutExt(f, null, { standard: std as ThreadCalloutStandard });
      expect(out).toBeTruthy();
      expect(out).toContain('M8');
    }
  });

  it('passes a pre-resolved row through unchanged for ISO_6410_1', () => {
    // Using the catalog row override matches D5's signature exactly.
    const f = feat('ISO_M_COARSE', 'M8');
    expect(formatThreadCalloutExt(f, null)).toBe('M8-6H ↧ 20');
  });
});
