// ─── Motion Study / Kinematic Simulation ─────────────────────────────────────
// Joint-based animation system for assembly motion analysis.

import * as THREE from 'three';

/* ── Joint Types ── */

export type JointType = 'revolute' | 'prismatic' | 'ball' | 'cylindrical' | 'planar' | 'fixed';

export interface Joint {
  id: string;
  name: string;
  type: JointType;
  parentPartId: string;
  childPartId: string;
  origin: THREE.Vector3;   // joint origin in world space
  axis: THREE.Vector3;     // primary axis (rotation/translation)
  limits: { min: number; max: number }; // angle(rad) or distance
  currentValue: number;
  speed: number;           // rad/s or mm/s
  damping: number;
}

export interface MotionKeyframe {
  time: number;            // seconds
  jointValues: Record<string, number>; // jointId → value
}

export interface MotionStudyConfig {
  name: string;
  joints: Joint[];
  keyframes: MotionKeyframe[];
  duration: number;        // total seconds
  fps: number;
  loop: boolean;
  collisionDetect: boolean;
}

export interface MotionFrame {
  time: number;
  transforms: Record<string, THREE.Matrix4>; // partId → world transform
  collisions: { partA: string; partB: string; point: THREE.Vector3 }[];
}

/* ── Default Joint ── */

export function createDefaultJoint(parentId: string, childId: string): Joint {
  return {
    id: `joint_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: 'New Joint',
    type: 'revolute',
    parentPartId: parentId,
    childPartId: childId,
    origin: new THREE.Vector3(0, 0, 0),
    axis: new THREE.Vector3(0, 1, 0),
    limits: { min: -Math.PI, max: Math.PI },
    currentValue: 0,
    speed: 1,
    damping: 0.1,
  };
}

/* ── Build Part Bounding Boxes from Geometries ── */

export function buildPartBBoxesFromGeometries(
  partGeometries: Record<string, THREE.BufferGeometry>,
): Record<string, THREE.Box3> {
  const bboxes: Record<string, THREE.Box3> = {};
  for (const [id, geo] of Object.entries(partGeometries)) {
    geo.computeBoundingBox();
    if (geo.boundingBox) bboxes[id] = geo.boundingBox.clone();
  }
  return bboxes;
}

/* ── Kinematic Solver ── */

export function computeJointTransform(joint: Joint, value: number): THREE.Matrix4 {
  const mat = new THREE.Matrix4();
  const origin = joint.origin;
  const axis = joint.axis.clone().normalize();

  switch (joint.type) {
    case 'revolute': {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, value);
      const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);
      // T = Translate(origin) × Rotate(axis, value) × Translate(-origin)
      const pre  = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
      const post = new THREE.Matrix4().makeTranslation( origin.x,  origin.y,  origin.z);
      mat.copy(post).multiply(rot).multiply(pre);
      break;
    }
    case 'prismatic': {
      mat.makeTranslation(axis.x * value, axis.y * value, axis.z * value);
      break;
    }
    case 'ball': {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, value);
      mat.makeRotationFromQuaternion(q);
      break;
    }
    case 'cylindrical': {
      // Split value into rotation (70 %) and translation (30 %)
      const angle = value * 0.7;
      const dist  = value * 0.3;
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      const r = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const t = new THREE.Matrix4().makeTranslation(axis.x * dist, axis.y * dist, axis.z * dist);
      mat.copy(r).multiply(t);
      break;
    }
    case 'planar': {
      const perp = new THREE.Vector3(1, 0, 0);
      if (Math.abs(axis.dot(perp)) > 0.9) perp.set(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(axis, perp).normalize();
      mat.makeTranslation(u.x * value, u.y * value, u.z * value);
      break;
    }
    case 'fixed':
    default:
      mat.identity();
      break;
  }

  return mat;
}

/* ── Interpolate Keyframes ── */

function interpolateKeyframes(keyframes: MotionKeyframe[], time: number): Record<string, number> {
  if (keyframes.length === 0) return {};
  if (keyframes.length === 1) return { ...keyframes[0].jointValues };

  let prev = keyframes[0];
  let next = keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
      prev = keyframes[i];
      next = keyframes[i + 1];
      break;
    }
  }

  const dt = next.time - prev.time;
  const t  = dt > 0 ? (time - prev.time) / dt : 0;
  // Smooth-step
  const s  = t * t * (3 - 2 * t);

  const result: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(prev.jointValues), ...Object.keys(next.jointValues)]);
  allKeys.forEach(k => {
    const a = prev.jointValues[k] ?? 0;
    const b = next.jointValues[k] ?? 0;
    result[k] = a + (b - a) * s;
  });

  return result;
}

/* ── AABB Collision Detection ── */

function checkCollision(
  bboxA: THREE.Box3,
  bboxB: THREE.Box3,
): { collided: boolean; point: THREE.Vector3 } {
  if (bboxA.intersectsBox(bboxB)) {
    const overlap = bboxA.clone().intersect(bboxB);
    const center  = new THREE.Vector3();
    overlap.getCenter(center);
    return { collided: true, point: center };
  }
  return { collided: false, point: new THREE.Vector3() };
}

/* ── Run Full Motion Study (proper FK chain via BFS) ── */

export async function runMotionStudy(
  config: MotionStudyConfig,
  partBBoxes: Record<string, THREE.Box3>,
  onProgress?: (frame: number, total: number) => void,
): Promise<MotionFrame[]> {
  const frames: MotionFrame[] = [];
  const totalFrames = Math.ceil(config.duration * config.fps);

  // Pre-build adjacency: parentPartId → list of joints whose parent is that part
  const childrenOf = new Map<string, Joint[]>();
  for (const joint of config.joints) {
    const list = childrenOf.get(joint.parentPartId) ?? [];
    list.push(joint);
    childrenOf.set(joint.parentPartId, list);
  }

  // Find root parts: appear as parent but never as child
  const isChild = new Set(config.joints.map(j => j.childPartId));
  const allParts = new Set<string>();
  config.joints.forEach(j => { allParts.add(j.parentPartId); allParts.add(j.childPartId); });
  const roots = [...allParts].filter(p => !isChild.has(p));

  for (let f = 0; f <= totalFrames; f++) {
    const time          = f / config.fps;
    const effectiveTime = config.loop
      ? time % config.duration
      : Math.min(time, config.duration);

    const jointValues = config.keyframes.length > 0
      ? interpolateKeyframes(config.keyframes, effectiveTime)
      : {};

    // Compute each joint's local transform
    const jointMats: Record<string, THREE.Matrix4> = {};
    for (const joint of config.joints) {
      const kfValue = jointValues[joint.id];
      let value: number;
      if (kfValue !== undefined) {
        value = Math.max(joint.limits.min, Math.min(joint.limits.max, kfValue));
      } else {
        const range = joint.limits.max - joint.limits.min;
        const mid   = (joint.limits.max + joint.limits.min) / 2;
        value = mid + (range / 2) * Math.sin(effectiveTime * joint.speed);
      }
      jointMats[joint.id] = computeJointTransform(joint, value);
    }

    // BFS forward kinematics: T_child_world = T_parent_world × T_joint
    const partTransforms: Record<string, THREE.Matrix4> = {};
    const queue: string[] = [...roots];
    for (const r of roots) partTransforms[r] = new THREE.Matrix4(); // root = identity (world)

    while (queue.length > 0) {
      const partId   = queue.shift()!;
      const T_parent = partTransforms[partId] ?? new THREE.Matrix4();
      for (const joint of (childrenOf.get(partId) ?? [])) {
        partTransforms[joint.childPartId] = T_parent.clone().multiply(jointMats[joint.id]);
        queue.push(joint.childPartId);
      }
    }

    // Collision detection using world-space bboxes
    const collisions: { partA: string; partB: string; point: THREE.Vector3 }[] = [];
    if (config.collisionDetect) {
      const partIds = Object.keys(partBBoxes);
      for (let i = 0; i < partIds.length; i++) {
        for (let j = i + 1; j < partIds.length; j++) {
          const a = partIds[i];
          const b = partIds[j];
          const bboxA = partBBoxes[a].clone();
          const bboxB = partBBoxes[b].clone();
          if (partTransforms[a]) bboxA.applyMatrix4(partTransforms[a]);
          if (partTransforms[b]) bboxB.applyMatrix4(partTransforms[b]);
          const res = checkCollision(bboxA, bboxB);
          if (res.collided) collisions.push({ partA: a, partB: b, point: res.point });
        }
      }
    }

    frames.push({ time: effectiveTime, transforms: partTransforms, collisions });

    if (onProgress && f % 5 === 0) {
      onProgress(f, totalFrames);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  return frames;
}

/* ── Motion Study Results Summary ── */

export interface MotionSummary {
  totalFrames: number;
  duration: number;
  collisionCount: number;
  collisionTimes: number[];
  maxVelocity: Record<string, number>;
  rangeOfMotion: Record<string, { min: number; max: number }>;
}

export function summarizeMotion(frames: MotionFrame[], config: MotionStudyConfig): MotionSummary {
  const collisionTimes: number[] = [];
  let collisionCount = 0;

  for (const frame of frames) {
    if (frame.collisions.length > 0) {
      collisionCount += frame.collisions.length;
      collisionTimes.push(frame.time);
    }
  }

  const maxVelocity: Record<string, number>                        = {};
  const rangeOfMotion: Record<string, { min: number; max: number }> = {};

  for (const joint of config.joints) {
    maxVelocity[joint.id]    = Math.abs(joint.speed) * (joint.limits.max - joint.limits.min) / 2;
    rangeOfMotion[joint.id]  = { ...joint.limits };
  }

  return {
    totalFrames: frames.length,
    duration: config.duration,
    collisionCount,
    collisionTimes: [...new Set(collisionTimes.map(t => Math.round(t * 100) / 100))],
    maxVelocity,
    rangeOfMotion,
  };
}
