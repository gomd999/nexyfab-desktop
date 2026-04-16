/**
 * 코일 스프링 (Compression/Extension Spring)
 * TubeGeometry로 헬릭스 경로 생성
 */
import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  private radius: number;
  private numCoils: number;
  private pitch: number;
  private totalHeight: number;

  constructor(radius: number, numCoils: number, pitch: number) {
    super();
    this.radius = radius;
    this.numCoils = numCoils;
    this.pitch = pitch;
    this.totalHeight = numCoils * pitch;
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = t * this.numCoils * Math.PI * 2;
    const y = t * this.totalHeight - this.totalHeight / 2;
    return target.set(
      this.radius * Math.cos(angle),
      y,
      this.radius * Math.sin(angle),
    );
  }
}

export const springShape: ShapeConfig = {
  id: 'spring',
  tier: 1,
  icon: '🌀',
  params: [
    { key: 'coilDiameter',  labelKey: 'paramCoilDiameter',  default: 30, min: 5,  max: 200, step: 1,   unit: 'mm' },
    { key: 'wireDiameter',  labelKey: 'paramWireDiameter',  default: 4,  min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    { key: 'numCoils',      labelKey: 'paramNumCoils',      default: 8,  min: 2,  max: 30,  step: 1,   unit: '' },
    { key: 'freeLength',    labelKey: 'paramFreeLength',    default: 80, min: 10, max: 500, step: 1,   unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const R    = p.coilDiameter / 2;
    const rw   = p.wireDiameter / 2;
    const n    = Math.max(2, Math.round(p.numCoils));
    const L    = p.freeLength;
    const pitch = L / n;

    const helix = new HelixCurve(R, n, pitch);
    const tubeSeg = Math.max(8, Math.round(n * 48));
    const radSeg  = 12;

    let geometry: THREE.BufferGeometry;
    try {
      geometry = new THREE.TubeGeometry(helix, tubeSeg, rw, radSeg, false);
    } catch {
      geometry = new THREE.SphereGeometry(R, 16, 16);
    }
    geometry.computeVertexNormals();
    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = meshVolume(geometry) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    const outerD = (R + rw) * 2;
    return {
      geometry,
      edgeGeometry,
      volume_cm3,
      surface_area_cm2,
      bbox: {
        w: Math.round(outerD),
        h: Math.round(L + rw * 2),
        d: Math.round(outerD),
      },
    };
  },
};
