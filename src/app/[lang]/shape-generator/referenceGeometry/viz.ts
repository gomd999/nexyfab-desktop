/**
 * referenceGeometry/viz.ts — Three.js visualization for `ReferenceNode[]`.
 *
 * Wave 2 Phase 2 Track D3. Spec §8.
 *
 * Pure builder: `buildReferenceMeshes(nodes)` returns a flat
 * `THREE.Object3D[]` that callers mount as siblings of the rest of the
 * scene. No React. No store subscription. The React layer
 * (`ReferenceGeometryLayer.tsx`) does the subscribe-and-mount.
 *
 * Coloring:
 *
 *   - Each node id hashes to a stable HSL so visually distinct items
 *     stay distinct across re-renders. Plane uses the tinted fill;
 *     axis/point/csys use the hue as a stroke.
 *   - Nodes with `error` set (parent missing, cycle, degenerate,
 *     unsupported) are *skipped* — they shouldn't be visible in the
 *     viewport, the tree row already shows the badge.
 *
 * Sizing (spec §8):
 *
 *   - Plane: 60×60 mm tinted quad (THREE.PlaneGeometry +
 *     THREE.MeshBasicMaterial transparent 0.15).
 *   - Axis: ±50 mm line from origin along direction. THREE.Line +
 *     LineBasicMaterial.
 *   - Point: r=1mm sphere.
 *   - CSys: three 20mm axes red/green/blue + 3mm origin marker.
 *
 * No InstancedMesh batching yet (spec §8.5) — that's a W4 perf pass
 * with a 100-ref stress target. For Phase 2 W3 a model has on the
 * order of a few dozen refs and per-instance meshes are fine.
 */

import * as THREE from 'three';
import { computeResolvedNodes } from './evaluator';
import type {
  ReferenceNode,
  ResolvedAxis,
  ResolvedCsys,
  ResolvedPlane,
  ResolvedPoint,
  Vec3,
} from './types';

/** Default visual sizes (mm). Caller can override if they want a tighter
 *  viz for a small part. */
export interface VizSizing {
  readonly planeSizeMm: number;
  readonly axisHalfLengthMm: number;
  readonly pointRadiusMm: number;
  readonly csysAxisLengthMm: number;
  readonly csysOriginMm: number;
}

export const DEFAULT_SIZING: VizSizing = {
  planeSizeMm: 60,
  axisHalfLengthMm: 50,
  pointRadiusMm: 1,
  csysAxisLengthMm: 20,
  csysOriginMm: 3,
};

/** Build the full set of Object3Ds for a `ReferenceNode[]` snapshot.
 *
 *  Caller convention: mount the returned array as children of a single
 *  parent group (e.g. `<group name="reference-geometry">`); on the next
 *  render call this again and replace the group's children. */
export function buildReferenceMeshes(
  nodes: readonly ReferenceNode[],
  sizing: VizSizing = DEFAULT_SIZING,
): THREE.Object3D[] {
  if (nodes.length === 0) return [];
  const resolved = computeResolvedNodes(nodes);
  const out: THREE.Object3D[] = [];

  for (const node of nodes) {
    // Spec §8 — skip errored nodes.
    if (resolved.errors.has(node.id)) continue;
    if (node.hidden) continue;
    const value = resolved.values.get(node.id);
    if (value === undefined) continue;

    const color = hashColor(node.id);
    let obj: THREE.Object3D | null = null;

    switch (value.kind) {
      case 'plane':
        obj = buildPlaneObject(value.value, color, sizing);
        break;
      case 'axis':
        obj = buildAxisObject(value.value, color, sizing);
        break;
      case 'point':
        obj = buildPointObject(value.value, color, sizing);
        break;
      case 'csys':
        obj = buildCsysObject(value.value, sizing);
        break;
    }

    if (obj !== null) {
      obj.name = `refgeom:${node.kind}:${node.id}`;
      obj.userData = { ...obj.userData, referenceNodeId: node.id, kind: node.kind };
      out.push(obj);
    }
  }

  return out;
}

// ─── Per-kind builders ──────────────────────────────────────────

function buildPlaneObject(
  plane: ResolvedPlane,
  color: THREE.Color,
  sizing: VizSizing,
): THREE.Object3D {
  const group = new THREE.Group();
  const half = sizing.planeSizeMm / 2;

  // Tinted-glass fill quad — THREE.PlaneGeometry is in XY local, we
  // orient it via quaternion so its +Z aligns with the resolved normal.
  const fillGeom = new THREE.PlaneGeometry(sizing.planeSizeMm, sizing.planeSizeMm);
  const fillMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fill = new THREE.Mesh(fillGeom, fillMat);

  // Border — closed line loop around the quad in the same local frame.
  const borderGeom = new THREE.BufferGeometry();
  const v = new Float32Array([
    -half, -half, 0,
    half, -half, 0,
    half, half, 0,
    -half, half, 0,
    -half, -half, 0,
  ]);
  borderGeom.setAttribute('position', new THREE.BufferAttribute(v, 3));
  const borderMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
  });
  const border = new THREE.Line(borderGeom, borderMat);

  group.add(fill);
  group.add(border);

  // Position + orient.
  group.position.set(plane.origin[0], plane.origin[1], plane.origin[2]);
  orientToNormal(group, plane.normal);
  return group;
}

function buildAxisObject(
  axis: ResolvedAxis,
  color: THREE.Color,
  sizing: VizSizing,
): THREE.Object3D {
  const half = sizing.axisHalfLengthMm;
  const start: Vec3 = [
    axis.origin[0] - half * axis.direction[0],
    axis.origin[1] - half * axis.direction[1],
    axis.origin[2] - half * axis.direction[2],
  ];
  const end: Vec3 = [
    axis.origin[0] + half * axis.direction[0],
    axis.origin[1] + half * axis.direction[1],
    axis.origin[2] + half * axis.direction[2],
  ];
  const geom = new THREE.BufferGeometry();
  const v = new Float32Array([
    start[0], start[1], start[2],
    end[0], end[1], end[2],
  ]);
  geom.setAttribute('position', new THREE.BufferAttribute(v, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  return new THREE.Line(geom, mat);
}

function buildPointObject(
  point: ResolvedPoint,
  color: THREE.Color,
  sizing: VizSizing,
): THREE.Object3D {
  const geom = new THREE.SphereGeometry(sizing.pointRadiusMm, 12, 8);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(point.position[0], point.position[1], point.position[2]);
  return mesh;
}

function buildCsysObject(csys: ResolvedCsys, sizing: VizSizing): THREE.Object3D {
  const group = new THREE.Group();
  const len = sizing.csysAxisLengthMm;

  const arrowAxis = (
    dir: Vec3,
    col: number,
  ): THREE.Line => {
    const geom = new THREE.BufferGeometry();
    const v = new Float32Array([
      csys.origin[0], csys.origin[1], csys.origin[2],
      csys.origin[0] + len * dir[0],
      csys.origin[1] + len * dir[1],
      csys.origin[2] + len * dir[2],
    ]);
    geom.setAttribute('position', new THREE.BufferAttribute(v, 3));
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: col }));
  };

  group.add(arrowAxis(csys.xAxis, 0xff4040)); // X red
  group.add(arrowAxis(csys.yAxis, 0x40ff40)); // Y green
  group.add(arrowAxis(csys.zAxis, 0x4060ff)); // Z blue

  // Origin marker — small cube.
  const cubeGeom = new THREE.BoxGeometry(
    sizing.csysOriginMm,
    sizing.csysOriginMm,
    sizing.csysOriginMm,
  );
  const cubeMat = new THREE.MeshBasicMaterial({ color: 0xffd54f });
  const cube = new THREE.Mesh(cubeGeom, cubeMat);
  cube.position.set(csys.origin[0], csys.origin[1], csys.origin[2]);
  group.add(cube);

  return group;
}

// ─── Color hashing ──────────────────────────────────────────────

/** Deterministic id → HSL color. Visible against the typical NexyFab
 *  viewport background; the hash maps the id to a hue in `[0, 360)`. */
export function hashColor(id: string): THREE.Color {
  // Simple FNV-1a hash for stability across reloads.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = (h % 360) / 360;
  const c = new THREE.Color();
  c.setHSL(hue, 0.6, 0.55);
  return c;
}

// ─── Orientation ────────────────────────────────────────────────

/** Rotate `group` so its local +Z axis aligns with the world-space
 *  unit normal. THREE.PlaneGeometry's normal is +Z by default. */
function orientToNormal(group: THREE.Object3D, normal: Vec3): void {
  const target = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const up = new THREE.Vector3(0, 0, 1);
  // Quaternion that rotates `up` to `target`.
  const q = new THREE.Quaternion().setFromUnitVectors(up, target);
  group.quaternion.copy(q);
}
