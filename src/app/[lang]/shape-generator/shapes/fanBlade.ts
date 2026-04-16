import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

/**
 * Axial fan blade generator.
 * Creates a central hub with curved, tapered blades that look like a real fan.
 */

function createCurvedBlade(
  hubR: number,
  outerR: number,
  bladeWidth: number,
  pitchAngle: number,
  bladeThickness: number,
): THREE.BufferGeometry {
  const radialSegs = 12;
  const widthSegs = 6;
  const bladeLength = outerR - hubR;

  const vertices: number[] = [];
  const indices: number[] = [];

  // Generate blade surface — curved with twist and taper
  for (let j = 0; j <= widthSegs; j++) {
    const wt = j / widthSegs; // 0 at bottom, 1 at top
    const yOff = (wt - 0.5) * bladeWidth;

    for (let i = 0; i <= radialSegs; i++) {
      const rt = i / radialSegs; // 0 at hub, 1 at tip
      const r = hubR + rt * bladeLength;

      // Taper: blade gets narrower toward tip (width factor)
      const taper = 1.0 - rt * 0.4;
      const localY = yOff * taper;

      // Progressive twist: more pitch near hub, less at tip
      const twist = pitchAngle * (1.0 - rt * 0.3);
      const twistRad = twist;

      // Slight curvature (concave shape like real fan blade)
      const curve = Math.sin(rt * Math.PI) * bladeLength * 0.06;

      // Apply twist rotation around X axis
      const y = localY * Math.cos(twistRad) - curve * Math.sin(twistRad);
      const z = localY * Math.sin(twistRad) + curve * Math.cos(twistRad);

      vertices.push(r, y, z);
    }
  }

  // Create faces
  for (let j = 0; j < widthSegs; j++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = j * (radialSegs + 1) + i;
      const b = a + 1;
      const c = a + (radialSegs + 1);
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // Create front face
  const frontVerts = vertices.length / 3;
  for (let j = 0; j <= widthSegs; j++) {
    for (let i = 0; i <= radialSegs; i++) {
      const idx = j * (radialSegs + 1) + i;
      const x = vertices[idx * 3];
      const y = vertices[idx * 3 + 1];
      const z = vertices[idx * 3 + 2];
      vertices.push(x, y, z + bladeThickness);
    }
  }

  // Back face indices
  for (let j = 0; j < widthSegs; j++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = frontVerts + j * (radialSegs + 1) + i;
      const b = a + 1;
      const c = a + (radialSegs + 1);
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Side edges (connect front and back faces)
  // Top edge
  for (let i = 0; i < radialSegs; i++) {
    const fIdx = widthSegs * (radialSegs + 1) + i;
    const bIdx = frontVerts + widthSegs * (radialSegs + 1) + i;
    indices.push(fIdx, fIdx + 1, bIdx);
    indices.push(fIdx + 1, bIdx + 1, bIdx);
  }
  // Bottom edge
  for (let i = 0; i < radialSegs; i++) {
    const fIdx = i;
    const bIdx = frontVerts + i;
    indices.push(fIdx, bIdx, fIdx + 1);
    indices.push(fIdx + 1, bIdx, bIdx + 1);
  }
  // Tip edge
  for (let j = 0; j < widthSegs; j++) {
    const fIdx = j * (radialSegs + 1) + radialSegs;
    const bIdx = frontVerts + j * (radialSegs + 1) + radialSegs;
    const fNext = (j + 1) * (radialSegs + 1) + radialSegs;
    const bNext = frontVerts + (j + 1) * (radialSegs + 1) + radialSegs;
    indices.push(fIdx, bIdx, fNext);
    indices.push(fNext, bIdx, bNext);
  }
  // Hub edge
  for (let j = 0; j < widthSegs; j++) {
    const fIdx = j * (radialSegs + 1);
    const bIdx = frontVerts + j * (radialSegs + 1);
    const fNext = (j + 1) * (radialSegs + 1);
    const bNext = frontVerts + (j + 1) * (radialSegs + 1);
    indices.push(fIdx, fNext, bIdx);
    indices.push(fNext, bNext, bIdx);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export const fanBladeShape: ShapeConfig = {
  id: 'fanBlade',
  tier: 2,
  icon: '🌀',
  params: [
    { key: 'bladeCount',     labelKey: 'paramBladeCount',     default: 5,   min: 2,   max: 12,   step: 1, unit: '개' },
    { key: 'outerDiameter',  labelKey: 'paramOuterDiameter',  default: 300, min: 50,  max: 1000, step: 1, unit: 'mm' },
    { key: 'hubDiameter',    labelKey: 'paramHubDiameter',    default: 60,  min: 10,  max: 200,  step: 1, unit: 'mm' },
    { key: 'bladeWidth',     labelKey: 'paramBladeWidth',     default: 30,  min: 5,   max: 100,  step: 1, unit: 'mm' },
    { key: 'pitchAngle',     labelKey: 'paramPitchAngle',     default: 25,  min: 5,   max: 60,   step: 1, unit: '°' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const bladeCount = Math.round(p.bladeCount);
    const outerR = p.outerDiameter / 2;
    const hubR = p.hubDiameter / 2;
    const bladeWidth = p.bladeWidth;
    const pitchAngle = (p.pitchAngle * Math.PI) / 180;
    const bladeThickness = 3;
    const segments = 48;

    const geometries: THREE.BufferGeometry[] = [];

    // ── Hub: cylinder along Y axis ──
    const hubGeo = new THREE.CylinderGeometry(hubR, hubR, bladeWidth, segments);
    hubGeo.deleteAttribute('uv');
    hubGeo.deleteAttribute('normal');
    geometries.push(hubGeo);

    // ── Hub cap (rounded top) ──
    const capGeo = new THREE.SphereGeometry(hubR * 0.85, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.translate(0, bladeWidth / 2, 0);
    capGeo.deleteAttribute('uv');
    capGeo.deleteAttribute('normal');
    geometries.push(capGeo);

    // ── Curved blades ──
    for (let i = 0; i < bladeCount; i++) {
      const angle = (2 * Math.PI * i) / bladeCount;

      const bladeGeo = createCurvedBlade(hubR, outerR, bladeWidth, pitchAngle, bladeThickness);

      // Rotate blade around Y axis to its angular position
      const rotMatrix = new THREE.Matrix4().makeRotationY(angle);
      bladeGeo.applyMatrix4(rotMatrix);

      // Strip normal attribute so all geometries match (only position + index)
      if (bladeGeo.hasAttribute('normal')) bladeGeo.deleteAttribute('normal');
      if (bladeGeo.hasAttribute('uv')) bladeGeo.deleteAttribute('uv');

      geometries.push(bladeGeo);
    }

    const merged = mergeGeometries(geometries, false);
    if (!merged) throw new Error('fanBlade mergeGeometries failed');
    const geometry = merged;
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    // Volume: hub + blades (approximate)
    const hubVolume = Math.PI * hubR * hubR * bladeWidth;
    const bladeLength = outerR - hubR;
    const bladeVolume = bladeCount * bladeLength * bladeWidth * bladeThickness * 0.7; // taper factor
    const volume_cm3 = (hubVolume + bladeVolume) / 1000;

    // Surface area approximate
    const hubLateral = 2 * Math.PI * hubR * bladeWidth;
    const hubEnds = 2 * Math.PI * hubR * hubR;
    const bladeSA = bladeCount * (
      2 * bladeLength * bladeWidth * 0.8 +
      2 * bladeLength * bladeThickness +
      2 * bladeWidth * bladeThickness
    );
    const surface_area_cm2 = (hubLateral + hubEnds + bladeSA) / 100;

    const bboxDia = Math.round(p.outerDiameter);
    const bbox = { w: bboxDia, h: Math.round(bladeWidth), d: bboxDia };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
