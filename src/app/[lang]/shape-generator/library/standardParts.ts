import * as THREE from 'three';
import { makeEdges, meshVolume, meshSurfaceArea } from '../shapes/index';
import type { ShapeResult } from '../shapes/index';

export interface StandardPart {
  id: string;
  category: 'fastener' | 'structural' | 'bearing' | 'connector';
  standard: string;
  icon: string;
  tier: 1 | 2;
  params: Array<{
    key: string; labelKey: string; default: number;
    min: number; max: number; step: number; unit: string;
  }>;
  generate: (p: Record<string, number>) => ShapeResult;
}

function buildResult(geo: THREE.BufferGeometry): ShapeResult {
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  return {
    geometry: geo,
    edgeGeometry: makeEdges(geo),
    volume_cm3: meshVolume(geo) / 1000,
    surface_area_cm2: meshSurfaceArea(geo) / 100,
    bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) },
  };
}

// ─── Hex Bolt (ISO 4014) ────────────────────────────────────────────────────

const hexBolt: StandardPart = {
  id: 'hexBolt', category: 'fastener', standard: 'ISO 4014', icon: '🔩', tier: 1,
  params: [
    { key: 'diameter', labelKey: 'paramDiameter', default: 10, min: 3, max: 30, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 40, min: 10, max: 200, step: 5, unit: 'mm' },
    { key: 'headHeight', labelKey: 'paramHeight', default: 7, min: 2, max: 20, step: 0.5, unit: 'mm' },
  ],
  generate(p) {
    const d = p.diameter;
    const len = p.length;
    const hh = p.headHeight;
    const af = d * 1.73; // across flats ≈ 1.73 × d

    // Hex head
    const headShape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = (af / 2) * Math.cos(angle);
      const y = (af / 2) * Math.sin(angle);
      if (i === 0) headShape.moveTo(x, y);
      else headShape.lineTo(x, y);
    }
    headShape.closePath();
    const headGeo = new THREE.ExtrudeGeometry(headShape, { depth: hh, bevelEnabled: false });
    headGeo.rotateX(-Math.PI / 2);
    headGeo.translate(0, len + hh, 0);

    // Shaft
    const shaftGeo = new THREE.CylinderGeometry(d / 2, d / 2, len, 24);
    shaftGeo.translate(0, len / 2, 0);

    // Merge
    const merged = new THREE.BufferGeometry();
    const geos = [headGeo, shaftGeo];
    let totalVerts = 0;
    for (const g of geos) {
      const ng = g.index ? g.toNonIndexed() : g;
      totalVerts += ng.attributes.position.count;
    }
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    let offset = 0;
    for (const g of geos) {
      const ng = g.index ? g.toNonIndexed() : g;
      const pos = ng.attributes.position;
      const norm = ng.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        positions[offset] = pos.getX(i); positions[offset + 1] = pos.getY(i); positions[offset + 2] = pos.getZ(i);
        normals[offset] = norm.getX(i); normals[offset + 1] = norm.getY(i); normals[offset + 2] = norm.getZ(i);
        offset += 3;
      }
    }
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return buildResult(merged);
  },
};

// ─── Hex Nut (ISO 4032) ─────────────────────────────────────────────────────

const hexNut: StandardPart = {
  id: 'hexNut', category: 'fastener', standard: 'ISO 4032', icon: '⬡', tier: 1,
  params: [
    { key: 'diameter', labelKey: 'paramDiameter', default: 10, min: 3, max: 30, step: 1, unit: 'mm' },
    { key: 'height', labelKey: 'paramHeight', default: 8, min: 2, max: 25, step: 0.5, unit: 'mm' },
  ],
  generate(p) {
    const d = p.diameter;
    const h = p.height;
    const af = d * 1.73;

    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = (af / 2) * Math.cos(angle);
      const y = (af / 2) * Math.sin(angle);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    // Center hole
    const holePath = new THREE.Path();
    const holeR = d / 2;
    for (let i = 0; i <= 32; i++) {
      const a = (2 * Math.PI * i) / 32;
      if (i === 0) holePath.moveTo(holeR * Math.cos(a), holeR * Math.sin(a));
      else holePath.lineTo(holeR * Math.cos(a), holeR * Math.sin(a));
    }
    shape.holes.push(holePath);

    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h / 2, 0);
    return buildResult(geo);
  },
};

// ─── Socket Head Cap Screw (ISO 4762) ───────────────────────────────────────

const socketHeadCapScrew: StandardPart = {
  id: 'socketHeadCapScrew', category: 'fastener', standard: 'ISO 4762', icon: '🔧', tier: 1,
  params: [
    { key: 'diameter', labelKey: 'paramDiameter', default: 8, min: 3, max: 24, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 30, min: 8, max: 150, step: 5, unit: 'mm' },
  ],
  generate(p) {
    const d = p.diameter;
    const len = p.length;
    const headD = d * 1.5;
    const headH = d;

    // Cylindrical head
    const headGeo = new THREE.CylinderGeometry(headD / 2, headD / 2, headH, 32);
    headGeo.translate(0, len + headH / 2, 0);

    // Shaft
    const shaftGeo = new THREE.CylinderGeometry(d / 2, d / 2, len, 24);
    shaftGeo.translate(0, len / 2, 0);

    // Hex socket (subtracted visually as indentation)
    const socketGeo = new THREE.CylinderGeometry(d * 0.45, d * 0.45, headH * 0.6, 6);
    socketGeo.translate(0, len + headH - headH * 0.3, 0);

    // Merge head and shaft
    const geos = [headGeo, shaftGeo];
    let totalVerts = 0;
    for (const g of geos) { const ng = g.index ? g.toNonIndexed() : g; totalVerts += ng.attributes.position.count; }
    const positions = new Float32Array(totalVerts * 3);
    let offset = 0;
    for (const g of geos) {
      const ng = g.index ? g.toNonIndexed() : g;
      const pos = ng.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        positions[offset++] = pos.getX(i); positions[offset++] = pos.getY(i); positions[offset++] = pos.getZ(i);
      }
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return buildResult(merged);
  },
};

// ─── Flat Washer (ISO 7089) ─────────────────────────────────────────────────

const flatWasher: StandardPart = {
  id: 'flatWasher', category: 'fastener', standard: 'ISO 7089', icon: '⊙', tier: 1,
  params: [
    { key: 'innerDiameter', labelKey: 'paramInnerDiameter', default: 10, min: 3, max: 30, step: 1, unit: 'mm' },
    { key: 'outerDiameter', labelKey: 'paramOuterDiameter', default: 20, min: 6, max: 60, step: 1, unit: 'mm' },
    { key: 'thickness', labelKey: 'paramThickness', default: 2, min: 0.5, max: 5, step: 0.5, unit: 'mm' },
  ],
  generate(p) {
    const ri = p.innerDiameter / 2;
    const ro = p.outerDiameter / 2;
    const h = p.thickness;
    const shape = new THREE.Shape();
    for (let i = 0; i <= 64; i++) {
      const a = (2 * Math.PI * i) / 64;
      if (i === 0) shape.moveTo(ro * Math.cos(a), ro * Math.sin(a));
      else shape.lineTo(ro * Math.cos(a), ro * Math.sin(a));
    }
    const hole = new THREE.Path();
    for (let i = 0; i <= 64; i++) {
      const a = (2 * Math.PI * i) / 64;
      if (i === 0) hole.moveTo(ri * Math.cos(a), ri * Math.sin(a));
      else hole.lineTo(ri * Math.cos(a), ri * Math.sin(a));
    }
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    return buildResult(geo);
  },
};

// ─── Spring Washer (DIN 127) ────────────────────────────────────────────────

const springWasher: StandardPart = {
  id: 'springWasher', category: 'fastener', standard: 'DIN 127', icon: '◎', tier: 2,
  params: [
    { key: 'diameter', labelKey: 'paramDiameter', default: 10, min: 3, max: 30, step: 1, unit: 'mm' },
    { key: 'thickness', labelKey: 'paramThickness', default: 2.5, min: 1, max: 6, step: 0.5, unit: 'mm' },
  ],
  generate(p) {
    const r = p.diameter / 2 * 1.1;
    const ri = p.diameter / 2;
    const t = p.thickness;
    const segs = 64;
    // Create a helical ring with a gap
    const positions: number[] = [];
    const halfT = t / 2;
    const gap = Math.PI / 8;

    for (let i = 0; i < segs; i++) {
      const a1 = gap + (2 * Math.PI - 2 * gap) * (i / segs);
      const a2 = gap + (2 * Math.PI - 2 * gap) * ((i + 1) / segs);
      const h1 = -halfT + t * (i / segs);
      const h2 = -halfT + t * ((i + 1) / segs);

      // Outer quad
      const ox1 = r * Math.cos(a1), oz1 = r * Math.sin(a1);
      const ox2 = r * Math.cos(a2), oz2 = r * Math.sin(a2);
      const ix1 = ri * Math.cos(a1), iz1 = ri * Math.sin(a1);
      const ix2 = ri * Math.cos(a2), iz2 = ri * Math.sin(a2);

      // Top face
      positions.push(ix1, h1, iz1, ox1, h1, oz1, ox2, h2, oz2);
      positions.push(ix1, h1, iz1, ox2, h2, oz2, ix2, h2, iz2);
      // Bottom face
      positions.push(ix1, h1 - halfT * 0.3, iz1, ox2, h2 - halfT * 0.3, oz2, ox1, h1 - halfT * 0.3, oz1);
      positions.push(ix1, h1 - halfT * 0.3, iz1, ix2, h2 - halfT * 0.3, iz2, ox2, h2 - halfT * 0.3, oz2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    return buildResult(geo);
  },
};

// ─── I-Beam ─────────────────────────────────────────────────────────────────

const iBeam: StandardPart = {
  id: 'iBeam', category: 'structural', standard: 'ISO 657', icon: '🏗️', tier: 1,
  params: [
    { key: 'height', labelKey: 'paramHeight', default: 100, min: 50, max: 500, step: 10, unit: 'mm' },
    { key: 'width', labelKey: 'paramWidth', default: 50, min: 20, max: 300, step: 5, unit: 'mm' },
    { key: 'webThickness', labelKey: 'paramThickness', default: 6, min: 2, max: 30, step: 1, unit: 'mm' },
    { key: 'flangeThickness', labelKey: 'paramThickness', default: 8, min: 3, max: 40, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 200, min: 50, max: 2000, step: 50, unit: 'mm' },
  ],
  generate(p) {
    const h = p.height, w = p.width, tw = p.webThickness, tf = p.flangeThickness, l = p.length;
    const shape = new THREE.Shape();
    // I-section profile
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2 + tf);
    shape.lineTo(tw / 2, -h / 2 + tf);
    shape.lineTo(tw / 2, h / 2 - tf);
    shape.lineTo(w / 2, h / 2 - tf);
    shape.lineTo(w / 2, h / 2);
    shape.lineTo(-w / 2, h / 2);
    shape.lineTo(-w / 2, h / 2 - tf);
    shape.lineTo(-tw / 2, h / 2 - tf);
    shape.lineTo(-tw / 2, -h / 2 + tf);
    shape.lineTo(-w / 2, -h / 2 + tf);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false });
    geo.translate(0, 0, -l / 2);
    return buildResult(geo);
  },
};

// ─── Angle Bracket (L-Profile) ──────────────────────────────────────────────

const angleBracket: StandardPart = {
  id: 'angleBracket', category: 'structural', standard: 'ISO 657', icon: '📐', tier: 1,
  params: [
    { key: 'width', labelKey: 'paramWidth', default: 40, min: 15, max: 200, step: 5, unit: 'mm' },
    { key: 'height', labelKey: 'paramHeight', default: 40, min: 15, max: 200, step: 5, unit: 'mm' },
    { key: 'thickness', labelKey: 'paramThickness', default: 4, min: 2, max: 20, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 150, min: 50, max: 2000, step: 50, unit: 'mm' },
  ],
  generate(p) {
    const w = p.width, h = p.height, t = p.thickness, l = p.length;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(w, 0);
    shape.lineTo(w, t);
    shape.lineTo(t, t);
    shape.lineTo(t, h);
    shape.lineTo(0, h);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false });
    geo.translate(-w / 2, -h / 2, -l / 2);
    return buildResult(geo);
  },
};

// ─── Channel Beam (C-Profile) ───────────────────────────────────────────────

const channelBeam: StandardPart = {
  id: 'channelBeam', category: 'structural', standard: 'ISO 657', icon: '⊏', tier: 2,
  params: [
    { key: 'height', labelKey: 'paramHeight', default: 80, min: 30, max: 400, step: 10, unit: 'mm' },
    { key: 'width', labelKey: 'paramWidth', default: 40, min: 15, max: 200, step: 5, unit: 'mm' },
    { key: 'thickness', labelKey: 'paramThickness', default: 5, min: 2, max: 20, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 200, min: 50, max: 2000, step: 50, unit: 'mm' },
  ],
  generate(p) {
    const h = p.height, w = p.width, t = p.thickness, l = p.length;
    const shape = new THREE.Shape();
    // C-channel profile
    shape.moveTo(0, 0);
    shape.lineTo(w, 0);
    shape.lineTo(w, t);
    shape.lineTo(t, t);
    shape.lineTo(t, h - t);
    shape.lineTo(w, h - t);
    shape.lineTo(w, h);
    shape.lineTo(0, h);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false });
    geo.translate(-w / 2, -h / 2, -l / 2);
    return buildResult(geo);
  },
};

// ─── Ball Bearing ───────────────────────────────────────────────────────────

const ballBearing: StandardPart = {
  id: 'ballBearing', category: 'bearing', standard: 'ISO 15', icon: '⊚', tier: 1,
  params: [
    { key: 'innerDiameter', labelKey: 'paramInnerDiameter', default: 20, min: 5, max: 100, step: 5, unit: 'mm' },
    { key: 'outerDiameter', labelKey: 'paramOuterDiameter', default: 42, min: 10, max: 200, step: 5, unit: 'mm' },
    { key: 'width', labelKey: 'paramWidth', default: 12, min: 4, max: 50, step: 1, unit: 'mm' },
    { key: 'ballCount', labelKey: 'paramBoltCount', default: 8, min: 4, max: 20, step: 1, unit: '' },
  ],
  generate(p) {
    const ri = p.innerDiameter / 2;
    const ro = p.outerDiameter / 2;
    const w = p.width;
    const ballCount = Math.round(p.ballCount);
    const ballR = (ro - ri) * 0.25;
    const ballCenter = (ri + ro) / 2;

    // Outer ring
    const outerGeo = new THREE.CylinderGeometry(ro, ro, w, 48, 1, true);
    // Inner ring
    const innerGeo = new THREE.CylinderGeometry(ri + (ro - ri) * 0.15, ri + (ro - ri) * 0.15, w, 48, 1, true);
    const innerBoreGeo = new THREE.CylinderGeometry(ri, ri, w, 48, 1, true);

    // Balls
    const geos: THREE.BufferGeometry[] = [];
    // Top/bottom caps for outer ring
    const outerRingGeo = new THREE.RingGeometry(ro - (ro - ri) * 0.2, ro, 48);
    outerRingGeo.rotateX(-Math.PI / 2);
    const outerRingTop = outerRingGeo.clone(); outerRingTop.translate(0, w / 2, 0);
    const outerRingBot = outerRingGeo.clone(); outerRingBot.translate(0, -w / 2, 0);
    geos.push(outerGeo, innerGeo, outerRingTop, outerRingBot);

    for (let i = 0; i < ballCount; i++) {
      const angle = (2 * Math.PI * i) / ballCount;
      const ballGeo = new THREE.SphereGeometry(ballR, 16, 16);
      ballGeo.translate(ballCenter * Math.cos(angle), 0, ballCenter * Math.sin(angle));
      geos.push(ballGeo);
    }

    // Merge all geometries
    let totalVerts = 0;
    const nonIndexedGeos = geos.map(g => { const ng = g.index ? g.toNonIndexed() : g; totalVerts += ng.attributes.position.count; return ng; });
    const positions = new Float32Array(totalVerts * 3);
    let offset = 0;
    for (const ng of nonIndexedGeos) {
      const pos = ng.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        positions[offset++] = pos.getX(i); positions[offset++] = pos.getY(i); positions[offset++] = pos.getZ(i);
      }
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return buildResult(merged);
  },
};

// ─── Bushing ────────────────────────────────────────────────────────────────

const bushing: StandardPart = {
  id: 'bushing', category: 'bearing', standard: 'ISO 3547', icon: '◯', tier: 2,
  params: [
    { key: 'innerDiameter', labelKey: 'paramInnerDiameter', default: 15, min: 3, max: 80, step: 1, unit: 'mm' },
    { key: 'outerDiameter', labelKey: 'paramOuterDiameter', default: 20, min: 5, max: 100, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 20, min: 5, max: 100, step: 5, unit: 'mm' },
  ],
  generate(p) {
    const ri = p.innerDiameter / 2;
    const ro = p.outerDiameter / 2;
    const l = p.length;

    const shape = new THREE.Shape();
    for (let i = 0; i <= 64; i++) {
      const a = (2 * Math.PI * i) / 64;
      if (i === 0) shape.moveTo(ro * Math.cos(a), ro * Math.sin(a));
      else shape.lineTo(ro * Math.cos(a), ro * Math.sin(a));
    }
    const hole = new THREE.Path();
    for (let i = 0; i <= 64; i++) {
      const a = (2 * Math.PI * i) / 64;
      if (i === 0) hole.moveTo(ri * Math.cos(a), ri * Math.sin(a));
      else hole.lineTo(ri * Math.cos(a), ri * Math.sin(a));
    }
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, l / 2, 0);
    return buildResult(geo);
  },
};

// ─── Countersunk Screw (ISO 10642 / DIN 7991) ──────────────────────────────

const countersunkScrew: StandardPart = {
  id: 'countersunkScrew', category: 'fastener', standard: 'ISO 10642', icon: '🔩', tier: 2,
  params: [
    { key: 'diameter', labelKey: 'paramDiameter', default: 6, min: 3, max: 20, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 20, min: 8, max: 100, step: 2, unit: 'mm' },
  ],
  generate(p) {
    const d = p.diameter;
    const len = p.length;
    // Head: truncated cone (countersunk). ISO 10642: head diameter ≈ 2×d, head height ≈ 0.6×d
    const headD = d * 2;
    const headH = d * 0.6;
    const headGeo = new THREE.CylinderGeometry(0, headD / 2, headH, 32);
    headGeo.translate(0, len + headH / 2, 0);

    // Shaft
    const shaftGeo = new THREE.CylinderGeometry(d / 2, d / 2, len, 24);
    shaftGeo.translate(0, len / 2, 0);

    const geos = [headGeo, shaftGeo];
    let totalVerts = 0;
    for (const g of geos) { const ng = g.index ? g.toNonIndexed() : g; totalVerts += ng.attributes.position.count; }
    const positions = new Float32Array(totalVerts * 3);
    let offset = 0;
    for (const g of geos) {
      const ng = g.index ? g.toNonIndexed() : g;
      const pos = ng.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        positions[offset++] = pos.getX(i); positions[offset++] = pos.getY(i); positions[offset++] = pos.getZ(i);
      }
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return buildResult(merged);
  },
};

// ─── Set Screw / Grub Screw (ISO 4026) ─────────────────────────────────────

const setScrew: StandardPart = {
  id: 'setScrew', category: 'fastener', standard: 'ISO 4026', icon: '⬤', tier: 2,
  params: [
    { key: 'diameter', labelKey: 'paramDiameter', default: 6, min: 3, max: 16, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 12, min: 4, max: 60, step: 2, unit: 'mm' },
  ],
  generate(p) {
    const geo = new THREE.CylinderGeometry(p.diameter / 2, p.diameter / 2, p.length, 24);
    geo.translate(0, p.length / 2, 0);
    return buildResult(geo);
  },
};

// ─── Thrust Ball Bearing (SKF 51100 series) ─────────────────────────────────

const thrustBearing: StandardPart = {
  id: 'thrustBearing', category: 'bearing', standard: 'SKF 51100', icon: '⊛', tier: 2,
  params: [
    { key: 'innerDiameter', labelKey: 'paramInnerDiameter', default: 20, min: 10, max: 100, step: 5, unit: 'mm' },
    { key: 'thickness', labelKey: 'paramThickness', default: 8, min: 4, max: 20, step: 1, unit: 'mm' },
  ],
  generate(p) {
    const ri = p.innerDiameter / 2;
    // Outer radius: standard thrust bearings have OD ≈ ID * 2.2
    const ro = ri * 2.2;
    const h = p.thickness;

    // Flat annular ring via torus-like approach: use a thin TorusGeometry with
    // tube radius = h/2 centred at the midpoint radially, then wrap into a flat disc shape.
    // Simpler: extruded annular shape (same as washer/bushing pattern).
    const shape = new THREE.Shape();
    for (let i = 0; i <= 64; i++) {
      const a = (2 * Math.PI * i) / 64;
      if (i === 0) shape.moveTo(ro * Math.cos(a), ro * Math.sin(a));
      else shape.lineTo(ro * Math.cos(a), ro * Math.sin(a));
    }
    const hole = new THREE.Path();
    for (let i = 0; i <= 64; i++) {
      const a = (2 * Math.PI * i) / 64;
      if (i === 0) hole.moveTo(ri * Math.cos(a), ri * Math.sin(a));
      else hole.lineTo(ri * Math.cos(a), ri * Math.sin(a));
    }
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h / 2, 0);
    return buildResult(geo);
  },
};

// ─── O-Ring (ISO 3601) ───────────────────────────────────────────────────────

const oring: StandardPart = {
  id: 'oring', category: 'bearing', standard: 'ISO 3601', icon: '○', tier: 2,
  params: [
    { key: 'innerDiameter', labelKey: 'paramInnerDiameter', default: 30, min: 5, max: 300, step: 5, unit: 'mm' },
    { key: 'wireThickness', labelKey: 'paramThickness', default: 3, min: 1.5, max: 8, step: 0.5, unit: 'mm' },
  ],
  generate(p) {
    const wireR = p.wireThickness / 2;
    const torusR = p.innerDiameter / 2 + wireR;
    // TorusGeometry(torusRadius, tubeRadius, radialSegments, tubularSegments)
    const geo = new THREE.TorusGeometry(torusR, wireR, 16, 64);
    // Torus lies in XZ plane by default — keep it flat (Y-up)
    geo.rotateX(Math.PI / 2);
    return buildResult(geo);
  },
};

// ─── Parallel Key / Woodruff Key (ISO 3912) ─────────────────────────────────

const keyway: StandardPart = {
  id: 'keyway', category: 'fastener', standard: 'ISO 3912', icon: '🗝️', tier: 2,
  params: [
    { key: 'keyWidth', labelKey: 'paramWidth', default: 8, min: 2, max: 36, step: 1, unit: 'mm' },
    { key: 'keyHeight', labelKey: 'paramHeight', default: 7, min: 2, max: 20, step: 1, unit: 'mm' },
    { key: 'keyLength', labelKey: 'paramLength', default: 50, min: 10, max: 200, step: 5, unit: 'mm' },
  ],
  generate(p) {
    // BoxGeometry(width=X, height=Y, depth=Z) → length along Z
    const geo = new THREE.BoxGeometry(p.keyLength, p.keyHeight, p.keyWidth);
    geo.translate(0, p.keyHeight / 2, 0);
    return buildResult(geo);
  },
};

// ─── LM Linear Guide Rail ───────────────────────────────────────────────────

const lmGuideRail: StandardPart = {
  id: 'lmGuideRail', category: 'structural', standard: 'LM Guide', icon: '⇔', tier: 2,
  params: [
    { key: 'railWidth', labelKey: 'paramWidth', default: 20, min: 15, max: 45, step: 5, unit: 'mm' },
    { key: 'length', labelKey: 'paramLength', default: 400, min: 50, max: 1000, step: 50, unit: 'mm' },
  ],
  generate(p) {
    const w = p.railWidth;
    const len = p.length;
    // Simplified rail cross-section: height ≈ 0.6×width, depth = width
    const geo = new THREE.BoxGeometry(len, w * 0.6, w);
    geo.translate(0, w * 0.3, 0);
    return buildResult(geo);
  },
};

// ─── Spur Gear ──────────────────────────────────────────────────────────────

const spurGear: StandardPart = {
  id: 'spurGear', category: 'fastener', standard: 'ISO 53', icon: '⚙', tier: 2,
  params: [
    { key: 'module', labelKey: 'paramModule', default: 2, min: 0.5, max: 10, step: 0.5, unit: 'mm' },
    { key: 'teeth', labelKey: 'paramTeeth', default: 20, min: 8, max: 100, step: 1, unit: '' },
    { key: 'thickness', labelKey: 'paramThickness', default: 10, min: 2, max: 100, step: 1, unit: 'mm' },
    { key: 'holeDiameter', labelKey: 'paramInnerDiameter', default: 10, min: 2, max: 50, step: 1, unit: 'mm' },
  ],
  generate(p) {
    const m = p.module;
    const z = Math.round(p.teeth);
    const t = p.thickness;
    const holeR = p.holeDiameter / 2;

    const pitchD = m * z;
    const outerD = pitchD + 2 * m;
    const rootD = pitchD - 2.5 * m;

    const shape = new THREE.Shape();
    const segments = z * 4;
    
    // Involute approximation for spur gear profile
    for (let i = 0; i <= segments; i++) {
      const angle = (2 * Math.PI * i) / segments;
      const toothPhase = (i % 4);
      let r = pitchD / 2;
      if (toothPhase === 0) r = outerD / 2;
      else if (toothPhase === 1) r = outerD / 2;
      else if (toothPhase === 2) r = rootD / 2;
      else r = rootD / 2;
      
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    if (holeR > 0) {
      const hole = new THREE.Path();
      for (let i = 0; i <= 32; i++) {
        const a = (2 * Math.PI * i) / 32;
        if (i === 0) hole.moveTo(holeR * Math.cos(a), holeR * Math.sin(a));
        else hole.lineTo(holeR * Math.cos(a), holeR * Math.sin(a));
      }
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    geo.translate(0, 0, -t / 2);
    // Rotate to lie flat by default like bolts
    geo.rotateX(-Math.PI / 2);
    return buildResult(geo);
  },
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const STANDARD_PARTS: StandardPart[] = [
  hexBolt, hexNut, socketHeadCapScrew, flatWasher, springWasher,
  iBeam, angleBracket, channelBeam,
  ballBearing, bushing,
  countersunkScrew, setScrew, spurGear,
  thrustBearing, oring,
  keyway, lmGuideRail,
];

export const STANDARD_PARTS_MAP: Record<string, StandardPart> =
  Object.fromEntries(STANDARD_PARTS.map(p => [p.id, p]));

export const STANDARD_PART_CATEGORIES = [
  { key: 'fastener', parts: STANDARD_PARTS.filter(p => p.category === 'fastener') },
  { key: 'structural', parts: STANDARD_PARTS.filter(p => p.category === 'structural') },
  { key: 'bearing', parts: STANDARD_PARTS.filter(p => p.category === 'bearing') },
];
