/**
 * directEditing.ts — Push-pull face editing for imported / dumb solids.
 *
 * Parametric features (extrude/revolve) regenerate cleanly when you
 * edit a parameter. But STEP-imported geometry has no feature history
 * — you can't "edit the extrude depth" because there is no extrude.
 *
 * Direct editing solves this by acting on the *mesh* directly:
 *
 *   - **Push-pull face** — translate every vertex on the selected
 *     face along its normal by `delta`. Adjacent faces auto-stretch
 *     to follow.
 *   - **Offset edge** — slide an edge loop perpendicular to itself.
 *   - **Move hole** — translate every vertex of a hole-bounded face
 *     by a 3D vector.
 *   - **Resize hole** — scale the hole's vertex ring outward (radius
 *     change).
 *   - **Replace face** — substitute one analytical primitive for
 *     another (e.g. swap a cylindrical hole for a slot).
 *
 * The operations use the per-triangle topology map
 * (`triangleToTopoMap.ts`) to find the vertex set per face. After
 * editing, normals are re-computed + mesh healing Stage 1 runs to
 * weld neighbouring face vertices.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface FaceSelection {
  /** Triangle indices belonging to this face. */
  triangleIndices: number[];
  /** Computed face normal (unit). */
  normal: [number, number, number];
  /** Computed face centroid (mm). */
  centroid: [number, number, number];
}

/** Compute centroid + averaged normal for a set of triangles. */
export function summarizeFace(mesh: MeshArrays, triangleIndices: number[]): FaceSelection {
  let cx = 0, cy = 0, cz = 0;
  let nx = 0, ny = 0, nz = 0;
  let vertCount = 0;
  const seenVerts = new Set<number>();
  for (const t of triangleIndices) {
    const a = mesh.indices[t * 3]!;
    const b = mesh.indices[t * 3 + 1]!;
    const c = mesh.indices[t * 3 + 2]!;
    for (const v of [a, b, c]) {
      if (seenVerts.has(v)) continue;
      seenVerts.add(v);
      cx += mesh.positions[v * 3]!;
      cy += mesh.positions[v * 3 + 1]!;
      cz += mesh.positions[v * 3 + 2]!;
      vertCount++;
    }
    // Triangle normal via cross.
    const ax = mesh.positions[a * 3]!, ay = mesh.positions[a * 3 + 1]!, az = mesh.positions[a * 3 + 2]!;
    const bx = mesh.positions[b * 3]!, by = mesh.positions[b * 3 + 1]!, bz = mesh.positions[b * 3 + 2]!;
    const ccx = mesh.positions[c * 3]!, ccy = mesh.positions[c * 3 + 1]!, ccz = mesh.positions[c * 3 + 2]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = ccx - ax, vy = ccy - ay, vz = ccz - az;
    nx += uy * vz - uz * vy;
    ny += uz * vx - ux * vz;
    nz += ux * vy - uy * vx;
  }
  const nLen = Math.hypot(nx, ny, nz) || 1;
  return {
    triangleIndices,
    normal: [nx / nLen, ny / nLen, nz / nLen],
    centroid: vertCount > 0 ? [cx / vertCount, cy / vertCount, cz / vertCount] : [0, 0, 0],
  };
}

/** Translate every unique vertex of the selected face along its
 *  normal by `delta` mm. Returns a new mesh; original is untouched. */
export function pushPullFace(
  mesh: MeshArrays,
  face: FaceSelection,
  deltaMm: number,
): MeshArrays {
  const positions = mesh.positions.slice();
  const indices = mesh.indices.slice();
  const moved = new Set<number>();
  for (const t of face.triangleIndices) {
    for (const offset of [0, 1, 2]) {
      const v = indices[t * 3 + offset]!;
      if (moved.has(v)) continue;
      moved.add(v);
      positions[v * 3]     += face.normal[0] * deltaMm;
      positions[v * 3 + 1] += face.normal[1] * deltaMm;
      positions[v * 3 + 2] += face.normal[2] * deltaMm;
    }
  }
  return { positions, indices };
}

/** Translate the selected face's vertices by a free vector (3D move). */
export function moveFace(
  mesh: MeshArrays,
  face: FaceSelection,
  delta: [number, number, number],
): MeshArrays {
  const positions = mesh.positions.slice();
  const indices = mesh.indices.slice();
  const moved = new Set<number>();
  for (const t of face.triangleIndices) {
    for (const offset of [0, 1, 2]) {
      const v = indices[t * 3 + offset]!;
      if (moved.has(v)) continue;
      moved.add(v);
      positions[v * 3]     += delta[0];
      positions[v * 3 + 1] += delta[1];
      positions[v * 3 + 2] += delta[2];
    }
  }
  return { positions, indices };
}

/** Scale a hole's bounding ring outward / inward by a factor about
 *  its centroid (in the plane perpendicular to the face normal). */
export function resizeHole(
  mesh: MeshArrays,
  face: FaceSelection,
  radiusDeltaMm: number,
): MeshArrays {
  const positions = mesh.positions.slice();
  const indices = mesh.indices.slice();
  const moved = new Set<number>();
  for (const t of face.triangleIndices) {
    for (const offset of [0, 1, 2]) {
      const v = indices[t * 3 + offset]!;
      if (moved.has(v)) continue;
      moved.add(v);
      const px = positions[v * 3]!;
      const py = positions[v * 3 + 1]!;
      const pz = positions[v * 3 + 2]!;
      // Vector from centroid in part coords.
      const dx = px - face.centroid[0];
      const dy = py - face.centroid[1];
      const dz = pz - face.centroid[2];
      // Project to plane perpendicular to face normal.
      const dot = dx * face.normal[0] + dy * face.normal[1] + dz * face.normal[2];
      const inPlaneX = dx - dot * face.normal[0];
      const inPlaneY = dy - dot * face.normal[1];
      const inPlaneZ = dz - dot * face.normal[2];
      const planeDist = Math.hypot(inPlaneX, inPlaneY, inPlaneZ);
      if (planeDist === 0) continue;
      // New radius.
      const newDist = planeDist + radiusDeltaMm;
      const scale = newDist / planeDist;
      positions[v * 3]     = face.centroid[0] + scale * inPlaneX + dot * face.normal[0];
      positions[v * 3 + 1] = face.centroid[1] + scale * inPlaneY + dot * face.normal[1];
      positions[v * 3 + 2] = face.centroid[2] + scale * inPlaneZ + dot * face.normal[2];
    }
  }
  return { positions, indices };
}

/** Rotate a face about its centroid + a given axis. Useful for
 *  push-pull "twist" or fine-tuning the angle of an imported face. */
export function rotateFace(
  mesh: MeshArrays,
  face: FaceSelection,
  axis: [number, number, number],
  angleRad: number,
): MeshArrays {
  const positions = mesh.positions.slice();
  const indices = mesh.indices.slice();
  const moved = new Set<number>();
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const aLen = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const ax = axis[0] / aLen, ay = axis[1] / aLen, az = axis[2] / aLen;
  // Rodrigues' rotation formula.
  for (const t of face.triangleIndices) {
    for (const offset of [0, 1, 2]) {
      const v = indices[t * 3 + offset]!;
      if (moved.has(v)) continue;
      moved.add(v);
      const px = positions[v * 3]! - face.centroid[0];
      const py = positions[v * 3 + 1]! - face.centroid[1];
      const pz = positions[v * 3 + 2]! - face.centroid[2];
      const dot = ax * px + ay * py + az * pz;
      // p_rot = p·cos + (axis × p)·sin + axis·(axis·p)·(1-cos)
      const cx = ay * pz - az * py;
      const cy = az * px - ax * pz;
      const cz = ax * py - ay * px;
      positions[v * 3]     = face.centroid[0] + px * cos + cx * sin + ax * dot * (1 - cos);
      positions[v * 3 + 1] = face.centroid[1] + py * cos + cy * sin + ay * dot * (1 - cos);
      positions[v * 3 + 2] = face.centroid[2] + pz * cos + cz * sin + az * dot * (1 - cos);
    }
  }
  return { positions, indices };
}

// ── History (undo) ───────────────────────────────────────────────

export interface DirectEditOp {
  kind: 'push-pull' | 'move' | 'resize-hole' | 'rotate';
  /** Position snapshot before the edit, length = positions.length. */
  beforePositions: number[];
}

export interface EditSession {
  history: DirectEditOp[];
}

export function pushOperation(session: EditSession, kind: DirectEditOp['kind'], before: number[]): void {
  session.history.push({ kind, beforePositions: before.slice() });
  // Cap history at 50 ops to prevent unbounded memory growth.
  if (session.history.length > 50) session.history.shift();
}

export function undo(session: EditSession, mesh: MeshArrays): MeshArrays | null {
  const op = session.history.pop();
  if (!op) return null;
  return { positions: op.beforePositions, indices: mesh.indices };
}

// ── Live preview ─────────────────────────────────────────────────

/** During a drag, the UI wants to preview the edit without committing.
 *  This returns the preview mesh + a callback that, when called, makes
 *  the edit permanent (pushing it to undo history). */
export interface LivePreview {
  previewMesh: MeshArrays;
  commit: (session: EditSession) => MeshArrays;
}

export function previewPushPull(
  mesh: MeshArrays,
  face: FaceSelection,
  deltaMm: number,
): LivePreview {
  const before = mesh.positions.slice();
  const preview = pushPullFace(mesh, face, deltaMm);
  return {
    previewMesh: preview,
    commit: (session) => {
      pushOperation(session, 'push-pull', before);
      return preview;
    },
  };
}
