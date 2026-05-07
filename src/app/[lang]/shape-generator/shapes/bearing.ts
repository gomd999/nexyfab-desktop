/**
 * 볼 베어링 (Ball Bearing)
 * ISO 15 / KS B 2001 — 단열 깊은 홈 볼 베어링 (Deep Groove Ball Bearing)
 * 외륜 + 내륜 + 볼 세트 시각적 표현
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

/** 단열 링 (환형 솔리드) */
function makeRing(
  innerR: number,
  outerR: number,
  width: number,
  segs = 48,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    curveSegments: segs,
  });
  geo.translate(0, 0, -width / 2);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return geo;
}

export const bearingShape: ShapeConfig = {
  id: 'bearing',
  tier: 1,
  icon: '⊚',
  params: [
    { key: 'boreDia',   labelKey: 'paramBoreDia',    default: 20,  min: 1,   max: 400, step: 1,   unit: 'mm' },
    { key: 'outerDia',  labelKey: 'paramBearingOD',  default: 47,  min: 5,   max: 800, step: 1,   unit: 'mm' },
    { key: 'width',     labelKey: 'paramBearingW',   default: 14,  min: 1,   max: 200, step: 0.5, unit: 'mm' },
    { key: 'ballCount', labelKey: 'paramBallCount',  default: 9,   min: 4,   max: 32,  step: 1,   unit: '' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const d  = p.boreDia;
    const D  = Math.max(p.outerDia, d + 4);
    const B  = p.width;
    const n  = Math.max(4, Math.round(p.ballCount));

    // Raceway radii
    const ri_outer = d / 2;            // bore radius
    const ro_outer = D / 2;            // outer radius
    const raceGap  = (D - d) / 2;     // total gap
    const raceW    = raceGap * 0.25;   // raceway wall thickness ≈ 25% of gap
    const ballR    = raceGap * 0.25;   // ball radius
    const pitchR   = d / 2 + raceGap / 2; // ball pitch circle radius

    // Outer ring: OD → OD minus wall
    const outerRingGeo = makeRing(ro_outer - raceW, ro_outer, B);
    // Inner ring: bore → bore + wall
    const innerRingGeo = makeRing(ri_outer, ri_outer + raceW, B);

    // Ball geometries — SphereGeometry ships indexed, but the rings come from
    // ExtrudeGeometry which is non-indexed. mergeGeometries silently returns
    // null on index/non-index mismatch, so normalize everything first.
    const ballGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const bx = pitchR * Math.cos(angle);
      const bz = pitchR * Math.sin(angle);
      const ball = new THREE.SphereGeometry(ballR, 12, 8).toNonIndexed();
      ball.translate(bx, 0, bz);
      ballGeos.push(ball);
    }

    const toMerge = [outerRingGeo, innerRingGeo, ...ballGeos].map(g =>
      g.index ? g.toNonIndexed() : g,
    );
    const merged = mergeGeometries(toMerge, false);
    const geometry: THREE.BufferGeometry = merged ?? outerRingGeo;
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);
    const volume_cm3 = meshVolume(geometry) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    return {
      geometry,
      edgeGeometry,
      volume_cm3,
      surface_area_cm2,
      bbox: { w: Math.round(D), h: Math.round(B), d: Math.round(D) },
    };
  },
};
