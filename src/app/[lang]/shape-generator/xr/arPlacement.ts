/**
 * arPlacement.ts — AR/VR anchor + transform math.
 *
 * WebXR sessions on Apple Vision Pro, Meta Quest, and supported
 * mobile browsers expose hit-test + anchor APIs. NexyFab uses
 * these to place a CAD model in the real room — see how it fits
 * before ordering.
 *
 * This module is the *math* layer:
 *   - Convert WebXR pose (XRRigidTransform) to scene matrix
 *   - Snap-to-floor / snap-to-wall computations
 *   - Co-location alignment for multi-user shared sessions
 *
 * Actual WebXR session lifecycle (request session, request
 * reference space, hit-test loop) lives in the React layer that
 * imports this module.
 */

export interface ArPose {
  /** World-frame position (m). */
  position: [number, number, number];
  /** World-frame orientation as quaternion. */
  orientation: [number, number, number, number];
}

export interface ArAnchor {
  id: string;
  pose: ArPose;
  /** When set, the anchor is "owned" by another user in a
   *  multi-user session. */
  remoteOwnerId?: string;
}

/** Convert a WebXR pose to a 4×4 row-major matrix. */
export function poseToMatrix4(pose: ArPose): number[] {
  const [px, py, pz] = pose.position;
  const [qx, qy, qz, qw] = pose.orientation;
  // Quaternion to rotation matrix.
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz),     2 * (xz + wy),     px,
    2 * (xy + wz),     1 - 2 * (xx + zz), 2 * (yz - wx),     py,
    2 * (xz - wy),     2 * (yz + wx),     1 - 2 * (xx + yy), pz,
    0, 0, 0, 1,
  ];
}

/** Snap a model so its bbox bottom sits on a floor hit-test
 *  result. Caller passes the model's local-frame bbox and the
 *  hit-test pose; we return the adjusted world transform. */
export function snapToFloor(
  modelBboxMin: [number, number, number],
  hitPose: ArPose,
): ArPose {
  // Translate model up so its lowest Y vertex equals hit Y.
  return {
    position: [hitPose.position[0], hitPose.position[1] - modelBboxMin[1], hitPose.position[2]],
    orientation: hitPose.orientation,
  };
}

/** Snap a model so its bbox face touches a vertical wall.
 *  `wallNormal` is in world coordinates, pointing away from the wall. */
export function snapToWall(
  modelBboxMin: [number, number, number],
  modelBboxMax: [number, number, number],
  wallHitPose: ArPose,
  wallNormal: [number, number, number],
): ArPose {
  // Determine which face of the bbox sits against the wall by
  // picking the axis most aligned with wallNormal.
  const absN = [Math.abs(wallNormal[0]), Math.abs(wallNormal[1]), Math.abs(wallNormal[2])];
  const axis = absN.indexOf(Math.max(...absN));
  const isPos = wallNormal[axis]! > 0;
  // Offset along that axis so the bbox face = wall hit point.
  const offset = isPos ? -modelBboxMax[axis]! : -modelBboxMin[axis]!;
  const adjusted: [number, number, number] = [
    wallHitPose.position[0],
    wallHitPose.position[1],
    wallHitPose.position[2],
  ];
  adjusted[axis] += offset;
  return { position: adjusted, orientation: wallHitPose.orientation };
}

/** Co-location: compute the transform that maps anchor A in
 *  user-A's session frame to anchor A in user-B's session frame.
 *  Used for multi-user AR where both users see the model in the
 *  same physical location. */
export function coLocationTransform(
  anchorInA: ArPose,
  anchorInB: ArPose,
): { rotation: [number, number, number, number]; translation: [number, number, number] } {
  // Inverse of A's pose applied to B's pose.
  const invA = invertQuaternion(anchorInA.orientation);
  const relRot = quatMul(invA, anchorInB.orientation);
  // Position delta in B's frame.
  const dP: [number, number, number] = [
    anchorInB.position[0] - anchorInA.position[0],
    anchorInB.position[1] - anchorInA.position[1],
    anchorInB.position[2] - anchorInA.position[2],
  ];
  return { rotation: relRot, translation: dP };
}

function invertQuaternion(q: [number, number, number, number]): [number, number, number, number] {
  const lenSq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  if (lenSq === 0) return [0, 0, 0, 1];
  return [-q[0] / lenSq, -q[1] / lenSq, -q[2] / lenSq, q[3] / lenSq];
}

function quatMul(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Detect dominant device for UI scaling — Vision Pro has
 *  different ergonomics than Quest 3. */
export type XrDevice = 'vision-pro' | 'quest' | 'mobile-arkit' | 'mobile-arcore' | 'desktop-fallback' | 'unknown';

export function detectXrDevice(userAgent: string): XrDevice {
  const ua = userAgent.toLowerCase();
  if (ua.includes('vision')) return 'vision-pro';
  if (ua.includes('quest')) return 'quest';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'mobile-arkit';
  if (ua.includes('android')) return 'mobile-arcore';
  return 'desktop-fallback';
}
