import { describe, expect, it } from 'vitest';
import { compileStandardConnection } from './standardConnection';

const axis = (partId: string) => ({ partId, refId: 'z_axis', refKind: 'axis' as const });
describe('standard connection compiler', () => {
  it('compiles shaft-bearing alignment without merging parts', () => {
    const result = compileStandardConnection({ id: 'j1-bearing', kind: 'shaft_bearing', a: axis('shaft'), b: axis('bearing'), fit: 'transition', radialClearanceMm: 0.006 });
    expect(result.mates).toEqual([expect.objectContaining({ kind: 'concentric' })]);
    expect(result.intendedContact).toBeUndefined();
  });
  it('records press fit as justified contact', () => {
    const result = compileStandardConnection({ id: 'pin', kind: 'press_fit', a: axis('pin'), b: axis('link'), interferenceMm: 0.02, justification: 'permanent locating pin' });
    expect(result.intendedContact?.justification).toContain('0.02');
  });
  it('rejects a self connection', () => {
    expect(() => compileStandardConnection({ id: 'bad', kind: 'bolt', a: axis('same'), b: axis('same'), nominalDiameterMm: 8, clearanceMm: 0.5 })).toThrow(/different parts/);
  });
});
