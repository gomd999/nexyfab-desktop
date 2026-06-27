/** detectInterference — broad+narrow phase part overlap. Coverage-gap closure. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { detectInterference } from './InterferenceDetection';
 
const part = (id: string, tx: number): any => ({ id, geometry: new THREE.BoxGeometry(20, 20, 20), transform: new THREE.Matrix4().makeTranslation(tx, 0, 0) });

describe('detectInterference', () => {
  it('flags two overlapping parts', () => {
    expect(detectInterference([part('a', 0), part('b', 5)]).length).toBeGreaterThanOrEqual(1);
  });
  it('reports none for well-separated parts', () => {
    expect(detectInterference([part('a', 0), part('b', 1000)]).length).toBe(0);
  });
  it('reports none for a single part', () => {
    expect(detectInterference([part('a', 0)])).toEqual([]);
  });
});
