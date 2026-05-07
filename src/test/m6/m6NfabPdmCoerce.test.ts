/**
 * M6: PDM 메타 코어스(`coerceLifecycle`, 길이 클램프, 직렬화 분기).
 */
import { describe, it, expect } from 'vitest';
import {
  coerceLifecycle,
  parsePdmFromMeta,
  buildSerializedMeta,
  NFAB_PDM_META_KEY,
} from '@/app/[lang]/shape-generator/io/nfabPdmMeta';

describe('M6 coerceLifecycle', () => {
  it('only released is released; everything else maps to wip', () => {
    expect(coerceLifecycle('released')).toBe('released');
    expect(coerceLifecycle(undefined)).toBe('wip');
    expect(coerceLifecycle(null)).toBe('wip');
    expect(coerceLifecycle('')).toBe('wip');
    expect(coerceLifecycle('wip')).toBe('wip');
    expect(coerceLifecycle(1)).toBe('wip');
  });
});

describe('M6 parsePdmFromMeta length limits', () => {
  it('trims and clamps partNumber and revisionLabel', () => {
    const longPart = `P-${'x'.repeat(200)}`;
    const longRev = `R-${'y'.repeat(100)}`;
    const { slice } = parsePdmFromMeta({
      [NFAB_PDM_META_KEY]: { partNumber: `  ${longPart}  `, revisionLabel: ` ${longRev} `, lifecycle: 'wip' },
    });
    expect(slice.partNumber.length).toBe(120);
    expect(slice.revisionLabel.length).toBe(64);
    expect(slice.partNumber.startsWith('P-')).toBe(true);
    expect(slice.revisionLabel.startsWith('R-')).toBe(true);
  });
});

describe('M6 buildSerializedMeta revision-only branch', () => {
  it('persists nexyfabPdm when only revisionLabel is set (wip)', () => {
    const meta = buildSerializedMeta({}, { partNumber: '', revisionLabel: 'C', lifecycle: 'wip' });
    expect(meta?.[NFAB_PDM_META_KEY]).toEqual({ revisionLabel: 'C' });
  });
});
