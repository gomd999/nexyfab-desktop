import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Ensure geometry is non-indexed and return a deep clone. */
function toNonIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  return g;
}

/** Ensure geometry is indexed. Returns a clone. */
function ensureIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) return geo.clone();
  const g = geo.clone();
  const count = g.attributes.position.count;
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Build adjacency: for each vertex index, the set of neighbor vertex indices. */
function buildAdjacency(
  index: THREE.BufferAttribute | null,
  vertexCount: number,
  faceCount: number,
): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < vertexCount; i++) adj.set(i, new Set());
  for (let f = 0; f < faceCount; f++) {
    const a = index!.getX(f * 3);
    const b = index!.getX(f * 3 + 1);
    const c = index!.getX(f * 3 + 2);
    adj.get(a)!.add(b).add(c);
    adj.get(b)!.add(a).add(c);
    adj.get(c)!.add(a).add(b);
  }
  return adj;
}

/** Edge key for a pair of vertex indices (order-independent). */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Build a map from edgeKey -> array of face indices sharing that edge. */
function buildEdgeFaceMap(
  index: THREE.BufferAttribute,
  faceCount: number,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let f = 0; f < faceCount; f++) {
    const a = index.getX(f * 3);
    const b = index.getX(f * 3 + 1);
    const c = index.getX(f * 3 + 2);
    for (const ek of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
      if (!map.has(ek)) map.set(ek, []);
      map.get(ek)!.push(f);
    }
  }
  return map;
}

function vec3FromAttr(attr: THREE.BufferAttribute, i: number): THREE.Vector3 {
  return new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. reduceNoise – Laplacian smoothing
// ─────────────────────────────────────────────────────────────────────────────

export function reduceNoise(
  geo: THREE.BufferGeometry,
  iterations: number = 3,
  factor: number = 0.5,
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;
  const vertexCount = pos.count;
  const faceCount = idx.count / 3;
  const adj = buildAdjacency(idx, vertexCount, faceCount);

  const coords = new Float32Array(pos.array);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float32Array(coords);
    for (let v = 0; v < vertexCount; v++) {
      const neighbors = adj.get(v)!;
      if (neighbors.size === 0) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const n of neighbors) {
        sx += coords[n * 3];
        sy += coords[n * 3 + 1];
        sz += coords[n * 3 + 2];
      }
      const inv = 1 / neighbors.size;
      next[v * 3]     = coords[v * 3]     + factor * (sx * inv - coords[v * 3]);
      next[v * 3 + 1] = coords[v * 3 + 1] + factor * (sy * inv - coords[v * 3 + 1]);
      next[v * 3 + 2] = coords[v * 3 + 2] + factor * (sz * inv - coords[v * 3 + 2]);
    }
    coords.set(next);
  }

  const result = g.clone();
  result.setAttribute('position', new THREE.BufferAttribute(coords, 3));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. fillHoles – boundary loop detection + fan triangulation
// ─────────────────────────────────────────────────────────────────────────────

export function fillHoles(
  geo: THREE.BufferGeometry,
  maxEdgeCount: number = 50,
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const idx = g.index!;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const faceCount = idx.count / 3;
  const efMap = buildEdgeFaceMap(idx, faceCount);

  // Find boundary edges (belonging to exactly 1 face)
  const boundaryAdj = new Map<number, number[]>();
  for (const [ek, faces] of efMap) {
    if (faces.length !== 1) continue;
    const [aStr, bStr] = ek.split('_');
    const a = parseInt(aStr, 10);
    const b = parseInt(bStr, 10);
    // Determine winding from the face to get directed boundary edge
    const f = faces[0];
    const fa = idx.getX(f * 3), fb = idx.getX(f * 3 + 1), fc = idx.getX(f * 3 + 2);
    const tri = [fa, fb, fc];
    const ai = tri.indexOf(a);
    const bi = tri.indexOf(b);
    // Boundary half-edge runs opposite to the face winding
    if ((ai + 1) % 3 === bi) {
      // a->b is in face winding, so boundary is b->a
      if (!boundaryAdj.has(b)) boundaryAdj.set(b, []);
      boundaryAdj.get(b)!.push(a);
    } else {
      if (!boundaryAdj.has(a)) boundaryAdj.set(a, []);
      boundaryAdj.get(a)!.push(b);
    }
  }

  // Trace loops
  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const start of boundaryAdj.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [start];
    visited.add(start);
    let cur = start;
    let safety = 0;
    while (safety++ < 100000) {
      const nexts = boundaryAdj.get(cur);
      if (!nexts || nexts.length === 0) break;
      const next = nexts.find((n) => !visited.has(n));
      if (next === undefined) {
        // Check if we've closed the loop
        if (nexts.includes(start) && loop.length >= 3) break;
        break;
      }
      loop.push(next);
      visited.add(next);
      cur = next;
    }
    if (loop.length >= 3 && loop.length <= maxEdgeCount) {
      loops.push(loop);
    }
  }

  // Fan-triangulate each loop and append to existing geometry
  const oldIndices = Array.from(idx.array);
  for (const loop of loops) {
    // Compute centroid
    const cx = loop.reduce((s, v) => s + pos.getX(v), 0) / loop.length;
    const cy = loop.reduce((s, v) => s + pos.getY(v), 0) / loop.length;
    const cz = loop.reduce((s, v) => s + pos.getZ(v), 0) / loop.length;

    // Use fan from first vertex for simplicity (avoids adding new vertices)
    const pivot = loop[0];
    for (let i = 1; i < loop.length - 1; i++) {
      oldIndices.push(pivot, loop[i], loop[i + 1]);
    }
  }

  const result = g.clone();
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(oldIndices), 1));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. remesh – simplified isotropic remeshing
// ─────────────────────────────────────────────────────────────────────────────

export function remesh(
  geo: THREE.BufferGeometry,
  targetEdgeLength: number,
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const posAttr = g.attributes.position as THREE.BufferAttribute;
  const positions: number[] = Array.from(posAttr.array);
  const indices: number[] = Array.from(g.index!.array);

  const highLen = targetEdgeLength * 4 / 3;
  const lowLen = targetEdgeLength * 4 / 5;

  function getPos(vi: number): THREE.Vector3 {
    return new THREE.Vector3(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
  }
  function setPos(vi: number, v: THREE.Vector3) {
    positions[vi * 3] = v.x;
    positions[vi * 3 + 1] = v.y;
    positions[vi * 3 + 2] = v.z;
  }
  function addVertex(v: THREE.Vector3): number {
    const vi = positions.length / 3;
    positions.push(v.x, v.y, v.z);
    return vi;
  }
  function edgeLength(a: number, b: number): number {
    return getPos(a).distanceTo(getPos(b));
  }

  // Pass 1: Split edges longer than highLen
  const maxSplitPasses = 3;
  for (let pass = 0; pass < maxSplitPasses; pass++) {
    let splitOccurred = false;
    const faceCount = indices.length / 3;
    const newFaces: number[] = [];
    const removedFaces = new Set<number>();

    for (let f = 0; f < faceCount; f++) {
      const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
      const lab = edgeLength(a, b);
      const lbc = edgeLength(b, c);
      const lca = edgeLength(c, a);

      // Split the longest edge if it exceeds threshold
      let longest = lab, ei0 = a, ei1 = b, ei2 = c;
      if (lbc > longest) { longest = lbc; ei0 = b; ei1 = c; ei2 = a; }
      if (lca > longest) { longest = lca; ei0 = c; ei1 = a; ei2 = b; }

      if (longest > highLen) {
        splitOccurred = true;
        removedFaces.add(f);
        const mid = getPos(ei0).clone().add(getPos(ei1)).multiplyScalar(0.5);
        const m = addVertex(mid);
        newFaces.push(ei0, m, ei2, m, ei1, ei2);
      }
    }

    if (!splitOccurred) break;

    // Rebuild index array, skipping removed faces, adding new ones
    const rebuilt: number[] = [];
    for (let f = 0; f < faceCount; f++) {
      if (removedFaces.has(f)) continue;
      rebuilt.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
    }
    rebuilt.push(...newFaces);
    indices.length = 0;
    indices.push(...rebuilt);
  }

  // Pass 2: Collapse edges shorter than lowLen
  const vertexCount = positions.length / 3;
  const collapsed = new Int32Array(vertexCount).fill(-1); // remap: -1 = keep
  function resolve(v: number): number {
    while (collapsed[v] !== -1) v = collapsed[v];
    return v;
  }

  const edgesChecked = new Set<string>();
  const faceCount2 = indices.length / 3;
  for (let f = 0; f < faceCount2; f++) {
    const tri = [resolve(indices[f * 3]), resolve(indices[f * 3 + 1]), resolve(indices[f * 3 + 2])];
    for (let e = 0; e < 3; e++) {
      const va = tri[e], vb = tri[(e + 1) % 3];
      if (va === vb) continue;
      const ek = edgeKey(va, vb);
      if (edgesChecked.has(ek)) continue;
      edgesChecked.add(ek);
      if (edgeLength(va, vb) < lowLen) {
        const mid = getPos(va).clone().add(getPos(vb)).multiplyScalar(0.5);
        setPos(va, mid);
        collapsed[vb] = va;
      }
    }
  }

  // Rebuild with collapsed vertices, remove degenerate faces
  const finalIndices: number[] = [];
  const faceCount3 = indices.length / 3;
  for (let f = 0; f < faceCount3; f++) {
    const a = resolve(indices[f * 3]);
    const b = resolve(indices[f * 3 + 1]);
    const c = resolve(indices[f * 3 + 2]);
    if (a === b || b === c || c === a) continue;
    finalIndices.push(a, b, c);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(finalIndices), 1));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. simplifyMesh – Quadric error metric decimation
// ─────────────────────────────────────────────────────────────────────────────

export function simplifyMesh(
  geo: THREE.BufferGeometry,
  targetRatio: number = 0.5,
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const posAttr = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;
  const vCount = posAttr.count;
  const fCount = idx.count / 3;
  const targetFaces = Math.max(4, Math.floor(fCount * targetRatio));

  // Copy positions
  const pos = new Float32Array(posAttr.array);
  const faces: number[][] = [];
  for (let f = 0; f < fCount; f++) {
    faces.push([idx.getX(f * 3), idx.getX(f * 3 + 1), idx.getX(f * 3 + 2)]);
  }

  // Compute per-vertex quadric matrices (stored as 10-element symmetric 4x4)
  // Q = sum of Kp for each adjacent plane
  const quadrics = new Array<Float64Array>(vCount);
  for (let i = 0; i < vCount; i++) quadrics[i] = new Float64Array(10);

  for (const [a, b, c] of faces) {
    const va = new THREE.Vector3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const vb = new THREE.Vector3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    const vc = new THREE.Vector3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
    const d = -n.dot(va);
    // Kp = [a,b,c,d]^T * [a,b,c,d], stored as upper triangle
    const p = [n.x, n.y, n.z, d];
    const kp = new Float64Array(10);
    let ki = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = i; j < 4; j++) {
        kp[ki] = p[i] * p[j];
        ki++;
      }
    }
    for (const vi of [a, b, c]) {
      for (let k = 0; k < 10; k++) quadrics[vi][k] += kp[k];
    }
  }

  // Collapse map
  const remap = new Int32Array(vCount);
  for (let i = 0; i < vCount; i++) remap[i] = i;
  function root(v: number): number {
    while (remap[v] !== v) v = remap[v];
    return v;
  }

  // Compute error for collapsing edge a-b to midpoint
  function collapseError(a: number, b: number): number {
    const q = new Float64Array(10);
    for (let k = 0; k < 10; k++) q[k] = quadrics[a][k] + quadrics[b][k];
    const mx = (pos[a * 3] + pos[b * 3]) / 2;
    const my = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2;
    const mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2;
    // v^T Q v where v = [mx,my,mz,1]
    // q indices: 0=xx,1=xy,2=xz,3=xw,4=yy,5=yz,6=yw,7=zz,8=zw,9=ww
    return q[0] * mx * mx + 2 * q[1] * mx * my + 2 * q[2] * mx * mz + 2 * q[3] * mx
         + q[4] * my * my + 2 * q[5] * my * mz + 2 * q[6] * my
         + q[7] * mz * mz + 2 * q[8] * mz + q[9];
  }

  // Build edge list with errors
  const edgeSet = new Set<string>();
  const edgeHeap: { err: number; a: number; b: number }[] = [];
  for (const [a, b, c] of faces) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const ek = edgeKey(u, v);
      if (!edgeSet.has(ek)) {
        edgeSet.add(ek);
        edgeHeap.push({ err: collapseError(u, v), a: u, b: v });
      }
    }
  }
  edgeHeap.sort((x, y) => x.err - y.err);

  let activeFaces = faces.length;
  let heapIdx = 0;

  while (activeFaces > targetFaces && heapIdx < edgeHeap.length) {
    const { a, b } = edgeHeap[heapIdx++];
    const ra = root(a), rb = root(b);
    if (ra === rb) continue;

    // Collapse rb into ra, place at midpoint
    pos[ra * 3]     = (pos[ra * 3] + pos[rb * 3]) / 2;
    pos[ra * 3 + 1] = (pos[ra * 3 + 1] + pos[rb * 3 + 1]) / 2;
    pos[ra * 3 + 2] = (pos[ra * 3 + 2] + pos[rb * 3 + 2]) / 2;
    for (let k = 0; k < 10; k++) quadrics[ra][k] += quadrics[rb][k];
    remap[rb] = ra;

    // Count removed faces
    for (const face of faces) {
      const fa = root(face[0]), fb = root(face[1]), fc = root(face[2]);
      if (fa === fb || fb === fc || fc === fa) {
        // Mark degenerate only if it wasn't already
        if (face[0] !== -1) {
          activeFaces--;
          face[0] = -1;
        }
      }
    }
  }

  // Rebuild
  const finalIndices: number[] = [];
  for (const face of faces) {
    if (face[0] === -1) continue;
    const a = root(face[0]), b = root(face[1]), c = root(face[2]);
    if (a === b || b === c || c === a) continue;
    finalIndices.push(a, b, c);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(finalIndices), 1));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. removeSpikes – curvature-based spike removal
// ─────────────────────────────────────────────────────────────────────────────

export function removeSpikes(
  geo: THREE.BufferGeometry,
  threshold: number = 2.0,
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const posAttr = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;
  const vCount = posAttr.count;
  const fCount = idx.count / 3;
  const adj = buildAdjacency(idx, vCount, fCount);

  const pos = posAttr;
  // Compute discrete mean curvature approximation for each vertex
  // |v - centroid(neighbors)| as proxy
  const curvatures = new Float32Array(vCount);
  for (let v = 0; v < vCount; v++) {
    const neighbors = adj.get(v)!;
    if (neighbors.size === 0) { curvatures[v] = 0; continue; }
    let cx = 0, cy = 0, cz = 0;
    for (const n of neighbors) {
      cx += pos.getX(n);
      cy += pos.getY(n);
      cz += pos.getZ(n);
    }
    const inv = 1 / neighbors.size;
    const dx = pos.getX(v) - cx * inv;
    const dy = pos.getY(v) - cy * inv;
    const dz = pos.getZ(v) - cz * inv;
    curvatures[v] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Compute mean and std deviation
  let sum = 0, sumSq = 0;
  for (let v = 0; v < vCount; v++) {
    sum += curvatures[v];
    sumSq += curvatures[v] * curvatures[v];
  }
  const mean = sum / vCount;
  const std = Math.sqrt(sumSq / vCount - mean * mean);
  const cutoff = mean + threshold * std;

  // For spike vertices, snap them to their neighbor centroid
  const newPos = new Float32Array(posAttr.array);
  for (let v = 0; v < vCount; v++) {
    if (curvatures[v] <= cutoff) continue;
    const neighbors = adj.get(v)!;
    if (neighbors.size === 0) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const n of neighbors) {
      cx += posAttr.getX(n);
      cy += posAttr.getY(n);
      cz += posAttr.getZ(n);
    }
    const inv = 1 / neighbors.size;
    newPos[v * 3] = cx * inv;
    newPos[v * 3 + 1] = cy * inv;
    newPos[v * 3 + 2] = cz * inv;
  }

  const result = g.clone();
  result.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. flipNormals – reverse winding and normals
// ─────────────────────────────────────────────────────────────────────────────

export function flipNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();

  if (g.index) {
    const idx = g.index;
    const arr = new Uint32Array(idx.array);
    for (let f = 0; f < arr.length; f += 3) {
      const tmp = arr[f + 1];
      arr[f + 1] = arr[f + 2];
      arr[f + 2] = tmp;
    }
    g.setIndex(new THREE.BufferAttribute(arr, 1));
  } else {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const arr = new Float32Array(pos.array);
    for (let f = 0; f < arr.length; f += 9) {
      // Swap vertex 1 and vertex 2 positions
      for (let c = 0; c < 3; c++) {
        const tmp = arr[f + 3 + c];
        arr[f + 3 + c] = arr[f + 6 + c];
        arr[f + 6 + c] = tmp;
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    // Swap UVs if present
    if (g.attributes.uv) {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const uvArr = new Float32Array(uv.array);
      for (let f = 0; f < uvArr.length / 2; f += 3) {
        for (let c = 0; c < 2; c++) {
          const tmp = uvArr[(f + 1) * 2 + c];
          uvArr[(f + 1) * 2 + c] = uvArr[(f + 2) * 2 + c];
          uvArr[(f + 2) * 2 + c] = tmp;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    }
  }

  // Flip normals if they exist
  if (g.attributes.normal) {
    const norm = g.attributes.normal as THREE.BufferAttribute;
    const nArr = new Float32Array(norm.array);
    for (let i = 0; i < nArr.length; i++) nArr[i] = -nArr[i];
    g.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
  }

  g.computeVertexNormals();
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. deleteTriangles – remove specific faces by index
// ─────────────────────────────────────────────────────────────────────────────

export function deleteTriangles(
  geo: THREE.BufferGeometry,
  triangleIndices: number[],
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const idx = g.index!;
  const fCount = idx.count / 3;

  const removeSet = new Set(triangleIndices);
  const newIndices: number[] = [];

  for (let f = 0; f < fCount; f++) {
    if (removeSet.has(f)) continue;
    newIndices.push(idx.getX(f * 3), idx.getX(f * 3 + 1), idx.getX(f * 3 + 2));
  }

  const result = g.clone();
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. repairMesh – all-in-one repair
// ─────────────────────────────────────────────────────────────────────────────

export function repairMesh(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const posAttr = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;
  const vCount = posAttr.count;
  const fCount = idx.count / 3;

  // Step 1: Merge close vertices (weld)
  const EPSILON = 1e-6;
  const positions = new Float32Array(posAttr.array);
  const vertexMap = new Int32Array(vCount);
  for (let i = 0; i < vCount; i++) vertexMap[i] = i;

  // Spatial hash for faster merging
  const cellSize = EPSILON * 10;
  const hashMap = new Map<string, number[]>();
  function cellKey(x: number, y: number, z: number): string {
    return `${Math.floor(x / cellSize)}_${Math.floor(y / cellSize)}_${Math.floor(z / cellSize)}`;
  }

  for (let i = 0; i < vCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const ck = cellKey(x, y, z);
    let merged = false;

    // Check this cell and neighbors
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize), cz = Math.floor(z / cellSize);
    for (let dx = -1; dx <= 1 && !merged; dx++) {
      for (let dy = -1; dy <= 1 && !merged; dy++) {
        for (let dz = -1; dz <= 1 && !merged; dz++) {
          const nk = `${cx + dx}_${cy + dy}_${cz + dz}`;
          const bucket = hashMap.get(nk);
          if (!bucket) continue;
          for (const j of bucket) {
            const dist = Math.sqrt(
              (x - positions[j * 3]) ** 2 +
              (y - positions[j * 3 + 1]) ** 2 +
              (z - positions[j * 3 + 2]) ** 2,
            );
            if (dist < EPSILON) {
              vertexMap[i] = j;
              merged = true;
              break;
            }
          }
        }
      }
    }

    if (!merged) {
      if (!hashMap.has(ck)) hashMap.set(ck, []);
      hashMap.get(ck)!.push(i);
    }
  }

  // Step 2: Remove degenerate triangles and rebuild with merged vertices
  const newIndices: number[] = [];
  for (let f = 0; f < fCount; f++) {
    const a = vertexMap[idx.getX(f * 3)];
    const b = vertexMap[idx.getX(f * 3 + 1)];
    const c = vertexMap[idx.getX(f * 3 + 2)];
    if (a === b || b === c || c === a) continue;

    // Check for zero-area triangle
    const va = vec3FromAttr(posAttr, a);
    const vb = vec3FromAttr(posAttr, b);
    const vc = vec3FromAttr(posAttr, c);
    const area = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).length();
    if (area < 1e-10) continue;

    newIndices.push(a, b, c);
  }

  // Step 3: Ensure consistent winding via BFS propagation
  const newFCount = newIndices.length / 3;
  const faceEdgeMap = new Map<string, { face: number; dir: [number, number] }[]>();

  for (let f = 0; f < newFCount; f++) {
    const a = newIndices[f * 3], b = newIndices[f * 3 + 1], c = newIndices[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const ek = edgeKey(u, v);
      if (!faceEdgeMap.has(ek)) faceEdgeMap.set(ek, []);
      faceEdgeMap.get(ek)!.push({ face: f, dir: [u, v] });
    }
  }

  const oriented = new Uint8Array(newFCount); // 0=unvisited, 1=visited
  const flipped = new Uint8Array(newFCount);
  const queue: number[] = [0];
  oriented[0] = 1;

  while (queue.length > 0) {
    const f = queue.shift()!;
    const a = newIndices[f * 3], b = newIndices[f * 3 + 1], c = newIndices[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const ek = edgeKey(u, v);
      const neighbors = faceEdgeMap.get(ek);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (nb.face === f || oriented[nb.face]) continue;
        oriented[nb.face] = 1;
        // Adjacent faces should have opposite winding on shared edge
        // If both share edge u->v in the same direction, one needs flipping
        if (nb.dir[0] === u && nb.dir[1] === v) {
          // Same direction = inconsistent, flip neighbor
          const nf = nb.face;
          const tmp = newIndices[nf * 3 + 1];
          newIndices[nf * 3 + 1] = newIndices[nf * 3 + 2];
          newIndices[nf * 3 + 2] = tmp;
          flipped[nf] = 1;
        }
        queue.push(nb.face);
      }
    }
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. smoothMesh – Taubin smoothing (volume-preserving)
// ─────────────────────────────────────────────────────────────────────────────

export function smoothMesh(
  geo: THREE.BufferGeometry,
  iterations: number = 5,
  lambda: number = 0.5,
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const posAttr = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;
  const vCount = posAttr.count;
  const fCount = idx.count / 3;
  const adj = buildAdjacency(idx, vCount, fCount);

  // Taubin: alternating positive (lambda) and negative (mu) Laplacian steps
  // mu is chosen so that |mu| > lambda to achieve shrinkage-free smoothing
  const mu = -(lambda + 0.01); // Taubin's recommendation: mu < -lambda

  const coords = new Float32Array(posAttr.array);

  function laplacianStep(data: Float32Array, weight: number) {
    const temp = new Float32Array(data);
    for (let v = 0; v < vCount; v++) {
      const neighbors = adj.get(v)!;
      if (neighbors.size === 0) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const n of neighbors) {
        sx += data[n * 3];
        sy += data[n * 3 + 1];
        sz += data[n * 3 + 2];
      }
      const inv = 1 / neighbors.size;
      temp[v * 3]     = data[v * 3]     + weight * (sx * inv - data[v * 3]);
      temp[v * 3 + 1] = data[v * 3 + 1] + weight * (sy * inv - data[v * 3 + 1]);
      temp[v * 3 + 2] = data[v * 3 + 2] + weight * (sz * inv - data[v * 3 + 2]);
    }
    data.set(temp);
  }

  for (let iter = 0; iter < iterations; iter++) {
    laplacianStep(coords, lambda); // Shrink
    laplacianStep(coords, mu);     // Inflate (un-shrink)
  }

  const result = g.clone();
  result.setAttribute('position', new THREE.BufferAttribute(coords, 3));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. mergeMesh – merge multiple geometries into one
// ─────────────────────────────────────────────────────────────────────────────

export function mergeMesh(
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  if (geos.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    empty.computeVertexNormals();
    return empty;
  }
  if (geos.length === 1) {
    const r = geos[0].clone();
    r.computeVertexNormals();
    return r;
  }

  let totalVertices = 0;
  let totalIndices = 0;
  const prepared: { pos: Float32Array; idx: Uint32Array }[] = [];

  for (const geo of geos) {
    const g = ensureIndexed(geo);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index!;
    prepared.push({
      pos: new Float32Array(pos.array),
      idx: new Uint32Array(idx.array),
    });
    totalVertices += pos.count;
    totalIndices += idx.count;
  }

  const mergedPos = new Float32Array(totalVertices * 3);
  const mergedIdx = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const { pos, idx } of prepared) {
    mergedPos.set(pos, vertexOffset * 3);
    for (let i = 0; i < idx.length; i++) {
      mergedIdx[indexOffset + i] = idx[i] + vertexOffset;
    }
    vertexOffset += pos.length / 3;
    indexOffset += idx.length;
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  result.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
  result.computeVertexNormals();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. detachedTriangles – remove small disconnected components
// ─────────────────────────────────────────────────────────────────────────────

export function detachedTriangles(
  geo: THREE.BufferGeometry,
  minArea: number = 0.01,
): THREE.BufferGeometry {
  const g = ensureIndexed(geo);
  const posAttr = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;
  const fCount = idx.count / 3;

  // Build face adjacency via shared edges
  const efMap = buildEdgeFaceMap(idx, fCount);
  const faceAdj = new Map<number, Set<number>>();
  for (let f = 0; f < fCount; f++) faceAdj.set(f, new Set());

  for (const [, faces] of efMap) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        faceAdj.get(faces[i])!.add(faces[j]);
        faceAdj.get(faces[j])!.add(faces[i]);
      }
    }
  }

  // BFS to find connected components of faces
  const componentId = new Int32Array(fCount).fill(-1);
  const components: number[][] = [];
  let currentComp = 0;

  for (let f = 0; f < fCount; f++) {
    if (componentId[f] !== -1) continue;
    const queue: number[] = [f];
    const comp: number[] = [];
    componentId[f] = currentComp;
    while (queue.length > 0) {
      const cf = queue.shift()!;
      comp.push(cf);
      for (const nf of faceAdj.get(cf)!) {
        if (componentId[nf] === -1) {
          componentId[nf] = currentComp;
          queue.push(nf);
        }
      }
    }
    components.push(comp);
    currentComp++;
  }

  // Compute total surface area for each component
  const keepFaces = new Set<number>();
  for (const comp of components) {
    let totalArea = 0;
    for (const f of comp) {
      const a = vec3FromAttr(posAttr, idx.getX(f * 3));
      const b = vec3FromAttr(posAttr, idx.getX(f * 3 + 1));
      const c = vec3FromAttr(posAttr, idx.getX(f * 3 + 2));
      totalArea += new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() * 0.5;
    }
    if (totalArea >= minArea) {
      for (const f of comp) keepFaces.add(f);
    }
  }

  // Rebuild
  const newIndices: number[] = [];
  for (let f = 0; f < fCount; f++) {
    if (!keepFaces.has(f)) continue;
    newIndices.push(idx.getX(f * 3), idx.getX(f * 3 + 1), idx.getX(f * 3 + 2));
  }

  const result = g.clone();
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  result.computeVertexNormals();
  return result;
}
