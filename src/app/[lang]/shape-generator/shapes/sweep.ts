import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

/**
 * Sweep shape generator.
 * Extrudes a cross-section profile (circle, rectangle, hexagon) along a curved path
 * (helix, sine wave, or arc).
 */

function makeCircleShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const segments = 24;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

function makeRectangleShape(halfWidth: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -halfWidth);
  shape.lineTo(halfWidth, -halfWidth);
  shape.lineTo(halfWidth, halfWidth);
  shape.lineTo(-halfWidth, halfWidth);
  shape.lineTo(-halfWidth, -halfWidth);
  return shape;
}

function makeHexagonShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

function buildPath(pathType: number, length: number, amplitude: number, turns: number): THREE.CatmullRomCurve3 {
  const pointCount = 200;
  const pts: THREE.Vector3[] = [];

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;

    if (pathType === 0) {
      // Helix
      const angle = t * turns * Math.PI * 2;
      pts.push(new THREE.Vector3(
        amplitude * Math.cos(angle),
        t * length,
        amplitude * Math.sin(angle),
      ));
    } else if (pathType === 1) {
      // Sine wave
      const angle = t * turns * Math.PI * 2;
      pts.push(new THREE.Vector3(
        amplitude * Math.sin(angle),
        t * length,
        0,
      ));
    } else {
      // Arc
      const arcAngle = t * Math.PI * (turns / 3);
      const r = length / Math.max(arcAngle, 0.01);
      const effectiveR = Math.min(r, length * 2);
      pts.push(new THREE.Vector3(
        amplitude * Math.sin(arcAngle),
        effectiveR * (1 - Math.cos(arcAngle)) * (length / (effectiveR || 1)),
        0,
      ));
    }
  }

  return new THREE.CatmullRomCurve3(pts, false);
}

export const sweepShape: ShapeConfig = {
  id: 'sweep',
  tier: 2,
  icon: '🔀',
  params: [
    { key: 'profileShape', labelKey: 'paramProfileShape', default: 0, min: 0, max: 2, step: 1, unit: '' },
    { key: 'profileSize',  labelKey: 'paramProfileSize',  default: 15, min: 1, max: 100, step: 1, unit: 'mm' },
    { key: 'pathType',     labelKey: 'paramPathType',      default: 0, min: 0, max: 2, step: 1, unit: '' },
    { key: 'pathLength',   labelKey: 'paramPathLength',    default: 100, min: 10, max: 500, step: 1, unit: 'mm' },
    { key: 'pathAmplitude', labelKey: 'paramPathAmplitude', default: 30, min: 0, max: 200, step: 1, unit: 'mm' },
    { key: 'pathTurns',    labelKey: 'paramPathTurns',     default: 3, min: 0.5, max: 10, step: 0.5, unit: '' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const profileType = Math.round(p.profileShape);
    const profileSize = p.profileSize;
    const pathType = Math.round(p.pathType);
    const pathLength = p.pathLength;
    const pathAmplitude = p.pathAmplitude;
    const pathTurns = p.pathTurns;

    // Build the path curve
    const path = buildPath(pathType, pathLength, pathAmplitude, pathTurns);

    let geometry: THREE.BufferGeometry;

    if (profileType === 0) {
      // Circle profile: use TubeGeometry for best results
      geometry = new THREE.TubeGeometry(path, 128, profileSize, 24, false);
    } else {
      // Rectangle or Hexagon: use ExtrudeGeometry with extrudePath
      const profile = profileType === 1
        ? makeRectangleShape(profileSize)
        : makeHexagonShape(profileSize);

      const extrudeSettings: THREE.ExtrudeGeometryOptions = {
        steps: 128,
        extrudePath: path,
      };
      geometry = new THREE.ExtrudeGeometry(profile, extrudeSettings);
    }

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = meshVolume(geometry) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    const bb = geometry.boundingBox!;
    const bbox = {
      w: Math.round(bb.max.x - bb.min.x),
      h: Math.round(bb.max.y - bb.min.y),
      d: Math.round(bb.max.z - bb.min.z),
    };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
