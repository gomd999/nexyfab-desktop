import * as THREE from 'three';

export interface DeviationResult {
  minDeviation: number;
  maxDeviation: number;
  meanDeviation: number;
  stdDeviation: number;
  rmsDeviation: number;
  pointDeviations: Float32Array;
  coloredGeometry: THREE.BufferGeometry;
  histogram: { bin: number; count: number }[];
}

// Find closest point on triangle to a given point
function closestPointOnTriangle(
  p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(p, a);

  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return target.copy(a);

  const bp = new THREE.Vector3().subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return target.copy(b);

  const cp = new THREE.Vector3().subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return target.copy(c);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return target.copy(a).addScaledVector(ab, v);
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return target.copy(a).addScaledVector(ac, w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return target.copy(b).addScaledVector(new THREE.Vector3().subVectors(c, b), w);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return target.copy(a).addScaledVector(ab, v).addScaledVector(ac, w);
}

// Compute signed distance from point to nearest reference triangle
function signedDistance(
  point: THREE.Vector3, normal: THREE.Vector3,
  refPos: THREE.BufferAttribute, refIdx: THREE.BufferAttribute | null,
  triCount: number,
): number {
  let minDist = Infinity;
  let closestSign = 1;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const triNormal = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const i0 = refIdx ? refIdx.getX(i * 3) : i * 3;
    const i1 = refIdx ? refIdx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = refIdx ? refIdx.getX(i * 3 + 2) : i * 3 + 2;

    a.fromBufferAttribute(refPos, i0);
    b.fromBufferAttribute(refPos, i1);
    c.fromBufferAttribute(refPos, i2);

    closestPointOnTriangle(point, a, b, c, closest);
    const dist = point.distanceTo(closest);

    if (dist < minDist) {
      minDist = dist;
      // Compute face normal for sign
      triNormal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const diff = new THREE.Vector3().subVectors(point, closest);
      closestSign = diff.dot(triNormal) >= 0 ? 1 : -1;
    }
  }

  return minDist * closestSign;
}

// Map deviation value to color (blue=neg → green=zero → red=pos)
function deviationToColor(value: number, maxAbs: number): THREE.Color {
  const normalized = Math.max(-1, Math.min(1, value / (maxAbs || 1)));
  if (normalized < 0) {
    // Blue to green
    const t = 1 + normalized; // 0 to 1
    return new THREE.Color(0, t, 1 - t);
  } else {
    // Green to red
    return new THREE.Color(normalized, 1 - normalized, 0);
  }
}

export function computeDeviation(
  reference: THREE.BufferGeometry,
  test: THREE.BufferGeometry,
  numBins = 20,
): DeviationResult {
  const testGeo = test.index ? test.toNonIndexed() : test.clone();
  const refPos = reference.attributes.position as THREE.BufferAttribute;
  const refIdx = reference.index;
  const testPos = testGeo.attributes.position as THREE.BufferAttribute;
  const testNorm = testGeo.attributes.normal as THREE.BufferAttribute;

  if (!testNorm) testGeo.computeVertexNormals();

  const triCount = refIdx ? refIdx.count / 3 : refPos.count / 3;
  const vertCount = testPos.count;
  const deviations = new Float32Array(vertCount);

  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  let minDev = Infinity, maxDev = -Infinity, sumDev = 0, sumSqDev = 0;

  for (let i = 0; i < vertCount; i++) {
    point.fromBufferAttribute(testPos, i);
    normal.fromBufferAttribute(testGeo.attributes.normal as THREE.BufferAttribute, i);

    const dev = signedDistance(point, normal, refPos, refIdx, triCount);
    deviations[i] = dev;
    minDev = Math.min(minDev, dev);
    maxDev = Math.max(maxDev, dev);
    sumDev += dev;
    sumSqDev += dev * dev;
  }

  const meanDev = sumDev / vertCount;
  const rmsDev = Math.sqrt(sumSqDev / vertCount);
  const variance = sumSqDev / vertCount - meanDev * meanDev;
  const stdDev = Math.sqrt(Math.max(0, variance));

  // Generate colored geometry
  const maxAbs = Math.max(Math.abs(minDev), Math.abs(maxDev));
  const colors = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const color = deviationToColor(deviations[i], maxAbs);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const coloredGeo = testGeo.clone();
  coloredGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Histogram
  const binSize = (maxDev - minDev) / numBins;
  const histogram: { bin: number; count: number }[] = [];
  const bins = new Array(numBins).fill(0);
  for (let i = 0; i < vertCount; i++) {
    const binIdx = Math.min(numBins - 1, Math.floor((deviations[i] - minDev) / (binSize || 1)));
    bins[binIdx]++;
  }
  for (let i = 0; i < numBins; i++) {
    histogram.push({ bin: minDev + (i + 0.5) * binSize, count: bins[i] });
  }

  return {
    minDeviation: minDev,
    maxDeviation: maxDev,
    meanDeviation: meanDev,
    stdDeviation: stdDev,
    rmsDeviation: rmsDev,
    pointDeviations: deviations,
    coloredGeometry: coloredGeo,
    histogram,
  };
}
