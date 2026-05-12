/**
 * Assembly Mate Web Worker — runs the Gauss-Seidel mate solver off the main thread.
 *
 * Why: solveAssembly on a 50+ part assembly with dozens of mates can take
 * 100-500ms, freezing the UI. Moving it to a worker keeps the panel responsive
 * during a Solve click and unblocks real-time DOF/conflict feedback.
 *
 * Wire format: bodies/mates use plain `[x,y,z]` tuples instead of THREE
 * objects, since structured-clone of three Vector3 instances loses class info.
 * The hook serializes on send and deserializes on receive.
 */

import './ensureWorkerWindow';
import * as THREE from 'three';
import { solveAssembly, type AssemblyState, type AssemblyBody, type Mate, type MateSelection } from '../assembly/matesSolver';

// ─── Wire types (no THREE objects — structured-clone safe) ──────────────────

type Vec3Tuple = [number, number, number];

interface SerializedMateSelection {
  bodyIndex: number;
  type: MateSelection['type'];
  localPoint: Vec3Tuple;
  localNormal: Vec3Tuple;
  localAxis?: Vec3Tuple;
}

interface SerializedMate {
  id: string;
  type: Mate['type'];
  selections: [SerializedMateSelection, SerializedMateSelection];
  distance?: number;
  angle?: number;
  gearRatio?: number;
  enabled: boolean;
  conflict?: boolean;
}

interface SerializedAssemblyBody {
  name: string;
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  fixed: boolean;
  // Geometry intentionally omitted — solver does not read it.
}

export interface MateWorkerInput {
  bodies: SerializedAssemblyBody[];
  mates: SerializedMate[];
  maxIterations?: number;
}

export interface MateWorkerOutput {
  success: boolean;
  bodies?: { position: Vec3Tuple; rotation: Vec3Tuple }[];
  unsatisfied?: string[];
  conflicts?: string[];
  remainingDOF?: number;
  converged?: boolean;
  iterations?: number;
  error?: string;
}

// ─── Deserialize ────────────────────────────────────────────────────────────

function v3(t: Vec3Tuple): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2]);
}

function eulerFromTuple(t: Vec3Tuple): THREE.Euler {
  return new THREE.Euler(t[0], t[1], t[2]);
}

function deserializeBody(b: SerializedAssemblyBody): AssemblyBody {
  return {
    name: b.name,
    position: v3(b.position),
    rotation: eulerFromTuple(b.rotation),
    fixed: b.fixed,
  };
}

function deserializeSelection(s: SerializedMateSelection): MateSelection {
  return {
    bodyIndex: s.bodyIndex,
    type: s.type,
    localPoint: v3(s.localPoint),
    localNormal: v3(s.localNormal),
    localAxis: s.localAxis ? v3(s.localAxis) : undefined,
  };
}

function deserializeMate(m: SerializedMate): Mate {
  return {
    id: m.id,
    type: m.type,
    selections: [deserializeSelection(m.selections[0]), deserializeSelection(m.selections[1])],
    distance: m.distance,
    angle: m.angle,
    gearRatio: m.gearRatio,
    enabled: m.enabled,
    conflict: m.conflict,
  };
}

// ─── Serialize result ───────────────────────────────────────────────────────

function tupleFromV3(v: THREE.Vector3): Vec3Tuple {
  return [v.x, v.y, v.z];
}

function tupleFromEuler(e: THREE.Euler): Vec3Tuple {
  return [e.x, e.y, e.z];
}

// ─── Worker handler ─────────────────────────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.addEventListener('message', (event: MessageEvent<MateWorkerInput>) => {
  try {
    const { bodies, mates, maxIterations = 200 } = event.data;
    const state: AssemblyState = {
      bodies: bodies.map(deserializeBody),
      mates: mates.map(deserializeMate),
    };
    const r = solveAssembly(state, maxIterations);
    const output: MateWorkerOutput = {
      success: true,
      bodies: r.bodies.map(b => ({
        position: tupleFromV3(b.position),
        rotation: tupleFromEuler(b.rotation),
      })),
      unsatisfied: r.unsatisfied,
      conflicts: r.conflicts,
      remainingDOF: r.remainingDOF,
      converged: r.converged,
      iterations: r.iterations,
    };
    ctx.postMessage(output);
  } catch (err) {
    const output: MateWorkerOutput = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(output);
  }
});
