/**
 * jscadRunner.ts
 * Executes AI-generated @jscad/modeling code in the browser → THREE.BufferGeometry.
 *
 * Security: runs inside new Function() with only the jscad namespace exposed.
 * No DOM / window / fetch / require available inside the sandbox.
 */

import * as THREE from 'three';
import * as primitives from '@jscad/modeling/src/primitives';
import * as booleans from '@jscad/modeling/src/operations/booleans';
import * as transforms from '@jscad/modeling/src/operations/transforms';
import * as extrusions from '@jscad/modeling/src/operations/extrusions';
import * as expansions from '@jscad/modeling/src/operations/expansions';
import * as hulls from '@jscad/modeling/src/operations/hulls';
import * as measurements from '@jscad/modeling/src/measurements';
import { geom3 } from '@jscad/modeling/src/geometries';

const JSCAD_SANDBOX = {
  primitives,
  booleans,
  transforms,
  extrusions,
  expansions,
  hulls,
  measurements,
  Math,
};

export interface JscadRunResult {
  geometry: THREE.BufferGeometry;
  warnings: string[];
  triCount: number;
}

export function runJscadCode(code: string): JscadRunResult {
  const warnings: string[] = [];

  // Execute code in isolated sandbox
  let solid: any;
  try {
     
    const fn = new Function('jscad', 'Math', `"use strict";\n${code}\nreturn main();`);
    solid = fn(JSCAD_SANDBOX, Math);
  } catch (e: any) {
    throw new Error(`코드 실행 오류: ${e?.message ?? e}`);
  }

  if (!solid || typeof solid !== 'object') {
    throw new Error('main() 이 솔리드를 반환하지 않았습니다.');
  }

  const geometry = jscadSolidToThree(solid, warnings);
  return { geometry, warnings, triCount: geometry.attributes.position.count / 3 };
}

function jscadSolidToThree(solid: any, warnings: string[]): THREE.BufferGeometry {
  // Handle array of solids (union result)
  const solids: any[] = Array.isArray(solid) ? solid : [solid];

  // geom3.toPolygons() correctly applies the deferred transform matrix
  // Direct solid.polygons access SKIPS the transform — shapes would render at wrong position/orientation
  const allPolygons: any[] = [];
  for (const s of solids) {
    if (!s || typeof s !== 'object') continue;
    try {
      const polys = geom3.toPolygons(s);
      allPolygons.push(...polys);
    } catch {
      warnings.push('일부 솔리드를 폴리곤으로 변환하지 못했습니다.');
    }
  }

  if (allPolygons.length === 0) {
    warnings.push('생성된 폴리곤이 없습니다 — 빈 솔리드입니다.');
    return new THREE.BufferGeometry();
  }

  // Count total triangles first (fan triangulation: polygon with N verts → N-2 triangles)
  let triCount = 0;
  for (const poly of allPolygons) {
    const n = poly.vertices?.length ?? 0;
    if (n >= 3) triCount += n - 2;
  }

  // Pre-allocate typed arrays — much faster than dynamic push()
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let idx = 0;

  for (const poly of allPolygons) {
    const verts: any[] = poly.vertices;
    if (!verts || verts.length < 3) continue;

    // Fan triangulate convex polygon
    for (let i = 1; i < verts.length - 1; i++) {
      const v0 = verts[0];
      const v1 = verts[i];
      const v2 = verts[i + 1];

      // Safe coordinate extraction (handles both array [x,y,z] and {x,y,z} objects)
      const [x0, y0, z0] = extractVec3(v0);
      const [x1, y1, z1] = extractVec3(v1);
      const [x2, y2, z2] = extractVec3(v2);

      // Face normal via cross product
      const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
      const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const nnx = nx / len, nny = ny / len, nnz = nz / len;

      positions[idx]     = x0; positions[idx + 1] = y0; positions[idx + 2] = z0;
      positions[idx + 3] = x1; positions[idx + 4] = y1; positions[idx + 5] = z1;
      positions[idx + 6] = x2; positions[idx + 7] = y2; positions[idx + 8] = z2;
      normals[idx]     = nnx; normals[idx + 1] = nny; normals[idx + 2] = nnz;
      normals[idx + 3] = nnx; normals[idx + 4] = nny; normals[idx + 5] = nnz;
      normals[idx + 6] = nnx; normals[idx + 7] = nny; normals[idx + 8] = nnz;
      idx += 9;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, idx), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, idx), 3));
  geo.computeBoundingBox();
  return geo;
}

function extractVec3(v: any): [number, number, number] {
  if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  if (v && typeof v === 'object') return [v.x ?? v[0] ?? 0, v.y ?? v[1] ?? 0, v.z ?? v[2] ?? 0];
  return [0, 0, 0];
}
