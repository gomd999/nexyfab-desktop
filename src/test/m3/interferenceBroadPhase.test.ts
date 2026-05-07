/**
 * 간섭 broad-phase: 월드 AABB 선계산으로 분리된 다파트에서 불필요한 좁은상 검사를 건너뛴다.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  detectInterference,
  detectInterferenceCooperative,
} from '@/app/[lang]/shape-generator/assembly/InterferenceDetection';
import { buildShapeResult } from '@/app/[lang]/shape-generator/shapes';

function hitSignature(h: { partA: string; partB: string; volume: number }[]): string {
  return h
    .map(x => `${[x.partA, x.partB].sort().join('+')}:${x.volume.toFixed(6)}`)
    .sort()
    .join('|');
}

describe('detectInterference broad-phase (multi-part)', () => {
  it('returns no hits when many boxes are well separated on X', () => {
    const r = buildShapeResult('box', { width: 2, height: 2, depth: 2 });
    if (!r) throw new Error('box');
    const parts = Array.from({ length: 14 }, (_, i) => ({
      id: `P${i}`,
      geometry: r.geometry,
      transform: new THREE.Matrix4().makeTranslation(i * 40, 0, 0),
    }));
    const hits = detectInterference(parts, 25_000);
    expect(hits.length).toBe(0);
  });

  it('returns no hits when 22+ parts are separated (sweep broad-phase path)', () => {
    const r = buildShapeResult('box', { width: 2, height: 2, depth: 2 });
    if (!r) throw new Error('box');
    const parts = Array.from({ length: 22 }, (_, i) => ({
      id: `Q${i}`,
      geometry: r.geometry,
      transform: new THREE.Matrix4().makeTranslation(i * 50, (i % 3) * 50, Math.floor(i / 3) * 50),
    }));
    const hits = detectInterference(parts, 25_000);
    expect(hits.length).toBe(0);
  });

  it('detectInterferenceCooperative rejects with AbortError when signal is aborted', async () => {
    const r = buildShapeResult('box', { width: 2, height: 2, depth: 2 });
    if (!r) throw new Error('box');
    const parts = Array.from({ length: 22 }, (_, i) => ({
      id: `A${i}`,
      geometry: r.geometry,
      transform: new THREE.Matrix4().makeTranslation(i * 50, 0, 0),
    }));
    const ac = new AbortController();
    ac.abort();
    await expect(
      detectInterferenceCooperative(parts, 25_000, { signal: ac.signal, triCheckYieldStride: 0 }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('detectInterferenceCooperative matches sync (22 separated + overlap pair)', async () => {
    const r = buildShapeResult('box', { width: 2, height: 2, depth: 2 });
    if (!r) throw new Error('box');
    const parts22 = Array.from({ length: 22 }, (_, i) => ({
      id: `Q${i}`,
      geometry: r.geometry,
      transform: new THREE.Matrix4().makeTranslation(i * 50, (i % 3) * 50, Math.floor(i / 3) * 50),
    }));
    expect(
      hitSignature(
        await detectInterferenceCooperative(parts22, 25_000, {
          candidateYieldStride: 3,
          triCheckYieldStride: 0,
        }),
      ),
    ).toBe(hitSignature(detectInterference(parts22, 25_000)));

    const r10 = buildShapeResult('box', { width: 10, height: 10, depth: 10 });
    if (!r10) throw new Error('box');
    const I = new THREE.Matrix4().identity();
    const overlapParts = [
      { id: 'A', geometry: r10.geometry, transform: I },
      { id: 'B', geometry: r10.geometry, transform: I },
    ];
    expect(
      hitSignature(
        await detectInterferenceCooperative(overlapParts, 80_000, {
          candidateYieldStride: 1,
          triCheckYieldStride: 0,
        }),
      ),
    ).toBe(hitSignature(detectInterference(overlapParts, 80_000)));
  });

  it('still reports overlap when two identical transforms share space', () => {
    const r = buildShapeResult('box', { width: 10, height: 10, depth: 10 });
    if (!r) throw new Error('box');
    const I = new THREE.Matrix4().identity();
    const hits = detectInterference(
      [
        { id: 'A', geometry: r.geometry, transform: I },
        { id: 'B', geometry: r.geometry, transform: I },
      ],
      80_000,
    );
    expect(hits.length).toBeGreaterThan(0);
  });
});
