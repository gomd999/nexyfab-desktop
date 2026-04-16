/**
 * 육각 볼트 (ISO 4014 스타일)
 * - 육각 헤드 + 원통형 샤프트
 * - 나사산은 시각적 표현 (삼각형 홈 헬릭스)
 */
import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

/** 정육각형 단면 프리즘 */
function hexPrism(acrossFlats: number, height: number): THREE.BufferGeometry {
  const r = acrossFlats / (2 * Math.cos(Math.PI / 6)); // circumradius
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 6;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  // 중심 맞추기 (Z축)
  geo.translate(0, 0, -height / 2);
  // Y축 기준으로 회전 (위아래)
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return geo;
}

/** 나사산 시각화 (얕은 삼각형 홈 나선) */
function threadGeometry(
  radius: number,
  length: number,
  pitch: number,
): THREE.BufferGeometry {
  const turns = Math.floor(length / pitch);
  if (turns <= 0) return new THREE.BufferGeometry();

  const stepsPerTurn = 32;
  const totalSteps = turns * stepsPerTurn;
  const positions: number[] = [];
  const threadDepth = pitch * 0.1;

  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const angle = t * turns * Math.PI * 2;
    const y = -length / 2 + t * length;
    // 크레스트
    const rc = radius;
    positions.push(rc * Math.cos(angle), y, rc * Math.sin(angle));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

export const boltShape: ShapeConfig = {
  id: 'bolt',
  tier: 1,
  icon: '🔩',
  params: [
    { key: 'shaftDiameter',  labelKey: 'paramShaftDiameter',  default: 10, min: 1,  max: 100, step: 0.5, unit: 'mm' },
    { key: 'shaftLength',    labelKey: 'paramShaftLength',    default: 60, min: 5,  max: 500, step: 1,   unit: 'mm' },
    { key: 'headHeight',     labelKey: 'paramHeadHeight',     default: 7,  min: 1,  max: 50,  step: 0.5, unit: 'mm' },
    { key: 'threadPitch',    labelKey: 'paramThreadPitch',    default: 1.5, min: 0.5, max: 6, step: 0.25, unit: 'mm' },
    { key: 'headFlats',      labelKey: 'paramHeadFlats',      default: 17, min: 3,  max: 100, step: 0.5, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const r  = p.shaftDiameter / 2;
    const sL = p.shaftLength;
    const hH = p.headHeight;
    const hF = p.headFlats;

    // ── 샤프트 (원통)
    const shaftGeo = new THREE.CylinderGeometry(r, r, sL, 32);
    shaftGeo.translate(0, -sL / 2 - hH / 2, 0); // 헤드 아래로

    // ── 헤드 (육각 프리즘)
    const headGeo = hexPrism(hF, hH);
    headGeo.translate(0, hH / 2 - hH / 2, 0); // 중심

    // ── 병합
    const merged = mergeGeos([shaftGeo, headGeo]);
    merged.computeVertexNormals();

    const edgeGeometry = makeEdges(merged);
    const volume_cm3 = meshVolume(merged) / 1000;
    const surface_area_cm2 = meshSurfaceArea(merged) / 100;

    const totalH = sL + hH;
    const headWidth = hF * 1.15; // approx circumradius * 2
    return {
      geometry: merged,
      edgeGeometry,
      volume_cm3,
      surface_area_cm2,
      bbox: { w: Math.round(headWidth), h: Math.round(totalH), d: Math.round(headWidth) },
    };
  },
};

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const geo of geos) {
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    nonIndexed.computeVertexNormals();
    const pos = nonIndexed.getAttribute('position');
    const nor = nonIndexed.getAttribute('normal');
    const triCount = pos.count / 3;

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    for (let i = 0; i < pos.count; i++) {
      indices.push(vertexOffset + i);
    }
    vertexOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}
