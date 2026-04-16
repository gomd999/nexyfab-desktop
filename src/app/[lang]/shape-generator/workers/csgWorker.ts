/**
 * CSG Web Worker — performs boolean operations off the main thread.
 *
 * Receives serialized geometry data (positions, normals, indices) as transferable
 * ArrayBuffers, reconstructs BufferGeometry objects, runs the boolean evaluation
 * via three-bvh-csg, then serialises the result back.
 */

import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

// ─── Message types ──────────────────────────────────────────────────────────

export interface CSGWorkerInput {
  type: 'union' | 'subtract' | 'intersect';
  meshA: { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
  meshB: { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
}

export interface CSGWorkerOutput {
  success: boolean;
  positions?: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildGeometry(data: {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geo;
}

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

// ─── Worker message handler ─────────────────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.addEventListener('message', (event: MessageEvent<CSGWorkerInput>) => {
  try {
    const { type, meshA, meshB } = event.data;

    const geoA = buildGeometry(meshA);
    const geoB = buildGeometry(meshB);

    const evaluator = new Evaluator();
    const brushA = makeBrush(geoA);
    const brushB = makeBrush(geoB);

    let operation: number;
    switch (type) {
      case 'subtract':
        operation = SUBTRACTION;
        break;
      case 'intersect':
        operation = INTERSECTION;
        break;
      default:
        operation = ADDITION;
        break;
    }

    const result: Brush = evaluator.evaluate(brushA, brushB, operation);
    const resultGeo = result.geometry;

    // Ensure normals exist
    if (!resultGeo.attributes.normal) {
      resultGeo.computeVertexNormals();
    }

    // Extract raw typed arrays
    const positions = new Float32Array(
      (resultGeo.attributes.position as THREE.BufferAttribute).array,
    );
    const normals = new Float32Array(
      (resultGeo.attributes.normal as THREE.BufferAttribute).array,
    );

    let indices: Uint32Array;
    if (resultGeo.index) {
      indices = new Uint32Array(resultGeo.index.array);
    } else {
      // Non-indexed geometry — create trivial index
      indices = new Uint32Array(positions.length / 3);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
    }

    const output: CSGWorkerOutput = { success: true, positions, normals, indices };

    // Transfer the underlying buffers (zero-copy)
    ctx.postMessage(output, [
      positions.buffer,
      normals.buffer,
      indices.buffer,
    ] as unknown as Transferable[]);
  } catch (err) {
    const output: CSGWorkerOutput = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(output);
  }
});
