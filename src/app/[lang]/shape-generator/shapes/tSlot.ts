/**
 * T-슬롯 프로파일 (알루미늄 압출재)
 * 20x20, 30x30, 40x40 등 구조재로 쓰이는 T홈 프로파일
 */
import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

export const tSlotShape: ShapeConfig = {
  id: 'tSlot',
  tier: 1,
  icon: '⊓',
  params: [
    { key: 'profileSize',  labelKey: 'paramProfileSize', default: 40, min: 10, max: 160, step: 5,  unit: 'mm' },
    { key: 'length',       labelKey: 'paramLength',      default: 200, min: 10, max: 2000, step: 10, unit: 'mm' },
    { key: 'wallThick',    labelKey: 'paramWallThick',   default: 3,  min: 1,  max: 10,  step: 0.5, unit: 'mm' },
    { key: 'slotWidth',    labelKey: 'paramSlotWidth',   default: 8,  min: 3,  max: 20,  step: 0.5, unit: 'mm' },
    { key: 'slotDepth',    labelKey: 'paramSlotDepth',   default: 6,  min: 2,  max: 15,  step: 0.5, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const S  = p.profileSize;   // 단면 크기 (정사각)
    const L  = p.length;
    const tw = p.wallThick;
    const sw = p.slotWidth;
    const sd = p.slotDepth;

    // ── 단면 쉐이프: 정사각 외곽 - 내부 공간 + T홈 4면
    const shape = new THREE.Shape();

    // 외곽 정사각
    shape.moveTo(-S/2, -S/2);
    shape.lineTo( S/2, -S/2);
    shape.lineTo( S/2,  S/2);
    shape.lineTo(-S/2,  S/2);
    shape.closePath();

    // 내부 빈 공간 (hole)
    const inner = new THREE.Path();
    inner.moveTo(-S/2 + tw, -S/2 + tw);
    inner.lineTo( S/2 - tw, -S/2 + tw);
    inner.lineTo( S/2 - tw,  S/2 - tw);
    inner.lineTo(-S/2 + tw,  S/2 - tw);
    inner.closePath();
    shape.holes.push(inner);

    // 4면 T홈 (각 면 중앙)
    const slotHW = sw / 2;
    const slotNeckW = sw * 0.55; // neck (좁아지는 부분)
    const slotNeckHW = slotNeckW / 2;

    const sides: { dx: number; dy: number; normal: 'x' | 'y' }[] = [
      { dx: 0,    dy: -1,  normal: 'y' }, // bottom
      { dx: 0,    dy:  1,  normal: 'y' }, // top
      { dx: -1,   dy: 0,   normal: 'x' }, // left
      { dx:  1,   dy: 0,   normal: 'x' }, // right
    ];

    for (const side of sides) {
      const slot = new THREE.Path();
      if (side.normal === 'y') {
        const baseY = side.dy < 0 ? -S/2 : S/2;
        const depthDir = side.dy < 0 ? 1 : -1;
        // Opening (neck)
        slot.moveTo(-slotNeckHW, baseY);
        slot.lineTo(-slotHW, baseY + depthDir * sd);
        slot.lineTo( slotHW, baseY + depthDir * sd);
        slot.lineTo( slotNeckHW, baseY);
        slot.closePath();
      } else {
        const baseX = side.dx < 0 ? -S/2 : S/2;
        const depthDir = side.dx < 0 ? 1 : -1;
        slot.moveTo(baseX,                           -slotNeckHW);
        slot.lineTo(baseX + depthDir * sd,           -slotHW);
        slot.lineTo(baseX + depthDir * sd,            slotHW);
        slot.lineTo(baseX,                            slotNeckHW);
        slot.closePath();
      }
      shape.holes.push(slot);
    }

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: L,
      bevelEnabled: false,
    });
    // 중심 정렬: Z → Y축
    geometry.translate(0, 0, -L / 2);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);
    const volume_cm3 = meshVolume(geometry) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    return {
      geometry,
      edgeGeometry,
      volume_cm3,
      surface_area_cm2,
      bbox: { w: Math.round(S), h: Math.round(L), d: Math.round(S) },
    };
  },
};
