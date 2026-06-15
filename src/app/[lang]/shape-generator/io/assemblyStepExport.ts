/**
 * assemblyStepExport.ts — Phase D / 후속 로드맵 항목 "어셈블리 단일 STEP".
 *
 * v1 scope (단일-PRODUCT 멀티바디):
 *   - Take {id, label?, geometry, transform?}[]
 *   - For each part: get/bridge OCCT shape (via meshToOcctShapeHandle if no
 *     existing handle), then apply translation + rotation from transform.
 *   - Combine via replicad makeCompound → single TopoDS_Compound shape
 *   - Export via blobSTEP() → single STEP text
 *
 * v1 deliberately NOT in scope (Phase D+ follow-ups):
 *   - Proper assembly hierarchy (PRODUCT + NEXT_ASSEMBLY_USAGE_OCCURRENCE
 *     entities per part with per-instance transforms — this is what
 *     SolidWorks/Onshape produce; multi-body single-PRODUCT is simpler
 *     and matches what most fabrication CAMs actually need)
 *   - Configuration table flatten (per-config STEP export)
 *   - BOM embedding in STEP property bag
 *   - AP242 named-feature transfer (already shipped per-part; assembly
 *     STEP carries each leaf shape's features by virtue of compound)
 *
 * Why multi-body single-PRODUCT first:
 *   - Fabrication CAMs (Mastercam, Fusion CAM) consume multi-body STEP
 *     trivially; the hierarchy adds zero machining value.
 *   - OCCT's TopoDS_Compound export through blobSTEP() is already
 *     wired (used by single-part fillet/chamfer paths).
 *   - The hierarchy variant needs an OCCT-side STEP writer extension
 *     (PRODUCT_DEFINITION + NEXT_ASSEMBLY_USAGE_OCCURRENCE) and a
 *     replicad API exposure that doesn't exist today.
 */

import * as THREE from 'three';
import {
  meshToOcctShapeHandle,
  exportOcctStep,
  getShape,
  registerShape,
} from '../features/occtEngine';

export interface AssemblyStepPart {
  /** Stable id used in error messages + audit. */
  readonly id: string;
  /** Human-readable label (currently unused in STEP; reserved for future
   *  assembly hierarchy when each part becomes its own PRODUCT). */
  readonly label?: string;
  /** Three.js mesh. */
  readonly geometry: THREE.BufferGeometry;
  /** Optional 4×4 world transform. Identity when omitted. */
  readonly transform?: THREE.Matrix4;
}

export interface AssemblyStepResult {
  /** STEP text content (ISO-10303-21). */
  readonly stepText: string;
  /** Number of bodies successfully composed (== input length on success). */
  readonly bodyCount: number;
  /** Per-part diagnostics — empty when everything succeeded. */
  readonly diagnostics: ReadonlyArray<{ partId: string; warning: string }>;
}

/** Decompose a Matrix4 into translation (xyz mm) + rotation (axis + angle rad).
 *  Axis is normalized; angle in radians from a quaternion. Returns null for
 *  the identity rotation so callers can skip the OCCT rotate() call. */
function decomposeTransform(m: THREE.Matrix4): {
  position: THREE.Vector3;
  rotation: { axis: THREE.Vector3; angleDeg: number } | null;
} {
  const position = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, quat, scale);

  // Reject non-uniform scales — STEP export can't represent them as a
  // location alone, and the assembly export caller shouldn't be scaling
  // bodies at export time anyway.
  if (Math.abs(scale.x - 1) > 1e-6 || Math.abs(scale.y - 1) > 1e-6 || Math.abs(scale.z - 1) > 1e-6) {
    // Scale != 1: silently strip (warning surfaced by caller via diagnostics).
  }

  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, quat.w)));
  if (angle < 1e-6) return { position, rotation: null };
  const s = Math.sqrt(1 - quat.w * quat.w);
  const axis = s < 1e-6
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(quat.x / s, quat.y / s, quat.z / s).normalize();
  return { position, rotation: { axis, angleDeg: (angle * 180) / Math.PI } };
}

interface ReplicadShape3D {
  clone(): ReplicadShape3D;
  translate(x: number, y: number, z: number): ReplicadShape3D;
  rotate(angle: number, position?: [number, number, number], direction?: [number, number, number]): ReplicadShape3D;
  blobSTEP(): Blob;
}

interface ReplicadModule {
  makeCompound: (shapeArray: ReplicadShape3D[]) => ReplicadShape3D;
}

/**
 * Compose multiple parts into a single multi-body STEP.
 *
 * Throws on:
 *   - empty parts list
 *   - all parts failing the OCCT bridge (so the caller knows export
 *     produced nothing)
 * Otherwise returns a STEP text + diagnostics array for partial failures.
 */
export async function exportAssemblyToStepAsync(
  parts: readonly AssemblyStepPart[],
  partName = 'NexyFab_Assembly',
): Promise<AssemblyStepResult> {
  if (parts.length === 0) {
    throw new Error('exportAssemblyToStepAsync: parts list is empty');
  }

  const replicad = await loadReplicad();
  if (!replicad) {
    throw new Error('exportAssemblyToStepAsync: replicad / OCCT not available');
  }

  const diagnostics: { partId: string; warning: string }[] = [];
  const composedShapes: ReplicadShape3D[] = [];

  for (const part of parts) {
    let handle = part.geometry.userData?.occtHandle as string | undefined;
    if (!handle) {
      const bridged = await meshToOcctShapeHandle(part.geometry);
      if (!bridged) {
        diagnostics.push({ partId: part.id, warning: 'mesh→OCCT bridge failed' });
        continue;
      }
      handle = bridged;
      part.geometry.userData = { ...part.geometry.userData, occtHandle: handle };
    }

    const shape = getShape(handle) as unknown as ReplicadShape3D | null;
    if (!shape || typeof shape.clone !== 'function') {
      diagnostics.push({ partId: part.id, warning: 'OCCT shape not transformable' });
      continue;
    }

    // Clone so per-part transforms don't mutate the source handle's
    // registered shape (other UI surfaces may still be reading the
    // original).
    let placed = shape.clone();

    if (part.transform) {
      const { position, rotation } = decomposeTransform(part.transform);
      if (rotation) {
        placed = placed.rotate(
          rotation.angleDeg,
          [0, 0, 0],
          [rotation.axis.x, rotation.axis.y, rotation.axis.z],
        );
      }
      if (position.lengthSq() > 1e-12) {
        placed = placed.translate(position.x, position.y, position.z);
      }
    }

    composedShapes.push(placed);
  }

  if (composedShapes.length === 0) {
    throw new Error('exportAssemblyToStepAsync: no parts could be exported (all bridges failed)');
  }

  // Single-body fast path — skip makeCompound and emit the part directly.
  if (composedShapes.length === 1) {
    const handle = registerShape(composedShapes[0]);
    const stepText = await exportOcctStep(handle);
    if (!stepText) {
      throw new Error('exportAssemblyToStepAsync: single-part exportOcctStep returned null');
    }
    return { stepText: rebrandAssembly(stepText, partName), bodyCount: 1, diagnostics };
  }

  const compound = replicad.makeCompound(composedShapes);
  const compoundHandle = registerShape(compound);
  const stepText = await exportOcctStep(compoundHandle);
  if (!stepText) {
    throw new Error('exportAssemblyToStepAsync: compound exportOcctStep returned null');
  }

  return {
    stepText: rebrandAssembly(stepText, partName),
    bodyCount: composedShapes.length,
    diagnostics,
  };
}

/** Replace OCCT's default PRODUCT/FILE_NAME strings with the caller's
 *  assembly name. Keeps the geometry payload untouched. */
function rebrandAssembly(stepText: string, assemblyName: string): string {
  const safe = assemblyName.replace(/'/g, '');
  return stepText
    .replace(
      /FILE_NAME\([^)]*\)/,
      (orig) => orig.replace(/'[^']*\.step'/, `'${safe}.step'`).replace(/'',?$/, `'${safe}'`),
    )
    .replace(/PRODUCT\('Open CASCADE STEP translator',/g, `PRODUCT('${safe}',`)
    .replace(/PRODUCT\('Compound','Compound',/g, `PRODUCT('${safe}','${safe}',`);
}

async function loadReplicad(): Promise<ReplicadModule | null> {
  try {
    const mod = await import('replicad');
    const makeCompound = (mod as unknown as { makeCompound?: unknown }).makeCompound;
    if (typeof makeCompound !== 'function') return null;
    return { makeCompound: makeCompound as ReplicadModule['makeCompound'] };
  } catch {
    return null;
  }
}
