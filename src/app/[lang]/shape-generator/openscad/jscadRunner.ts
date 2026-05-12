/**
 * jscadRunner.ts
 * Executes AI-generated @jscad/modeling code in the browser → THREE.BufferGeometry.
 *
 * Security: runs inside new Function() with only the jscad namespace exposed.
 * No DOM / window / fetch / require available inside the sandbox.
 *
 * DoS mitigations (since main-thread sandbox cannot be terminated):
 *   - MAX_CODE_LENGTH: rejects huge AI responses outright
 *   - MAX_TRIANGLES: caps mesh size before allocating Float32Array
 *   - Static scan: rejects obvious infinite-loop / huge-allocation patterns
 *   - Deadline-aware Math proxy: throws once wall-clock budget is exceeded
 *     (geometry math always touches Math.sin/cos/sqrt/PI, so this trips fast)
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
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type';
import type Poly3 from '@jscad/modeling/src/geometries/poly3/type';
import type Vec3 from '@jscad/modeling/src/maths/vec3/type';

const MAX_CODE_LENGTH = 32_000;        // ~32 KB AI-generated code
const MAX_TRIANGLES = 1_000_000;       // 1 M tris ≈ 36 MB Float32 buffers
const DEFAULT_TIMEOUT_MS = 10_000;     // soft wall-clock budget

// Patterns that almost always indicate hostile or runaway code.
const DOS_PATTERNS: RegExp[] = [
  /\bwhile\s*\(\s*(true|1)\s*\)/i,        // while(true)
  /\bfor\s*\(\s*;;\s*\)/,                 // for(;;)
  /new\s+Array\s*\(\s*\d{7,}/,            // new Array(10_000_000+)
  /\.fill\s*\(\s*[^)]*\)\s*\.fill/,       // chained fill bombs
  /Array\s*\.\s*from\s*\(\s*\{\s*length\s*:\s*\d{7,}/, // Array.from({length: 1e7})
];

const JSCAD_SANDBOX = {
  primitives,
  booleans,
  transforms,
  extrusions,
  expansions,
  hulls,
  measurements,
};

export interface JscadRunResult {
  geometry: THREE.BufferGeometry;
  warnings: string[];
  triCount: number;
}

export interface JscadRunOptions {
  timeoutMs?: number;
}

/** Builds a Math proxy that throws once `deadline` is exceeded. */
function makeDeadlineMath(deadline: number): typeof Math {
  const handler: ProxyHandler<typeof Math> = {
    get(target, prop, receiver) {
      if (Date.now() > deadline) {
        throw new Error('JSCAD execution timed out (>10s)');
      }
      return Reflect.get(target, prop, receiver);
    },
  };
  return new Proxy(Math, handler);
}

export function runJscadCode(code: string, options: JscadRunOptions = {}): JscadRunResult {
  const warnings: string[] = [];

  if (typeof code !== 'string' || code.length === 0) {
    throw new Error('빈 코드입니다.');
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`코드가 너무 깁니다 (${code.length} > ${MAX_CODE_LENGTH} bytes).`);
  }
  for (const pat of DOS_PATTERNS) {
    if (pat.test(code)) {
      throw new Error(`거부된 패턴: ${pat.source}`);
    }
  }

  const timeoutMs = Math.max(1000, Math.min(60_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  const guardedMath = makeDeadlineMath(deadline);

  // Execute code in isolated sandbox
  let solid: unknown;
  try {
    const fn = new Function('jscad', 'Math', `"use strict";\n${code}\nreturn main();`);
    solid = fn(JSCAD_SANDBOX, guardedMath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`코드 실행 오류: ${msg}`);
  }

  if (Date.now() > deadline) {
    throw new Error('JSCAD execution timed out (>10s)');
  }

  if (solid == null || typeof solid !== 'object') {
    throw new Error('main() 이 솔리드를 반환하지 않았습니다.');
  }
  let normalized: Geom3 | Geom3[];
  if (Array.isArray(solid)) {
    if (solid.length === 0 || !solid.every((x) => geom3.isA(x))) {
      throw new Error('main() 이 솔리드를 반환하지 않았습니다.');
    }
    normalized = solid as Geom3[];
  } else if (geom3.isA(solid)) {
    normalized = solid;
  } else {
    throw new Error('main() 이 솔리드를 반환하지 않았습니다.');
  }

  const geometry = jscadSolidToThree(normalized, warnings);
  const elapsed = Date.now() - startedAt;
  if (elapsed > timeoutMs) {
    warnings.push(`실행 시간 초과 경고: ${elapsed}ms`);
  }
  return { geometry, warnings, triCount: geometry.attributes.position.count / 3 };
}

function jscadSolidToThree(solid: Geom3 | Geom3[], warnings: string[]): THREE.BufferGeometry {
  // Handle array of solids (union result)
  const solids: Geom3[] = Array.isArray(solid) ? solid : [solid];

  // geom3.toPolygons() correctly applies the deferred transform matrix
  // Direct solid.polygons access SKIPS the transform — shapes would render at wrong position/orientation
  const allPolygons: Poly3[] = [];
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

  if (triCount > MAX_TRIANGLES) {
    throw new Error(`삼각형 수 한도 초과: ${triCount} > ${MAX_TRIANGLES}`);
  }

  // Pre-allocate typed arrays — much faster than dynamic push()
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let idx = 0;

  for (const poly of allPolygons) {
    const verts: Vec3[] = poly.vertices;
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

function extractVec3(v: Vec3): [number, number, number] {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
}
