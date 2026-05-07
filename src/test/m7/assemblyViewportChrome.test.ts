import { describe, it, expect } from 'vitest';
import { assemblyViewportChrome } from '@/lib/assemblyViewportChrome';

const labels = {
  assemblyLoadBadgeLight: 'L',
  assemblyLoadTitleLight: 'light-title',
  assemblyLoadBadgeWarn: 'W',
  assemblyLoadTitleWarn: 'warn-title',
  assemblyLoadBadgeHeavy: 'H',
  assemblyLoadTitleHeavy: 'heavy-title',
  assemblyLoadBadgeExtreme: 'X',
  assemblyLoadTitleExtreme: 'extreme-title',
};

describe('assemblyViewportChrome', () => {
  it('returns null for normal band', () => {
    expect(assemblyViewportChrome('normal', labels)).toBeNull();
  });

  it('maps each non-normal band to badge, title, color', () => {
    expect(assemblyViewportChrome('light', labels)).toEqual({
      badge: 'L',
      title: 'light-title',
      color: '#6e7681',
    });
    expect(assemblyViewportChrome('warn', labels)).toEqual({
      badge: 'W',
      title: 'warn-title',
      color: '#a78bfa',
    });
    expect(assemblyViewportChrome('heavy', labels)).toEqual({
      badge: 'H',
      title: 'heavy-title',
      color: '#fb923c',
    });
    expect(assemblyViewportChrome('extreme', labels)).toEqual({
      badge: 'X',
      title: 'extreme-title',
      color: '#f87171',
    });
  });
});
