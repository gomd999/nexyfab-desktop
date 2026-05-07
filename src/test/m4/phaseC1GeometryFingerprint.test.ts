/**
 * Phase C1 (도면 v1 게이트) — 기하 지문이 모델 변경에 반응하는지 최소 회귀.
 * 로드맵: docs/strategy/M4_DRAWING.md §Phase C1 · CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase C
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeDrawingGeometryFingerprint } from '@/app/[lang]/shape-generator/analysis/autoDrawing';

describe('M4 Phase C1 — drawing geometry fingerprint', () => {
  it('differs when box dimensions change (stale-banner / revision policy baseline)', () => {
    const a = new THREE.BoxGeometry(10, 10, 10);
    const b = new THREE.BoxGeometry(11, 10, 10);
    expect(computeDrawingGeometryFingerprint(a)).not.toBe(computeDrawingGeometryFingerprint(b));
  });
});
