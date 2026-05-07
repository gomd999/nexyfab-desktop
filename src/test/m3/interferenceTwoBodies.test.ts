import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { detectInterference } from '@/app/[lang]/shape-generator/assembly/InterferenceDetection';

describe('M3 interference (two mesh bodies)', () => {
  it('reports overlap for two coincident boxes at origin', () => {
    const g = new THREE.BoxGeometry(10, 10, 10);
    const id = new THREE.Matrix4();
    const parts = [
      { id: 'Body1', geometry: g, transform: id.clone() },
      { id: 'Body2', geometry: g.clone(), transform: id.clone() },
    ];
    const hits = detectInterference(parts, 80_000);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.partA).toBeDefined();
    expect(hits[0]!.partB).toBeDefined();
    expect(hits[0]!.volume).toBeGreaterThan(0);
  });

  it('reports no hit when boxes are separated along X', () => {
    const g = new THREE.BoxGeometry(5, 5, 5);
    const m1 = new THREE.Matrix4().makeTranslation(0, 0, 0);
    const m2 = new THREE.Matrix4().makeTranslation(100, 0, 0);
    const parts = [
      { id: 'A', geometry: g, transform: m1 },
      { id: 'B', geometry: g.clone(), transform: m2 },
    ];
    const hits = detectInterference(parts, 80_000);
    expect(hits.length).toBe(0);
  });
});
