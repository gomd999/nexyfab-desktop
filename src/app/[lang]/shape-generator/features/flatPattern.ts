import * as THREE from 'three';

export interface BendZone {
  /** Center line of the bend (axis of rotation) */
  axis: THREE.Line3;
  /** Bend angle in radians (positive = bend away from viewer) */
  angle: number;
  /** Inner bend radius (mm) */
  innerRadius: number;
  /** Sheet thickness (mm) */
  thickness: number;
  /** K-factor (neutral axis position, typically 0.33-0.5) */
  kFactor: number;
  /** Faces on the "fixed" side of this bend */
  fixedFaceIndices: number[];
  /** Faces on the "moving" side of this bend */
  movingFaceIndices: number[];
}

export interface FlatPatternResult {
  /** 2D flat geometry (Z=0 plane) */
  geometry: THREE.BufferGeometry;
  /** Total flat length including bend allowances */
  flatLength: number;
  /** Total flat width */
  flatWidth: number;
  /** Bend allowance for each bend zone */
  bendAllowances: number[];
  /** Total bend allowance */
  totalBendAllowance: number;
  /** DXF string for manufacturing */
  dxf: string;
  /** SVG string for preview */
  svg: string;
}

/**
 * Calculate bend allowance using K-factor method
 * BA = π × (R + K×T) × (A/180)
 */
function calcBendAllowance(
  innerRadius: number,
  thickness: number,
  angle: number,
  kFactor: number,
): number {
  const angleDeg = Math.abs(angle * 180 / Math.PI);
  return Math.PI * (innerRadius + kFactor * thickness) * (angleDeg / 180);
}

/**
 * Calculate bend deduction
 * BD = 2×(R+T)×tan(A/2) - BA
 */
export function calcBendDeduction(
  innerRadius: number,
  thickness: number,
  angle: number,
  kFactor: number,
): number {
  const halfAngle = Math.abs(angle) / 2;
  const ba = calcBendAllowance(innerRadius, thickness, angle, kFactor);
  return 2 * (innerRadius + thickness) * Math.tan(halfAngle) - ba;
}

/**
 * Detect bend zones from a sheet metal geometry by analyzing face normals.
 * Faces with similar normals are grouped into flat regions.
 * Adjacent flat regions connected by curved faces form bend zones.
 */
export function detectBendZones(
  geometry: THREE.BufferGeometry,
  thickness: number,
  kFactor = 0.33,
): BendZone[] {
  const geo = geometry.toNonIndexed();
  geo.computeVertexNormals();

  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  const normals = geo.getAttribute('normal') as THREE.BufferAttribute;
  const triCount = positions.count / 3;

  // Group faces by normal direction (cluster similar normals)
  const NORMAL_THRESHOLD = 0.1; // cos similarity threshold
  interface FaceGroup {
    normal: THREE.Vector3;
    faceIndices: number[];
    centroid: THREE.Vector3;
  }
  const groups: FaceGroup[] = [];

  for (let t = 0; t < triCount; t++) {
    const n = new THREE.Vector3(
      (normals.getX(t * 3) + normals.getX(t * 3 + 1) + normals.getX(t * 3 + 2)) / 3,
      (normals.getY(t * 3) + normals.getY(t * 3 + 1) + normals.getY(t * 3 + 2)) / 3,
      (normals.getZ(t * 3) + normals.getZ(t * 3 + 1) + normals.getZ(t * 3 + 2)) / 3,
    ).normalize();

    const cx = (positions.getX(t * 3) + positions.getX(t * 3 + 1) + positions.getX(t * 3 + 2)) / 3;
    const cy = (positions.getY(t * 3) + positions.getY(t * 3 + 1) + positions.getY(t * 3 + 2)) / 3;
    const cz = (positions.getZ(t * 3) + positions.getZ(t * 3 + 1) + positions.getZ(t * 3 + 2)) / 3;

    let assigned = false;
    for (const group of groups) {
      if (Math.abs(group.normal.dot(n)) > 1 - NORMAL_THRESHOLD) {
        group.faceIndices.push(t);
        group.centroid.add(new THREE.Vector3(cx, cy, cz));
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      groups.push({
        normal: n,
        faceIndices: [t],
        centroid: new THREE.Vector3(cx, cy, cz),
      });
    }
  }

  // Find pairs of opposite-facing groups (top/bottom of bends)
  const bendZones: BendZone[] = [];
  const used = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < groups.length; j++) {
      if (used.has(j)) continue;
      const dot = groups[i].normal.dot(groups[j].normal);
      // Detect bends: face groups whose normals are neither parallel (dot≈1) nor
      // antiparallel (dot≈-1). For a 90° bend the flanges' normals are perpendicular
      // (dot≈0); for a 45° bend dot≈0.7; for a 135° bend dot≈-0.7.
      if (dot > -0.98 && dot < 0.98) {
        // bend angle = supplement of angle between normals
        // acos(-dot) gives the dihedral (interior) bend angle
        const angle = Math.acos(Math.min(1, Math.max(-1, -dot)));

        // Estimate bend axis as cross product of the two normals
        const axis = new THREE.Vector3().crossVectors(groups[i].normal, groups[j].normal).normalize();
        const midpoint = new THREE.Vector3()
          .add(groups[i].centroid.clone().divideScalar(groups[i].faceIndices.length))
          .add(groups[j].centroid.clone().divideScalar(groups[j].faceIndices.length))
          .multiplyScalar(0.5);

        // Build bend axis line
        const axisStart = midpoint.clone().addScaledVector(axis, -100);
        const axisEnd = midpoint.clone().addScaledVector(axis, 100);

        bendZones.push({
          axis: new THREE.Line3(axisStart, axisEnd),
          angle,
          innerRadius: thickness, // default: inner radius = thickness
          thickness,
          kFactor,
          fixedFaceIndices: groups[i].faceIndices,
          movingFaceIndices: groups[j].faceIndices,
        });
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  return bendZones;
}

/**
 * Unfold a sheet metal geometry into a flat pattern.
 * Processes each bend zone by rotating the moving faces to flat.
 */
export function generateFlatPattern(
  geometry: THREE.BufferGeometry,
  bends: BendZone[],
): FlatPatternResult {
  // Work with a clone
  const geo = geometry.clone().toNonIndexed();
  const positions = geo.getAttribute('position') as THREE.BufferAttribute;

  const bendAllowances = bends.map(b =>
    calcBendAllowance(b.innerRadius, b.thickness, b.angle, b.kFactor),
  );
  const totalBA = bendAllowances.reduce((a, b) => a + b, 0);

  // For each bend zone, rotate the moving faces to flatten
  for (let i = 0; i < bends.length; i++) {
    const bend = bends[i];
    const unfoldAngle = -(Math.PI - bend.angle); // rotate to flat

    // Rotation axis at midpoint of bend axis
    const axisDir = new THREE.Vector3().subVectors(bend.axis.end, bend.axis.start).normalize();
    const pivot = bend.axis.getCenter(new THREE.Vector3());

    const quaternion = new THREE.Quaternion().setFromAxisAngle(axisDir, unfoldAngle);
    const matrix = new THREE.Matrix4()
      .makeTranslation(-pivot.x, -pivot.y, -pivot.z)
      .premultiply(new THREE.Matrix4().makeRotationFromQuaternion(quaternion))
      .premultiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z));

    // Apply rotation to moving faces
    for (const faceIdx of bend.movingFaceIndices) {
      for (let v = 0; v < 3; v++) {
        const vi = faceIdx * 3 + v;
        const pt = new THREE.Vector3(
          positions.getX(vi),
          positions.getY(vi),
          positions.getZ(vi),
        ).applyMatrix4(matrix);
        positions.setXYZ(vi, pt.x, pt.y, pt.z);
      }
    }
  }

  positions.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeVertexNormals();

  // Project to XZ plane (Y=0)
  const flatPositions = new Float32Array(positions.array.length);
  for (let i = 0; i < positions.count; i++) {
    flatPositions[i * 3] = positions.getX(i);
    flatPositions[i * 3 + 1] = 0;
    flatPositions[i * 3 + 2] = positions.getZ(i);
  }
  const flatGeo = new THREE.BufferGeometry();
  flatGeo.setAttribute('position', new THREE.BufferAttribute(flatPositions, 3));
  flatGeo.computeBoundingBox();
  flatGeo.computeVertexNormals();

  const bb = flatGeo.boundingBox!;
  const flatLength = bb.max.x - bb.min.x + totalBA;
  const flatWidth = bb.max.z - bb.min.z;

  // Generate DXF
  const dxf = generateFlatPatternDXF(flatGeo, flatLength, flatWidth, bends, bendAllowances);

  // Generate SVG preview
  const svg = generateFlatPatternSVG(flatGeo, flatLength, flatWidth);

  return {
    geometry: flatGeo,
    flatLength,
    flatWidth,
    bendAllowances,
    totalBendAllowance: totalBA,
    dxf,
    svg,
  };
}

function generateFlatPatternDXF(
  geo: THREE.BufferGeometry,
  flatLength: number,
  flatWidth: number,
  bends: BendZone[],
  bendAllowances: number[],
): string {
  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  const lines: string[] = [];

  // DXF Header
  lines.push('0\nSECTION\n2\nHEADER');
  lines.push('9\n$ACADVER\n1\nAC1015');
  lines.push('9\n$INSUNITS\n70\n4'); // 4 = millimeters
  lines.push('0\nENDSEC');

  // DXF Entities
  lines.push('0\nSECTION\n2\nENTITIES');

  // Draw all triangle edges
  const triCount = positions.count / 3;
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const i0 = t * 3 + e;
      const i1 = t * 3 + (e + 1) % 3;
      lines.push('0\nLINE');
      lines.push('8\nFLAT_PATTERN'); // layer name
      lines.push(`10\n${positions.getX(i0).toFixed(4)}`);
      lines.push(`20\n${positions.getZ(i0).toFixed(4)}`);
      lines.push('30\n0.0');
      lines.push(`11\n${positions.getX(i1).toFixed(4)}`);
      lines.push(`21\n${positions.getZ(i1).toFixed(4)}`);
      lines.push('31\n0.0');
    }
  }

  // Draw bend lines
  for (let i = 0; i < bends.length; i++) {
    const bend = bends[i];
    const center = bend.axis.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(bend.axis.end, bend.axis.start).normalize();
    const halfLen = flatWidth / 2;

    lines.push('0\nLINE');
    lines.push('8\nBEND_LINES'); // different layer for bend lines
    lines.push(`10\n${(center.x - dir.x * halfLen).toFixed(4)}`);
    lines.push(`20\n${(center.z - dir.z * halfLen).toFixed(4)}`);
    lines.push('30\n0.0');
    lines.push(`11\n${(center.x + dir.x * halfLen).toFixed(4)}`);
    lines.push(`21\n${(center.z + dir.z * halfLen).toFixed(4)}`);
    lines.push('31\n0.0');

    // Add bend annotation text
    const ba = bendAllowances[i].toFixed(2);
    const angleDeg = (bend.angle * 180 / Math.PI).toFixed(1);
    lines.push('0\nTEXT');
    lines.push('8\nANNOTATIONS');
    lines.push(`10\n${center.x.toFixed(4)}\n20\n${(center.z + 2).toFixed(4)}\n30\n0.0`);
    lines.push('40\n2.5'); // text height
    lines.push(`1\nBA=${ba}mm A=${angleDeg}deg`);
  }

  lines.push('0\nENDSEC');
  lines.push('0\nEOF');

  return lines.join('\n');
}

function generateFlatPatternSVG(
  geo: THREE.BufferGeometry,
  flatLength: number,
  flatWidth: number,
): string {
  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  const bb = geo.boundingBox!;
  const padding = 10;
  const svgWidth = 600;
  const svgHeight = 400;
  const scaleX = (svgWidth - 2 * padding) / (bb.max.x - bb.min.x || 1);
  const scaleY = (svgHeight - 2 * padding) / (bb.max.z - bb.min.z || 1);
  const scale = Math.min(scaleX, scaleY);

  const toSvgX = (x: number) => (x - bb.min.x) * scale + padding;
  const toSvgY = (z: number) => svgHeight - ((z - bb.min.z) * scale + padding);

  const triCount = positions.count / 3;
  let pathData = '';

  for (let t = 0; t < triCount; t++) {
    const p0 = { x: toSvgX(positions.getX(t * 3)), y: toSvgY(positions.getZ(t * 3)) };
    const p1 = { x: toSvgX(positions.getX(t * 3 + 1)), y: toSvgY(positions.getZ(t * 3 + 1)) };
    const p2 = { x: toSvgX(positions.getX(t * 3 + 2)), y: toSvgY(positions.getZ(t * 3 + 2)) };
    pathData += `M ${p0.x.toFixed(1)},${p0.y.toFixed(1)} L ${p1.x.toFixed(1)},${p1.y.toFixed(1)} L ${p2.x.toFixed(1)},${p2.y.toFixed(1)} Z `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#1a1a2e"/>
  <path d="${pathData}" fill="none" stroke="#8b9cf4" stroke-width="0.5"/>
  <text x="${padding}" y="20" fill="#8b9cf4" font-size="12" font-family="monospace">
    Flat Pattern: ${flatLength.toFixed(1)}mm \xd7 ${flatWidth.toFixed(1)}mm
  </text>
</svg>`;
}

/**
 * Simple flat pattern for a box-like sheet metal part.
 * Used when no bend detection is possible.
 */
export function generateSimpleFlatPattern(
  width: number,
  height: number,
  depth: number,
  thickness: number,
  kFactor = 0.33,
): FlatPatternResult {
  // For a simple box: flat = width + 2*(depth + BA)
  const bendAngle = Math.PI / 2; // 90 degrees
  const ba = calcBendAllowance(thickness, thickness, bendAngle, kFactor);
  const flatW = width + 2 * (depth + ba);
  const flatH = height;

  const geo = new THREE.PlaneGeometry(flatW, flatH);
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();

  const bends: BendZone[] = [];
  const bendAllowances = [ba, ba];

  const dxf = generateFlatPatternDXF(geo, flatW, flatH, bends, bendAllowances);
  const svg = generateFlatPatternSVG(geo, flatW, flatH);

  return {
    geometry: geo,
    flatLength: flatW,
    flatWidth: flatH,
    bendAllowances,
    totalBendAllowance: 2 * ba,
    dxf,
    svg,
  };
}
