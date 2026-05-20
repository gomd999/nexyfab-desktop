/**
 * meshSkinning.ts — Linear blend skinning for rigged meshes.
 *
 * Skinning binds mesh vertices to a hierarchy of bones (joints) via
 * weight blending. When a bone rotates, all vertices weighted to it
 * deform accordingly. Used for:
 *
 *   - **Posable mannequins** in apparel / furniture catalogs.
 *   - **Articulated machinery** previews (robot arms, animatronics).
 *   - **Soft-body proxies** where each "bone" represents a flexible
 *     segment that bends in place.
 *
 * Algorithm: classical Linear Blend Skinning (LBS).
 *
 *   v' = Σ w_i × (M_i × v)
 *
 *   where M_i = bone i's current world transform × inverse of its
 *   bind-pose transform, and the weights sum to 1.
 *
 * LBS produces "candy wrapper" pinching at heavily twisted joints;
 * Dual-Quaternion Skinning (DQS) is the production fix. We provide
 * both — LBS for speed, DQS for quality.
 */

export type Vec3 = [number, number, number];
export type Mat4 = number[];

export interface Bone {
  id: string;
  parentId: string | null;
  /** Local transform relative to parent (4×4 row-major). */
  localTransform: Mat4;
  /** Cached inverse bind-pose world transform. */
  inverseBindMatrix?: Mat4;
}

export interface Skeleton {
  bones: Bone[];
  /** Map of bone id → index. */
  boneIndex: Map<string, number>;
}

export interface SkinnedVertex {
  /** Bone indices (up to maxInfluences). */
  boneIndices: number[];
  /** Per-bone weights (must sum to 1). */
  weights: number[];
}

export interface SkinnedMesh {
  /** Bind-pose positions. */
  positionsBind: number[];
  /** Triangle indices. */
  indices: number[];
  /** One entry per vertex with bone influences. */
  influences: SkinnedVertex[];
  /** Skeleton. */
  skeleton: Skeleton;
}

// ── Skeleton management ─────────────────────────────────────────

export function buildSkeleton(bones: Bone[]): Skeleton {
  const index = new Map<string, number>();
  bones.forEach((b, i) => index.set(b.id, i));
  return { bones, boneIndex: index };
}

/** Walk the bone tree and compute each bone's world transform.
 *  Returns an array of 4×4 matrices indexed by bone position. */
export function computeWorldTransforms(skeleton: Skeleton): Mat4[] {
  const result: Mat4[] = new Array(skeleton.bones.length);
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i]!;
    if (bone.parentId === null) {
      result[i] = bone.localTransform.slice();
    } else {
      const parentIdx = skeleton.boneIndex.get(bone.parentId);
      if (parentIdx === undefined || parentIdx >= i) {
        result[i] = bone.localTransform.slice();
      } else {
        result[i] = multiplyMat4(result[parentIdx]!, bone.localTransform);
      }
    }
  }
  return result;
}

/** Capture the current world transforms as the bind pose. */
export function captureInverseBindMatrices(skeleton: Skeleton): void {
  const world = computeWorldTransforms(skeleton);
  for (let i = 0; i < skeleton.bones.length; i++) {
    skeleton.bones[i]!.inverseBindMatrix = inverseMat4(world[i]!);
  }
}

// ── Influences ─────────────────────────────────────────────────

/** Normalize weights so they sum to 1; drop influences past maxInfluences. */
export function normalizeInfluences(verts: SkinnedVertex[], maxInfluences: number = 4): void {
  for (const v of verts) {
    // Sort by descending weight + truncate.
    const pairs = v.boneIndices.map((b, i) => ({ bone: b, weight: v.weights[i] ?? 0 }));
    pairs.sort((a, b) => b.weight - a.weight);
    const trimmed = pairs.slice(0, maxInfluences);
    const sum = trimmed.reduce((s, p) => s + p.weight, 0);
    v.boneIndices = trimmed.map(p => p.bone);
    v.weights = trimmed.map(p => sum > 0 ? p.weight / sum : 0);
  }
}

// ── Linear Blend Skinning ──────────────────────────────────────

export function skinLinearBlend(mesh: SkinnedMesh): number[] {
  const worlds = computeWorldTransforms(mesh.skeleton);
  // Per-bone skin matrix = world × inverseBind.
  const skinMatrices: Mat4[] = new Array(mesh.skeleton.bones.length);
  for (let i = 0; i < mesh.skeleton.bones.length; i++) {
    const inv = mesh.skeleton.bones[i]!.inverseBindMatrix;
    if (inv) {
      skinMatrices[i] = multiplyMat4(worlds[i]!, inv);
    } else {
      skinMatrices[i] = worlds[i]!;
    }
  }

  const vertCount = mesh.positionsBind.length / 3;
  const out = new Array(vertCount * 3);
  for (let v = 0; v < vertCount; v++) {
    const px = mesh.positionsBind[v * 3]!;
    const py = mesh.positionsBind[v * 3 + 1]!;
    const pz = mesh.positionsBind[v * 3 + 2]!;
    const inf = mesh.influences[v];
    if (!inf || inf.boneIndices.length === 0) {
      out[v * 3] = px;
      out[v * 3 + 1] = py;
      out[v * 3 + 2] = pz;
      continue;
    }
    let outX = 0, outY = 0, outZ = 0;
    for (let k = 0; k < inf.boneIndices.length; k++) {
      const bi = inf.boneIndices[k]!;
      const w = inf.weights[k]!;
      const m = skinMatrices[bi];
      if (!m) continue;
      outX += w * (m[0]! * px + m[1]! * py + m[2]! * pz + m[3]!);
      outY += w * (m[4]! * px + m[5]! * py + m[6]! * pz + m[7]!);
      outZ += w * (m[8]! * px + m[9]! * py + m[10]! * pz + m[11]!);
    }
    out[v * 3] = outX;
    out[v * 3 + 1] = outY;
    out[v * 3 + 2] = outZ;
  }
  return out;
}

// ── Dual-quaternion skinning ───────────────────────────────────

export interface DualQuaternion {
  /** Real part (rotation). */
  real: [number, number, number, number];
  /** Dual part (translation × rotation/2). */
  dual: [number, number, number, number];
}

export function mat4ToDualQuaternion(m: Mat4): DualQuaternion {
  const real = matrixToQuat(m);
  const tx = m[3]!, ty = m[7]!, tz = m[11]!;
  // Dual = 0.5 * t * real (quaternion product with t as pure quaternion).
  const [rx, ry, rz, rw] = real;
  const dual: [number, number, number, number] = [
    0.5 * (tx * rw + ty * rz - tz * ry),
    0.5 * (-tx * rz + ty * rw + tz * rx),
    0.5 * (tx * ry - ty * rx + tz * rw),
    0.5 * (-tx * rx - ty * ry - tz * rz),
  ];
  return { real, dual };
}

function matrixToQuat(m: Mat4): [number, number, number, number] {
  // Standard Shoemake conversion.
  const m00 = m[0]!, m01 = m[1]!, m02 = m[2]!;
  const m10 = m[4]!, m11 = m[5]!, m12 = m[6]!;
  const m20 = m[8]!, m21 = m[9]!, m22 = m[10]!;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
}

/** DQS — blends bone transforms in dual-quaternion form for kink-free
 *  rotation blending. */
export function skinDualQuaternion(mesh: SkinnedMesh): number[] {
  const worlds = computeWorldTransforms(mesh.skeleton);
  const skinDqs: DualQuaternion[] = [];
  for (let i = 0; i < mesh.skeleton.bones.length; i++) {
    const inv = mesh.skeleton.bones[i]!.inverseBindMatrix;
    const skin = inv ? multiplyMat4(worlds[i]!, inv) : worlds[i]!;
    skinDqs.push(mat4ToDualQuaternion(skin));
  }

  const vertCount = mesh.positionsBind.length / 3;
  const out = new Array(vertCount * 3);
  for (let v = 0; v < vertCount; v++) {
    const inf = mesh.influences[v];
    if (!inf || inf.boneIndices.length === 0) {
      out[v * 3] = mesh.positionsBind[v * 3]!;
      out[v * 3 + 1] = mesh.positionsBind[v * 3 + 1]!;
      out[v * 3 + 2] = mesh.positionsBind[v * 3 + 2]!;
      continue;
    }
    // Blend dual quaternions weighted.
    const blended: DualQuaternion = { real: [0, 0, 0, 0], dual: [0, 0, 0, 0] };
    const firstReal = skinDqs[inf.boneIndices[0]!]!.real;
    for (let k = 0; k < inf.boneIndices.length; k++) {
      const dq = skinDqs[inf.boneIndices[k]!]!;
      let w = inf.weights[k]!;
      // Antipodality: if quaternion is on the opposite hemisphere, negate.
      const dot = dq.real[0] * firstReal[0] + dq.real[1] * firstReal[1] +
                  dq.real[2] * firstReal[2] + dq.real[3] * firstReal[3];
      if (dot < 0) w = -w;
      blended.real[0] += w * dq.real[0];
      blended.real[1] += w * dq.real[1];
      blended.real[2] += w * dq.real[2];
      blended.real[3] += w * dq.real[3];
      blended.dual[0] += w * dq.dual[0];
      blended.dual[1] += w * dq.dual[1];
      blended.dual[2] += w * dq.dual[2];
      blended.dual[3] += w * dq.dual[3];
    }
    // Normalize.
    const len = Math.hypot(blended.real[0], blended.real[1], blended.real[2], blended.real[3]);
    if (len > 0) {
      const inv = 1 / len;
      for (let i = 0; i < 4; i++) {
        blended.real[i] *= inv;
        blended.dual[i] *= inv;
      }
    }
    // Apply to vertex.
    const p: Vec3 = [mesh.positionsBind[v * 3]!, mesh.positionsBind[v * 3 + 1]!, mesh.positionsBind[v * 3 + 2]!];
    const result = applyDqToPoint(blended, p);
    out[v * 3] = result[0];
    out[v * 3 + 1] = result[1];
    out[v * 3 + 2] = result[2];
  }
  return out;
}

function applyDqToPoint(dq: DualQuaternion, p: Vec3): Vec3 {
  // Rotate by quat then translate by 2 * dual * conjugate(real).
  const [rx, ry, rz, rw] = dq.real;
  // Rotation by quaternion: v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const t1: Vec3 = [
    ry * p[2] - rz * p[1] + rw * p[0],
    rz * p[0] - rx * p[2] + rw * p[1],
    rx * p[1] - ry * p[0] + rw * p[2],
  ];
  const rotated: Vec3 = [
    p[0] + 2 * (ry * t1[2] - rz * t1[1]),
    p[1] + 2 * (rz * t1[0] - rx * t1[2]),
    p[2] + 2 * (rx * t1[1] - ry * t1[0]),
  ];
  // Translation t = 2 * (dual * real^-1)_xyz.
  const t: Vec3 = [
    2 * (dq.dual[3] * rx - dq.dual[0] * rw + dq.dual[1] * rz - dq.dual[2] * ry),
    2 * (dq.dual[3] * ry - dq.dual[0] * rz - dq.dual[1] * rw + dq.dual[2] * rx),
    2 * (dq.dual[3] * rz + dq.dual[0] * ry - dq.dual[1] * rx - dq.dual[2] * rw),
  ];
  return [rotated[0] - t[0], rotated[1] - t[1], rotated[2] - t[2]];
}

// ── Matrix helpers ──────────────────────────────────────────────

export function identityMat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0]! * b[0 * 4 + c]! +
        a[r * 4 + 1]! * b[1 * 4 + c]! +
        a[r * 4 + 2]! * b[2 * 4 + c]! +
        a[r * 4 + 3]! * b[3 * 4 + c]!;
    }
  }
  return out;
}

export function inverseMat4(m: Mat4): Mat4 {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return identityMat4();
  const invDet = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * invDet,
    (-a01 * b11 + a02 * b10 - a03 * b09) * invDet,
    (a31 * b05 - a32 * b04 + a33 * b03) * invDet,
    (-a21 * b05 + a22 * b04 - a23 * b03) * invDet,
    (-a10 * b11 + a12 * b08 - a13 * b07) * invDet,
    (a00 * b11 - a02 * b08 + a03 * b07) * invDet,
    (-a30 * b05 + a32 * b02 - a33 * b01) * invDet,
    (a20 * b05 - a22 * b02 + a23 * b01) * invDet,
    (a10 * b10 - a11 * b08 + a13 * b06) * invDet,
    (-a00 * b10 + a01 * b08 - a03 * b06) * invDet,
    (a30 * b04 - a31 * b02 + a33 * b00) * invDet,
    (-a20 * b04 + a21 * b02 - a23 * b00) * invDet,
    (-a10 * b09 + a11 * b07 - a12 * b06) * invDet,
    (a00 * b09 - a01 * b07 + a02 * b06) * invDet,
    (-a30 * b03 + a31 * b01 - a32 * b00) * invDet,
    (a20 * b03 - a21 * b01 + a22 * b00) * invDet,
  ];
}
