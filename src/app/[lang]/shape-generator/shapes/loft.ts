import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

/**
 * Loft shape generator.
 * Creates a smooth transition (loft) between two profiles at different heights,
 * with optional twist.
 */

const POINT_COUNT = 32;

function generateCirclePoints(radius: number, count: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    pts.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  return pts;
}

function generateSquarePoints(halfSize: number, count: number): THREE.Vector2[] {
  // Distribute points evenly around a square perimeter
  const pts: THREE.Vector2[] = [];
  const perimeter = halfSize * 8; // 4 sides * 2*halfSize
  const step = perimeter / count;

  for (let i = 0; i < count; i++) {
    const dist = i * step;
    let x: number, y: number;

    if (dist < halfSize * 2) {
      // Bottom edge: left to right
      x = -halfSize + dist;
      y = -halfSize;
    } else if (dist < halfSize * 4) {
      // Right edge: bottom to top
      x = halfSize;
      y = -halfSize + (dist - halfSize * 2);
    } else if (dist < halfSize * 6) {
      // Top edge: right to left
      x = halfSize - (dist - halfSize * 4);
      y = halfSize;
    } else {
      // Left edge: top to bottom
      x = -halfSize;
      y = halfSize - (dist - halfSize * 6);
    }

    pts.push(new THREE.Vector2(x, y));
  }
  return pts;
}

function generateHexagonPoints(radius: number, count: number): THREE.Vector2[] {
  // Place points evenly around a hexagon perimeter, like generateSquarePoints
  const pts: THREE.Vector2[] = [];
  const hexVerts: THREE.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    hexVerts.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
  }

  // Compute total perimeter
  let perimeter = 0;
  for (let i = 0; i < 6; i++) {
    const a = hexVerts[i];
    const b = hexVerts[(i + 1) % 6];
    perimeter += a.distanceTo(b);
  }

  const stepDist = perimeter / count;

  // Walk along edges, placing points at equal intervals
  let edgeIdx = 0;
  let edgeProgress = 0; // distance along current edge
  let edgeLen = hexVerts[0].distanceTo(hexVerts[1]);

  for (let i = 0; i < count; i++) {
    const targetDist = i * stepDist;
    const accumulated = 0;

    // Find which edge this point falls on
    edgeIdx = 0;
    edgeProgress = 0;
    let runDist = 0;
    for (let e = 0; e < 6; e++) {
      const a = hexVerts[e];
      const b = hexVerts[(e + 1) % 6];
      const len = a.distanceTo(b);
      if (runDist + len >= targetDist || e === 5) {
        edgeIdx = e;
        edgeProgress = targetDist - runDist;
        edgeLen = len;
        break;
      }
      runDist += len;
    }

    const t = edgeLen > 0 ? Math.min(edgeProgress / edgeLen, 1) : 0;
    const a = hexVerts[edgeIdx];
    const b = hexVerts[(edgeIdx + 1) % 6];
    pts.push(new THREE.Vector2(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
    ));
  }

  return pts;
}

function getProfilePoints(shapeType: number, size: number, count: number): THREE.Vector2[] {
  switch (shapeType) {
    case 1: return generateSquarePoints(size / 2, count);
    case 2: return generateHexagonPoints(size / 2, count);
    default: return generateCirclePoints(size / 2, count);
  }
}

export const loftShape: ShapeConfig = {
  id: 'loft',
  tier: 2,
  icon: '🔄',
  params: [
    { key: 'bottomShape', labelKey: 'paramBottomShape', default: 0, min: 0, max: 2, step: 1, unit: '' },
    { key: 'topShape',    labelKey: 'paramTopShape',    default: 0, min: 0, max: 2, step: 1, unit: '' },
    { key: 'bottomSize',  labelKey: 'paramBottomSize',  default: 40, min: 5, max: 200, step: 1, unit: 'mm' },
    { key: 'topSize',     labelKey: 'paramTopSize',     default: 20, min: 5, max: 200, step: 1, unit: 'mm' },
    { key: 'height',      labelKey: 'paramHeight',      default: 80, min: 10, max: 500, step: 1, unit: 'mm' },
    { key: 'twist',       labelKey: 'paramTwist',       default: 0, min: 0, max: 360, step: 5, unit: '°' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const bottomType = Math.round(p.bottomShape);
    const topType = Math.round(p.topShape);
    const bottomSize = p.bottomSize;
    const topSize = p.topSize;
    const height = p.height;
    const twistAngle = (p.twist * Math.PI) / 180;

    const n = POINT_COUNT; // points per ring
    const layers = 64;     // number of vertical layers

    // Generate bottom and top profile points
    const bottomPts = getProfilePoints(bottomType, bottomSize, n);
    const topPts = getProfilePoints(topType, topSize, n);

    // Build vertices: layers of interpolated rings
    const vertices: number[] = [];
    const indices: number[] = [];

    for (let layer = 0; layer <= layers; layer++) {
      const t = layer / layers;
      const y = t * height - height / 2; // center vertically
      const twist = t * twistAngle;
      const cosT = Math.cos(twist);
      const sinT = Math.sin(twist);

      for (let i = 0; i < n; i++) {
        // Interpolate between bottom and top profiles
        const bx = bottomPts[i].x;
        const bz = bottomPts[i].y;
        const tx = topPts[i].x;
        const tz = topPts[i].y;

        const x = bx + (tx - bx) * t;
        const z = bz + (tz - bz) * t;

        // Apply twist rotation around Y axis
        const rx = x * cosT - z * sinT;
        const rz = x * sinT + z * cosT;

        vertices.push(rx, y, rz);
      }
    }

    // Build side faces (quad strips between layers)
    for (let layer = 0; layer < layers; layer++) {
      for (let i = 0; i < n; i++) {
        const nextI = (i + 1) % n;
        const curr = layer * n + i;
        const next = layer * n + nextI;
        const currUp = (layer + 1) * n + i;
        const nextUp = (layer + 1) * n + nextI;

        // Two triangles per quad
        indices.push(curr, next, currUp);
        indices.push(next, nextUp, currUp);
      }
    }

    // Bottom cap (triangle fan at layer 0, center = average of bottom points)
    const bottomCenterIdx = vertices.length / 3;
    vertices.push(0, -height / 2, 0); // center point
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      indices.push(bottomCenterIdx, nextI, i); // reversed winding for outward normal
    }

    // Top cap (triangle fan at last layer)
    const topCenterIdx = vertices.length / 3;
    const topCosT = Math.cos(twistAngle);
    const topSinT = Math.sin(twistAngle);
    vertices.push(0, height / 2, 0); // center point (twist doesn't affect center)
    const topLayerStart = layers * n;
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      indices.push(topCenterIdx, topLayerStart + i, topLayerStart + nextI);
    }

    // Build BufferGeometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
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
