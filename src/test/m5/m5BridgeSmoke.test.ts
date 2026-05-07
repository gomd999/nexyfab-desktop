/**
 * M5 v0: 시뮬(FEA)·DFM·CAM 라이트 파이프 최소 회귀 — 별도 워커 없이 동기 API만 검증.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeDFM } from '@/app/[lang]/shape-generator/analysis/dfmAnalysis';
import { runSimpleFEA } from '@/app/[lang]/shape-generator/analysis/simpleFEA';
import { generateCAMToolpaths } from '@/app/[lang]/shape-generator/analysis/camLite';
import { toGcode } from '@/app/[lang]/shape-generator/analysis/gcodeEmitter';

const AL6061 = {
  youngsModulus: 69,
  poissonRatio: 0.33,
  yieldStrength: 276,
  density: 2.7,
};

describe('M5 bridge smoke', () => {
  it('analyzeDFM returns CNC milling result for a box', () => {
    const geo = new THREE.BoxGeometry(40, 20, 30);
    const [r] = analyzeDFM(geo, ['cnc_milling']);
    expect(r.process).toBe('cnc_milling');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(r.issues)).toBe(true);
  });

  it('runSimpleFEA returns stress/displacement arrays (FEM or beam fallback)', () => {
    const geo = new THREE.BoxGeometry(12, 10, 8);
    const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    expect(triCount).toBeGreaterThan(0);
    const result = runSimpleFEA(geo, {
      material: AL6061,
      conditions: [
        { type: 'fixed', faceIndices: [0] },
        { type: 'force', faceIndices: [Math.min(8, triCount - 1)], value: [0, -500, 0] },
      ],
    });
    expect(result.vonMisesStress.length).toBeGreaterThan(0);
    expect(result.displacement.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.maxStress)).toBe(true);
    expect(Number.isFinite(result.maxDisplacement)).toBe(true);
    expect(result.method === 'linear-fem-tet' || result.method === 'beam-theory').toBe(true);
  });

  it('generateCAMToolpaths + toGcode emits LinuxCNC-style G-code', () => {
    const geo = new THREE.BoxGeometry(30, 12, 20);
    const op = {
      type: 'face_mill' as const,
      toolDiameter: 8,
      stepover: 45,
      stepdown: 3,
      feedRate: 600,
      spindleSpeed: 2400,
    };
    const cam = generateCAMToolpaths(geo, op);
    expect(cam.toolpaths.length).toBeGreaterThan(0);
    const out = toGcode(cam, op, { postProcessor: 'linuxcnc', programName: 'M5Smoke' });
    expect(out.code).toMatch(/G21|G20/);
    expect(out.lineCount).toBeGreaterThan(10);
    expect(out.postProcessorId).toBe('linuxcnc');
  });
});
