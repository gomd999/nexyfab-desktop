import { describe, expect, it } from 'vitest';
import { spatialHubEntries } from './spatialHub';

describe('spatialHubEntries', () => {
  it('exposes every spatial discipline as a precision-CAD deep link', () => {
    const entries = spatialHubEntries('kr');
    expect(entries.map(entry => entry.id)).toEqual(['building', 'civil', 'landscape', 'interior', 'coordination']);
    expect(entries.every(entry => entry.href.includes('expert=1'))).toBe(true);
    expect(entries.every(entry => entry.href.includes('workMode=precision_cad'))).toBe(true);
    expect(entries.find(entry => entry.id === 'coordination')?.href).toContain('workspace=coordination');
  });

  it('does not overstate bounds-only coordination as exact verification', () => {
    const coordination = spatialHubEntries('en').find(entry => entry.id === 'coordination');
    expect(coordination?.evidence).toBe('BOUNDS_PREVIEW');
    expect(coordination?.description).toContain('bounds clash candidates');
  });
});
