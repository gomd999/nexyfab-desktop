/**
 * refPartsHarness — shared helpers for the reference-parts verification track
 * (docs/process/solidworks-parity-roadmap.md, 검증 트랙).
 *
 * Everything here is measurement / plumbing ONLY — the parts themselves are
 * built through the REAL production modules (applyFeaturePipelineDetailedAsync,
 * constraintSolver, nfabFormat, matesSolver, drawingExport, ...). No mocks.
 */
import * as THREE from 'three';
import type { FeatureInstance } from '../../features/types';
import { stampFaceFeatureIdAll } from '../../features/faceProvenance';
import type { HistoryNode, FeatureHistory } from '../../useFeatureStack';
import {
  serializeProject,
  toJsonString,
  parseProject,
  type NfabProjectV1,
} from '../../io/nfabFormat';
import type { SketchProfile, SketchSegment, SketchPoint } from '../../sketch/types';

// ─── Mesh measurements ───────────────────────────────────────────────────────

/** Signed tetra-sum volume (mm³). Same formula the sibling OCCT suites use. */
export function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  if (!pos) return 0;
  const idx = geo.index;
  let vol = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const triCount = idx ? idx.count : pos.count;
  const at = (i: number) => (idx ? idx.getX(i) : i);
  for (let i = 0; i < triCount; i += 3) {
    a.fromBufferAttribute(pos, at(i));
    b.fromBufferAttribute(pos, at(i + 1));
    c.fromBufferAttribute(pos, at(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

export interface ManifoldReport {
  /** Edges referenced by exactly two triangles (quantized positions). */
  manifoldEdges: number;
  /** Edges referenced once — open boundary (NOT watertight). */
  boundaryEdges: number;
  /** Edges referenced 3+ times — non-manifold fans / internal walls. */
  overusedEdges: number;
  watertight: boolean;
}

/**
 * Position-quantized edge-use census. OCCT tessellation duplicates vertices
 * per face, so identity must come from rounded coordinates, not indices.
 */
export function manifoldReport(geo: THREE.BufferGeometry, quant = 1e-3): ManifoldReport {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count : pos.count;
  const at = (i: number) => (idx ? idx.getX(i) : i);
  const q = (v: number) => Math.round(v / quant);
  const keyOf = (i: number) => `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < triCount; i += 3) {
    const k = [keyOf(at(i)), keyOf(at(i + 1)), keyOf(at(i + 2))];
    for (let e = 0; e < 3; e++) {
      const a = k[e], b = k[(e + 1) % 3];
      if (a === b) continue; // degenerate sliver
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(ek, (edges.get(ek) ?? 0) + 1);
    }
  }
  let manifoldEdges = 0, boundaryEdges = 0, overusedEdges = 0;
  for (const n of edges.values()) {
    if (n === 2) manifoldEdges++;
    else if (n === 1) boundaryEdges++;
    else overusedEdges++;
  }
  return { manifoldEdges, boundaryEdges, overusedEdges, watertight: boundaryEdges === 0 };
}

// ─── Base geometry builders ──────────────────────────────────────────────────

/**
 * Empty-but-attribute-complete "blank document" base for sketch-first parts.
 *
 * runSketchExtrude merges the base with an ExtrudeGeometry tool that carries
 * {position, uv, normal, nfabFaceFeatureId} (the provenance stamp). three's
 * mergeGeometries hard-fails on ANY attribute-set difference, so the empty
 * base must declare the exact same four attributes (non-indexed). A plain
 * `new BufferGeometry()` — or the default BoxGeometry base shape — does NOT
 * satisfy this; see the P1/P3 findings.
 */
export function emptySketchBase(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
  g.setAttribute('nfabFaceFeatureId', new THREE.BufferAttribute(new Uint32Array(0), 1));
  return g;
}

/** Production box base (BoxGeometry, like shapes/box.ts) with the face-
 *  provenance attribute pre-stamped so CSG features can run as feature #1. */
export function stampedBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.computeVertexNormals();
  stampFaceFeatureIdAll(g, 'base');
  return g;
}

// ─── Sketch profile builders ─────────────────────────────────────────────────

/** Closed polyline profile from ordered points (with stable point ids). */
export function polylineProfile(pts: SketchPoint[], idPrefix = 'p'): SketchProfile {
  const withIds = pts.map((p, i) => ({ ...p, id: p.id ?? `${idPrefix}${i}` }));
  const segments: SketchSegment[] = [];
  for (let i = 0; i < withIds.length; i++) {
    const a = withIds[i];
    const b = withIds[(i + 1) % withIds.length];
    segments.push({ type: 'line', id: `${idPrefix}l${i}`, points: [a, b] });
  }
  return { segments, closed: true };
}

/** Single-circle profile (center + rim point) — the exact-cylinder B-rep path. */
export function circleProfile(cx: number, cy: number, r: number, id = 'c0'): SketchProfile {
  return {
    segments: [{ type: 'circle', id, points: [{ x: cx, y: cy, id: `${id}_c` }, { x: cx + r, y: cy, id: `${id}_e` }] }],
    closed: true,
  };
}

/** Single-rect profile (two corners) — brepContourPoints rect path. */
export function rectProfile(x0: number, y0: number, x1: number, y1: number, id = 'r0'): SketchProfile {
  return {
    segments: [{ type: 'rect', id, points: [{ x: x0, y: y0, id: `${id}_a` }, { x: x1, y: y1, id: `${id}_b` }] }],
    closed: true,
  };
}

/** Default SketchConfig for an extrude — mirrors the UI defaults. */
export function extrudeConfig(depth: number) {
  return {
    mode: 'extrude' as const,
    depth,
    revolveAngle: 360,
    revolveAxis: 'y' as const,
    segments: 32,
  };
}

// ─── .nfab round-trip through the real serializer ────────────────────────────

/** Wrap a FeatureInstance list into the HistoryNode tree the app persists. */
export function featuresToHistory(features: FeatureInstance[]): FeatureHistory {
  const rootId = 'root';
  const nodes: HistoryNode[] = [
    {
      id: rootId,
      type: 'baseShape',
      label: 'Base Shape',
      icon: '📦',
      params: {},
      enabled: true,
      expanded: true,
      parentId: null,
      children: features.length > 0 ? [features[0].id] : [],
      editingActive: false,
      timestamp: 1,
    },
  ];
  features.forEach((f, i) => {
    nodes.push({
      id: f.id,
      type: 'feature',
      label: `${f.type} ${i + 1}`,
      icon: '🔧',
      featureType: f.type,
      params: { ...f.params },
      enabled: f.enabled,
      expanded: true,
      parentId: i === 0 ? rootId : features[i - 1].id,
      children: i + 1 < features.length ? [features[i + 1].id] : [],
      editingActive: false,
      timestamp: i + 2,
      ...(f.sketchData ? { sketchData: f.sketchData } : {}),
      ...(f.edgeSelections ? { edgeSelections: f.edgeSelections } : {}),
      ...(f.faceSelections ? { faceSelections: f.faceSelections } : {}),
    });
  });
  return {
    nodes,
    rootId,
    activeNodeId: features.length > 0 ? features[features.length - 1].id : rootId,
    editingNodeId: null,
  };
}

/** Minimal-but-valid scene block (what the studio always persists). */
export function minimalScene(): NfabProjectV1['scene'] {
  return {
    selectedId: 'box',
    params: {},
    paramExpressions: {},
    materialId: 'aluminum',
    color: '#cccccc',
    isSketchMode: false,
    sketchPlane: 'xy',
    sketchProfile: { segments: [], closed: false },
    sketchConfig: extrudeConfig(50),
  };
}

/** Mirror of useFeatureStack's featuresCompat node → FeatureInstance mapping. */
export function historyToFeatures(project: NfabProjectV1): FeatureInstance[] {
  return project.tree.nodes
    .filter(n => n.type === 'feature' && n.featureType && n.enabled)
    .map(n => ({
      id: n.id,
      type: n.featureType!,
      params: { ...n.params },
      enabled: n.enabled,
      sketchData: n.sketchData,
      edgeSelections: n.edgeSelections,
      faceSelections: n.faceSelections,
    }));
}

/**
 * Serialize → JSON string → parse (with migration/validation) → features.
 * This is the byte-level persistence path a real save/open goes through.
 */
export function nfabRoundTrip(features: FeatureInstance[], name: string): {
  project: NfabProjectV1;
  features: FeatureInstance[];
  jsonBytes: number;
} {
  const project = serializeProject({
    name,
    history: featuresToHistory(features),
    scene: minimalScene(),
  });
  const json = toJsonString(project, false);
  const reparsed = parseProject(json);
  return { project: reparsed, features: historyToFeatures(reparsed), jsonBytes: json.length };
}

// ─── Findings log ────────────────────────────────────────────────────────────

export interface Finding {
  part: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
  title: string;
  detail: string;
}

const FINDINGS: Finding[] = [];

export function recordFinding(f: Finding): void {
  FINDINGS.push(f);
  // Findings double as the deliverable — emit them into the test log so a
  // CI run shows the full list without digging into expect messages.
  console.log(`[REF-PART FINDING][${f.severity}][${f.part}] ${f.title} — ${f.detail}`);
}

export function getFindings(): readonly Finding[] {
  return FINDINGS;
}
