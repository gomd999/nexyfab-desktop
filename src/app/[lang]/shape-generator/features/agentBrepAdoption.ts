/**
 * agentBrepAdoption — preserve B-rep lineage when an agent result is adopted
 * into the modeler.
 *
 * The SCAD agent builds exact B-rep in the SERVER's replicad registry; the
 * browser only receives a tessellated mesh (see the brep-mesh endpoint). If we
 * dropped that mesh into the scene as a plain body it would be a dead end — no
 * way back to the precise B-rep the agent built. So on adoption we stamp the
 * geometry with the server handle as provenance. Two payoffs:
 *
 *   1. Lossless STEP export — the adopted body can be exported through the live
 *      server handle (`/api/nexyfab/scad-agent/brep-step`) instead of re-meshing
 *      the browser triangles, so manufacturing CAD gets the real B-rep.
 *   2. Forward path — when the browser B-rep kernel (K-series) lands, these
 *      tagged bodies can be re-imported via STEP into a live browser handle and
 *      become fully parametric, no user re-work.
 *
 * Pure + headless: just reads/writes `geometry.userData`. The fetch/import wiring
 * lives at the call site (ShapeGeneratorInner).
 */

import type * as THREE from 'three';

export interface BrepProvenance {
  /** Where the body came from. Today only the SCAD agent. */
  source: 'scad-agent';
  /** The server-side replicad registry handle — still live for the session, so
   *  STEP export through it is lossless. */
  serverHandle: string;
}

const KEY = 'brepProvenance';

/**
 * Stamp the agent B-rep server handle onto an adopted geometry so the modeler
 * knows it's B-rep-backed (not a hand-built mesh). Idempotent; a falsy handle is
 * a no-op so call sites don't need to guard.
 */
export function tagBrepProvenance(geometry: THREE.BufferGeometry, serverHandle: string | null | undefined): void {
  if (!serverHandle) return;
  const prov: BrepProvenance = { source: 'scad-agent', serverHandle };
  geometry.userData[KEY] = prov;
}

/** Read back the B-rep provenance, or null when the body wasn't adopted from an
 *  agent B-rep (a plain sketch / imported mesh). */
export function readBrepProvenance(geometry: THREE.BufferGeometry): BrepProvenance | null {
  const p = geometry.userData[KEY] as BrepProvenance | undefined;
  return p && p.source === 'scad-agent' && typeof p.serverHandle === 'string' ? p : null;
}

/** True when this body can be STEP-exported losslessly through its live server
 *  handle (vs re-meshing the browser triangles). */
export function canExportStepViaServerHandle(geometry: THREE.BufferGeometry): boolean {
  return readBrepProvenance(geometry) !== null;
}

/** The brep-step endpoint URL for a provenance handle. Centralised so the call
 *  site and any test agree on the contract. */
export function brepStepEndpoint(prov: BrepProvenance): string {
  return `/api/nexyfab/scad-agent/brep-step?handle=${encodeURIComponent(prov.serverHandle)}`;
}
