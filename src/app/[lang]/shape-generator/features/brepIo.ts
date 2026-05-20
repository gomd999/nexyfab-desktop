/**
 * brepIo.ts — Serialize / deserialize half-edge B-rep to a flat JSON
 * format suitable for autosave, undo snapshots, and project export.
 *
 * The half-edge structure is heavily cyclic (every HalfEdge holds
 * references to twin/next/prev/face/origin), which means it can't
 * be passed directly to `JSON.stringify` — it would loop forever.
 * This module flattens the object graph into id-keyed dictionaries,
 * then reconstructs the references on import.
 *
 * Schema (versioned):
 *   {
 *     version: 1,
 *     shells: [
 *       {
 *         isOuter: bool,
 *         vertices: [{ id, x, y, z }],
 *         halfEdges: [{ id, origin, twin, next, prev, face }],
 *         faces: [{ id, outerLoop, innerLoops, surfaceKind?, normal? }]
 *       }
 *     ]
 *   }
 *
 * Failure modes (returned in ImportReport):
 *   - missing references (dangling ids)
 *   - schema version mismatch
 *   - face loops that don't close
 *   - twin asymmetry
 */

import type { BrepModel, BrepShell, Face, HalfEdge, Vertex, Vec3 } from './halfEdgeBrep';
import { BrepModel as BrepModelCtor, validateShell } from './halfEdgeBrep';

export const BREP_IO_VERSION = 1;

export interface BrepIoSchema {
  version: number;
  shells: ShellSchema[];
}

export interface ShellSchema {
  isOuter: boolean;
  vertices: VertexSchema[];
  halfEdges: HalfEdgeSchema[];
  faces: FaceSchema[];
}

export interface VertexSchema {
  id: string;
  x: number;
  y: number;
  z: number;
  outgoing: string | null;
}

export interface HalfEdgeSchema {
  id: string;
  origin: string;
  twin: string | null;
  next: string | null;
  prev: string | null;
  face: string | null;
}

export interface FaceSchema {
  id: string;
  outerLoop: string | null;
  innerLoops: string[];
  surfaceKind?: Face['surfaceKind'];
  normal?: Vec3;
}

export interface ImportReport {
  success: boolean;
  shellCount: number;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  /** Dangling id references encountered during deserialization. */
  danglingReferences: string[];
  /** Validation issues from validateShell after import. */
  validationIssues: string[];
}

// ── Export ──────────────────────────────────────────────────────

export function exportBrep(model: BrepModel): BrepIoSchema {
  return {
    version: BREP_IO_VERSION,
    shells: model.shells.map(exportShell),
  };
}

function exportShell(shell: BrepShell): ShellSchema {
  const vertices: VertexSchema[] = [];
  for (const v of shell.vertices.values()) {
    vertices.push({
      id: v.id,
      x: v.position[0],
      y: v.position[1],
      z: v.position[2],
      outgoing: v.outgoing?.id ?? null,
    });
  }
  const halfEdges: HalfEdgeSchema[] = [];
  for (const he of shell.halfEdges.values()) {
    halfEdges.push({
      id: he.id,
      origin: he.origin.id,
      twin: he.twin?.id ?? null,
      next: he.next?.id ?? null,
      prev: he.prev?.id ?? null,
      face: he.face?.id ?? null,
    });
  }
  const faces: FaceSchema[] = [];
  for (const f of shell.faces.values()) {
    const out: FaceSchema = {
      id: f.id,
      outerLoop: f.outerLoop?.id ?? null,
      innerLoops: f.innerLoops.map(he => he.id),
    };
    if (f.surfaceKind) out.surfaceKind = f.surfaceKind;
    if (f.normal) out.normal = [f.normal[0], f.normal[1], f.normal[2]];
    faces.push(out);
  }
  return { isOuter: shell.isOuter, vertices, halfEdges, faces };
}

// ── Import ──────────────────────────────────────────────────────

export function importBrep(schema: BrepIoSchema): { model: BrepModel; report: ImportReport } {
  const report: ImportReport = {
    success: false,
    shellCount: 0,
    vertexCount: 0,
    edgeCount: 0,
    faceCount: 0,
    danglingReferences: [],
    validationIssues: [],
  };

  if (schema.version !== BREP_IO_VERSION) {
    report.validationIssues.push(`Schema version ${schema.version} unsupported (expected ${BREP_IO_VERSION})`);
    return { model: new BrepModelCtor(), report };
  }

  const model = new BrepModelCtor();
  // The constructor pushes a default shell for shells.length === 0; reset.
  model.shells = [];

  for (const shellSchema of schema.shells) {
    const shell: BrepShell = {
      vertices: new Map(),
      halfEdges: new Map(),
      faces: new Map(),
      isOuter: shellSchema.isOuter,
    };
    model.shells.push(shell);

    // Pass 1 — create vertices.
    for (const vs of shellSchema.vertices) {
      const v: Vertex = {
        id: vs.id,
        position: [vs.x, vs.y, vs.z],
        outgoing: null,
      };
      shell.vertices.set(vs.id, v);
    }
    // Pass 2 — create half-edges (no links yet).
    for (const hes of shellSchema.halfEdges) {
      const origin = shell.vertices.get(hes.origin);
      if (!origin) {
        report.danglingReferences.push(`HE ${hes.id} origin → ${hes.origin}`);
        continue;
      }
      const he: HalfEdge = {
        id: hes.id, origin, twin: null, next: null, prev: null, face: null,
      };
      shell.halfEdges.set(hes.id, he);
    }
    // Pass 3 — create faces (no half-edge links yet).
    for (const fs of shellSchema.faces) {
      const f: Face = {
        id: fs.id,
        outerLoop: null,
        innerLoops: [],
      };
      if (fs.surfaceKind) f.surfaceKind = fs.surfaceKind;
      if (fs.normal) f.normal = fs.normal;
      shell.faces.set(fs.id, f);
    }
    // Pass 4 — wire up half-edge links + face → outerLoop + vertex.outgoing.
    for (const hes of shellSchema.halfEdges) {
      const he = shell.halfEdges.get(hes.id);
      if (!he) continue;
      if (hes.twin) {
        const t = shell.halfEdges.get(hes.twin);
        if (t) he.twin = t;
        else report.danglingReferences.push(`HE ${hes.id} twin → ${hes.twin}`);
      }
      if (hes.next) {
        const n = shell.halfEdges.get(hes.next);
        if (n) he.next = n;
        else report.danglingReferences.push(`HE ${hes.id} next → ${hes.next}`);
      }
      if (hes.prev) {
        const p = shell.halfEdges.get(hes.prev);
        if (p) he.prev = p;
        else report.danglingReferences.push(`HE ${hes.id} prev → ${hes.prev}`);
      }
      if (hes.face) {
        const f = shell.faces.get(hes.face);
        if (f) he.face = f;
        else report.danglingReferences.push(`HE ${hes.id} face → ${hes.face}`);
      }
    }
    for (const vs of shellSchema.vertices) {
      if (vs.outgoing) {
        const v = shell.vertices.get(vs.id);
        const he = shell.halfEdges.get(vs.outgoing);
        if (v && he) v.outgoing = he;
        else if (v) report.danglingReferences.push(`V ${vs.id} outgoing → ${vs.outgoing}`);
      }
    }
    for (const fs of shellSchema.faces) {
      const f = shell.faces.get(fs.id);
      if (!f) continue;
      if (fs.outerLoop) {
        const he = shell.halfEdges.get(fs.outerLoop);
        if (he) f.outerLoop = he;
        else report.danglingReferences.push(`F ${fs.id} outerLoop → ${fs.outerLoop}`);
      }
      for (const innerId of fs.innerLoops) {
        const he = shell.halfEdges.get(innerId);
        if (he) f.innerLoops.push(he);
        else report.danglingReferences.push(`F ${fs.id} innerLoop → ${innerId}`);
      }
    }

    report.shellCount += 1;
    report.vertexCount += shell.vertices.size;
    report.edgeCount += shell.halfEdges.size / 2;
    report.faceCount += shell.faces.size;

    const vReport = validateShell(shell);
    if (!vReport.valid) report.validationIssues.push(...vReport.issues);
  }

  // Success = no dangling references. Validation issues are advisory
  // (e.g. legitimate open shells imported from a partial sketch).
  report.success = report.danglingReferences.length === 0;
  return { model, report };
}

// ── Round-trip helper ───────────────────────────────────────────

export function roundTrip(model: BrepModel): { model: BrepModel; report: ImportReport; schema: BrepIoSchema } {
  const schema = exportBrep(model);
  const { model: imported, report } = importBrep(schema);
  return { model: imported, report, schema };
}

// ── JSON helpers ────────────────────────────────────────────────

export function exportBrepJson(model: BrepModel): string {
  return JSON.stringify(exportBrep(model));
}

export function importBrepJson(json: string): { model: BrepModel; report: ImportReport } {
  const parsed = JSON.parse(json) as BrepIoSchema;
  return importBrep(parsed);
}

// ── Diff (for incremental autosave) ─────────────────────────────

export interface BrepDiff {
  /** Vertex ids added in B relative to A. */
  verticesAdded: string[];
  /** Vertex ids removed. */
  verticesRemoved: string[];
  /** Vertex ids whose position changed. */
  verticesMoved: string[];
  /** Face ids added. */
  facesAdded: string[];
  /** Face ids removed. */
  facesRemoved: string[];
  edgesAddedCount: number;
  edgesRemovedCount: number;
}

export function diff(a: BrepIoSchema, b: BrepIoSchema): BrepDiff {
  const aVerts = new Map<string, VertexSchema>();
  const bVerts = new Map<string, VertexSchema>();
  for (const s of a.shells) for (const v of s.vertices) aVerts.set(v.id, v);
  for (const s of b.shells) for (const v of s.vertices) bVerts.set(v.id, v);

  const verticesAdded: string[] = [];
  const verticesRemoved: string[] = [];
  const verticesMoved: string[] = [];

  for (const [id, v] of bVerts) {
    if (!aVerts.has(id)) verticesAdded.push(id);
    else {
      const va = aVerts.get(id)!;
      if (va.x !== v.x || va.y !== v.y || va.z !== v.z) verticesMoved.push(id);
    }
  }
  for (const id of aVerts.keys()) {
    if (!bVerts.has(id)) verticesRemoved.push(id);
  }

  const aFaces = new Set<string>();
  const bFaces = new Set<string>();
  for (const s of a.shells) for (const f of s.faces) aFaces.add(f.id);
  for (const s of b.shells) for (const f of s.faces) bFaces.add(f.id);
  const facesAdded = [...bFaces].filter(id => !aFaces.has(id));
  const facesRemoved = [...aFaces].filter(id => !bFaces.has(id));

  const aEdgeCount = a.shells.reduce((s, sh) => s + sh.halfEdges.length, 0) / 2;
  const bEdgeCount = b.shells.reduce((s, sh) => s + sh.halfEdges.length, 0) / 2;

  return {
    verticesAdded,
    verticesRemoved,
    verticesMoved,
    facesAdded,
    facesRemoved,
    edgesAddedCount: Math.max(0, bEdgeCount - aEdgeCount),
    edgesRemovedCount: Math.max(0, aEdgeCount - bEdgeCount),
  };
}
