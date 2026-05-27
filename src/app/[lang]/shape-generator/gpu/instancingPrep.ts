/**
 * instancingPrep.ts — GPU instancing buffer preparation.
 *
 * Rendering 10,000 bolts as 10,000 separate draw calls is the slow
 * path. GPU instancing pushes the entire batch in *one* draw call,
 * with per-instance transforms (TRS) supplied as a vertex-rate
 * uniform buffer.
 *
 * This module builds the instancing buffers from per-instance
 * transforms:
 *
 *   - **Pack** per-instance TRS (translation + rotation quaternion +
 *     scale) into Float32 buffers ready for GPU upload.
 *   - **LOD culling** — emit per-instance "visible" flag based on
 *     distance/frustum check.
 *   - **Color attribute** for per-instance tint.
 *   - **GPU memory budget** estimator.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface InstanceTRS {
  position: Vec3;
  rotation: Quaternion;
  scale: Vec3;
  /** Optional per-instance color (RGBA 0..1). */
  color?: [number, number, number, number];
}

export interface InstancingBuffers {
  /** Per-instance 4×3 matrix (12 floats; matrix4 with last row implicit). */
  matrices: Float32Array;
  /** Per-instance RGBA color (4 floats). */
  colors: Float32Array;
  /** Per-instance visibility flag (1 = visible, 0 = culled). */
  visibility: Uint8Array;
  /** Live instance count after culling. */
  visibleCount: number;
  /** Total instance count. */
  instanceCount: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function packInstances(instances: InstanceTRS[]): InstancingBuffers {
  const n = instances.length;
  const matrices = new Float32Array(n * 12);
  const colors = new Float32Array(n * 4);
  const visibility = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const m = quaternionToMatrix43(instances[i]!.rotation, instances[i]!.position, instances[i]!.scale);
    matrices.set(m, i * 12);
    const c = instances[i]!.color ?? [1, 1, 1, 1];
    colors.set(c, i * 4);
  }
  return {
    matrices,
    colors,
    visibility,
    visibleCount: n,
    instanceCount: n,
  };
}

// ── Quaternion → 4×3 matrix (row-major upper, w-row implicit (0,0,0,1)) ─

export function quaternionToMatrix43(q: Quaternion, p: Vec3, s: Vec3): Float32Array {
  const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
  const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
  const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
  const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
  // Row-major 4 columns × 3 rows.
  return new Float32Array([
    (1 - (yy + zz)) * s.x, (xy - wz) * s.y, (xz + wy) * s.z, p.x,
    (xy + wz) * s.x, (1 - (xx + zz)) * s.y, (yz - wx) * s.z, p.y,
    (xz - wy) * s.x, (yz + wx) * s.y, (1 - (xx + yy)) * s.z, p.z,
  ]);
}

// ── Frustum / distance culling ────────────────────────────────

export interface CullingPlane {
  normal: Vec3;
  /** Plane offset: plane.normal · p + offset = 0 separates inside/outside. */
  offset: number;
}

export interface CullingOptions {
  cameraPosition: Vec3;
  maxDistanceMm: number;
  /** Frustum planes (6 typical: near/far/left/right/top/bottom). */
  frustum?: CullingPlane[];
}

export function applyCulling(buffers: InstancingBuffers, options: CullingOptions): void {
  let visible = 0;
  for (let i = 0; i < buffers.instanceCount; i++) {
    const px = buffers.matrices[i * 12 + 3]!;
    const py = buffers.matrices[i * 12 + 7]!;
    const pz = buffers.matrices[i * 12 + 11]!;
    const dx = px - options.cameraPosition.x;
    const dy = py - options.cameraPosition.y;
    const dz = pz - options.cameraPosition.z;
    const dist = Math.hypot(dx, dy, dz);
    let pass = dist <= options.maxDistanceMm;
    if (pass && options.frustum) {
      for (const plane of options.frustum) {
        const signed = px * plane.normal.x + py * plane.normal.y + pz * plane.normal.z + plane.offset;
        if (signed < 0) { pass = false; break; }
      }
    }
    buffers.visibility[i] = pass ? 1 : 0;
    if (pass) visible++;
  }
  buffers.visibleCount = visible;
}

// ── Memory budget ─────────────────────────────────────────────

export interface InstancingMemoryEstimate {
  matrixBytes: number;
  colorBytes: number;
  visibilityBytes: number;
  totalBytes: number;
  /** Estimated GPU memory (mb). */
  totalMB: number;
}

export function estimateMemory(instanceCount: number): InstancingMemoryEstimate {
  const matrixBytes = instanceCount * 12 * 4;
  const colorBytes = instanceCount * 4 * 4;
  const visibilityBytes = instanceCount;
  const total = matrixBytes + colorBytes + visibilityBytes;
  return {
    matrixBytes,
    colorBytes,
    visibilityBytes,
    totalBytes: total,
    totalMB: total / (1024 * 1024),
  };
}

// ── Compact visible instances ────────────────────────────────

/** Reorder buffers so visible instances are contiguous at the start.
 *  Lets the GPU draw N visible instances with one drawInstanced call. */
export function compactVisible(buffers: InstancingBuffers): InstancingBuffers {
  const visibleMatrices = new Float32Array(buffers.visibleCount * 12);
  const visibleColors = new Float32Array(buffers.visibleCount * 4);
  let w = 0;
  for (let i = 0; i < buffers.instanceCount; i++) {
    if (!buffers.visibility[i]) continue;
    visibleMatrices.set(buffers.matrices.subarray(i * 12, i * 12 + 12), w * 12);
    visibleColors.set(buffers.colors.subarray(i * 4, i * 4 + 4), w * 4);
    w++;
  }
  return {
    matrices: visibleMatrices,
    colors: visibleColors,
    visibility: new Uint8Array(buffers.visibleCount).fill(1),
    visibleCount: buffers.visibleCount,
    instanceCount: buffers.visibleCount,
  };
}

// ── Quaternion helpers ────────────────────────────────────────

export const QUATERNION_IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

export function eulerToQuaternion(rxRad: number, ryRad: number, rzRad: number): Quaternion {
  const cx = Math.cos(rxRad / 2), sx = Math.sin(rxRad / 2);
  const cy = Math.cos(ryRad / 2), sy = Math.sin(ryRad / 2);
  const cz = Math.cos(rzRad / 2), sz = Math.sin(rzRad / 2);
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

export function axisAngleToQuaternion(axis: Vec3, angleRad: number): Quaternion {
  const half = angleRad / 2;
  const s = Math.sin(half);
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  return { x: (axis.x / len) * s, y: (axis.y / len) * s, z: (axis.z / len) * s, w: Math.cos(half) };
}

// ── Grid / array helpers ──────────────────────────────────────

/** Build N×M instance grid for testing / mass placement. */
export function gridInstances(rows: number, cols: number, spacing: number, baseScale: Vec3 = { x: 1, y: 1, z: 1 }): InstanceTRS[] {
  const out: InstanceTRS[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        position: { x: c * spacing, y: 0, z: r * spacing },
        rotation: QUATERNION_IDENTITY,
        scale: baseScale,
      });
    }
  }
  return out;
}
