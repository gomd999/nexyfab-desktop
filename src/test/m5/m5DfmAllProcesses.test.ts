/**
 * M5: DFM — all manufacturing process analyzers return a scored result for a box.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeDFM, type ManufacturingProcess } from '@/app/[lang]/shape-generator/analysis/dfmAnalysis';

const ALL: ManufacturingProcess[] = [
  'cnc_milling',
  'cnc_turning',
  'injection_molding',
  'sheet_metal',
  'casting',
  '3d_printing',
];

describe('M5 DFM all processes', () => {
  it('analyzeDFM returns one row per process with issues and bounded score', () => {
    const geo = new THREE.BoxGeometry(35, 22, 18);
    const rows = analyzeDFM(geo, ALL);
    expect(rows).toHaveLength(ALL.length);

    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].process).toBe(ALL[i]);
      seen.add(rows[i].process);
      expect(rows[i].score).toBeGreaterThanOrEqual(0);
      expect(rows[i].score).toBeLessThanOrEqual(100);
      expect(Array.isArray(rows[i].issues)).toBe(true);
      expect(['easy', 'moderate', 'difficult', 'infeasible']).toContain(rows[i].estimatedDifficulty);
      expect(typeof rows[i].feasible).toBe('boolean');
    }
    expect(seen.size).toBe(ALL.length);
  });
});
