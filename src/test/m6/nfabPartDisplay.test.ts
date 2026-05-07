import { describe, it, expect } from 'vitest';
import { getDrawingTitlePartName } from '@/lib/nfabPartDisplay';

describe('M6 nfabPartDisplay', () => {
  it('prefers part number over shape label', () => {
    expect(
      getDrawingTitlePartName({
        partNumber: '  PN-99 ',
        shapeLabel: 'box',
        cloudProjectId: 'proj-abc',
      }),
    ).toBe('PN-99');
  });

  it('falls back to shape then project id', () => {
    expect(
      getDrawingTitlePartName({
        partNumber: '',
        shapeLabel: 'cylinder',
        cloudProjectId: 'proj-1234567890',
      }),
    ).toBe('cylinder');
    expect(
      getDrawingTitlePartName({
        partNumber: '  ',
        shapeLabel: '',
        cloudProjectId: 'proj-1234567890',
      }),
    ).toBe('proj-123…');
  });
});
