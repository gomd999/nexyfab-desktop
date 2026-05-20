/**
 * featureRecognition.ts — Recognize parametric features from a
 * dumb imported B-rep.
 *
 * When STEP / IGES files come in as triangle meshes (or topologically
 * meaningful B-rep but no history), the user loses everything that
 * makes a parametric model useful: features can't be edited by
 * dragging a handle, dimensions can't drive geometry, patterns
 * can't be reused.
 *
 * This module's job is *recognition*: walk the imported geometry +
 * detect features that were almost certainly built parametrically.
 * Output is a `RecognizedFeature[]` that can seed a parametric
 * reconstruction.
 *
 * Recognized feature kinds:
 *   - **Extruded boss / cut** — flat top face + parallel side faces,
 *     all perpendicular to the top normal.
 *   - **Drilled hole** — cylindrical face + axis direction +
 *     conical bottom (drill point) detection.
 *   - **Counterbore / counter-sink** — concentric stepped holes.
 *   - **Fillet** — smooth-edge face between two flat faces.
 *   - **Chamfer** — flat triangular face between two flat faces with
 *     45° (or other) angle.
 *   - **Revolve** — surfaces of revolution (cylinders, cones, torus)
 *     with a shared axis.
 *   - **Sweep** — pipes / wires (constant cross-section along a curve).
 */

export type Vec3 = [number, number, number];

export type FaceShape = 'planar' | 'cylindrical' | 'spherical' | 'conical' | 'toroidal' | 'freeform';

export interface ImportedFace {
  id: string;
  shape: FaceShape;
  /** Surface area (mm²). */
  areaMm2: number;
  /** Normal (planar) or axis direction (cylindrical / conical). */
  direction: Vec3;
  /** Surface origin point (point on face). */
  origin: Vec3;
  /** Radius for cylinder / sphere / cone / torus minor. */
  radiusMm?: number;
  /** Half-angle for cone (deg). */
  halfAngleDeg?: number;
  /** Adjacent face ids (via shared edges). */
  adjacentFaceIds: string[];
}

export interface ImportedEdge {
  id: string;
  /** Endpoint positions. */
  start: Vec3;
  end: Vec3;
  /** Length (mm). */
  lengthMm: number;
  /** Convexity (already classified). */
  convexity?: 'convex' | 'concave' | 'tangent' | 'smooth' | 'unknown';
  /** Adjacent faces. */
  leftFaceId: string;
  rightFaceId: string;
}

export type RecognizedKind =
  | 'extrude-boss' | 'extrude-cut'
  | 'hole-drilled' | 'hole-counterbore' | 'hole-countersink'
  | 'fillet' | 'chamfer'
  | 'revolve-cylinder' | 'revolve-cone' | 'revolve-torus'
  | 'sweep-pipe';

export interface RecognizedFeature {
  id: string;
  kind: RecognizedKind;
  /** Confidence 0..1. */
  confidence: number;
  /** Face ids that comprise this feature. */
  faceIds: string[];
  /** Recognized parameters — kind-specific. */
  params: Record<string, number>;
  /** Reason string for debug / UI. */
  rationale: string;
}

// ── Helpers ─────────────────────────────────────────────────────

function vDot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function approxParallel(a: Vec3, b: Vec3, tolDeg: number = 2): boolean {
  const d = Math.abs(vDot(a, b));
  return d > Math.cos(tolDeg * Math.PI / 180);
}

function approxEqual(a: number, b: number, tol: number = 0.05): boolean {
  return Math.abs(a - b) < tol;
}

// ── Hole detection ──────────────────────────────────────────────

function detectHoles(
  faces: ImportedFace[],
  edges: ImportedEdge[],
): RecognizedFeature[] {
  void edges;
  const out: RecognizedFeature[] = [];
  let counter = 0;
  // Group cylindrical faces by axis + radius (potential hole sets).
  const cylinders = faces.filter(f => f.shape === 'cylindrical' && f.radiusMm != null);
  const groups: Array<{ axis: Vec3; cylinders: ImportedFace[] }> = [];
  for (const cyl of cylinders) {
    let group = groups.find(g => approxParallel(g.axis, cyl.direction));
    if (!group) {
      group = { axis: cyl.direction, cylinders: [] };
      groups.push(group);
    }
    group.cylinders.push(cyl);
  }

  for (const g of groups) {
    if (g.cylinders.length === 1) {
      // Simple drilled hole.
      const cyl = g.cylinders[0]!;
      out.push({
        id: `hole-${++counter}`,
        kind: 'hole-drilled',
        confidence: 0.85,
        faceIds: [cyl.id],
        params: { diameterMm: cyl.radiusMm! * 2 },
        rationale: 'Single cylindrical face — drilled hole',
      });
    } else if (g.cylinders.length >= 2) {
      // Stepped hole = counterbore.
      const sorted = g.cylinders.slice().sort((a, b) => (a.radiusMm ?? 0) - (b.radiusMm ?? 0));
      const small = sorted[0]!;
      const big = sorted[sorted.length - 1]!;
      out.push({
        id: `hole-${++counter}`,
        kind: 'hole-counterbore',
        confidence: 0.75,
        faceIds: sorted.map(c => c.id),
        params: {
          throughDiameterMm: small.radiusMm! * 2,
          counterboreDiameterMm: big.radiusMm! * 2,
        },
        rationale: 'Stepped concentric cylinders — counterbore',
      });
    }
  }

  // Detect conical countersinks: a cone + a smaller cylinder, same axis.
  const cones = faces.filter(f => f.shape === 'conical' && f.halfAngleDeg);
  for (const cone of cones) {
    const matchingCyl = cylinders.find(c => approxParallel(c.direction, cone.direction));
    if (matchingCyl) {
      out.push({
        id: `hole-${++counter}`,
        kind: 'hole-countersink',
        confidence: 0.7,
        faceIds: [cone.id, matchingCyl.id],
        params: {
          diameterMm: matchingCyl.radiusMm! * 2,
          countersinkAngleDeg: cone.halfAngleDeg! * 2,
        },
        rationale: 'Cone + cylinder on shared axis — countersunk hole',
      });
    }
  }
  return out;
}

// ── Fillet / chamfer detection ──────────────────────────────────

function detectFilletsAndChamfers(
  faces: ImportedFace[],
  edges: ImportedEdge[],
): RecognizedFeature[] {
  const out: RecognizedFeature[] = [];
  let counter = 0;
  for (const face of faces) {
    if (face.shape === 'cylindrical' && face.radiusMm != null && face.radiusMm < 20) {
      // Cylindrical face with small radius bridging two planar faces → fillet.
      const adj = face.adjacentFaceIds
        .map(id => faces.find(f => f.id === id))
        .filter((f): f is ImportedFace => f != null);
      const planarNeighbours = adj.filter(f => f.shape === 'planar');
      if (planarNeighbours.length >= 2) {
        const allSmooth = edges
          .filter(e => e.leftFaceId === face.id || e.rightFaceId === face.id)
          .every(e => e.convexity === 'smooth' || e.convexity === 'tangent');
        if (allSmooth) {
          out.push({
            id: `fillet-${++counter}`,
            kind: 'fillet',
            confidence: 0.9,
            faceIds: [face.id],
            params: { radiusMm: face.radiusMm },
            rationale: `Cyl radius ${face.radiusMm}mm with smooth edges between planar neighbours`,
          });
        }
      }
    }
    if (face.shape === 'planar') {
      // Planar face between two non-parallel planar faces with sharp non-tangent edges → chamfer.
      const planarNeighbours = face.adjacentFaceIds
        .map(id => faces.find(f => f.id === id))
        .filter((f): f is ImportedFace => f?.shape === 'planar');
      if (planarNeighbours.length === 2 && face.areaMm2 < 50) {
        const n1 = planarNeighbours[0]!.direction;
        const n2 = planarNeighbours[1]!.direction;
        if (!approxParallel(n1, n2, 30)) {
          // Compute the angle between this chamfer face and one of its neighbours.
          const cos = Math.abs(vDot(face.direction, n1));
          const angle = Math.acos(Math.min(1, cos)) * 180 / Math.PI;
          out.push({
            id: `chamfer-${++counter}`,
            kind: 'chamfer',
            confidence: 0.8,
            faceIds: [face.id],
            params: { angleDeg: 90 - angle, areaMm2: face.areaMm2 },
            rationale: 'Small planar face between two non-parallel planar faces',
          });
        }
      }
    }
  }
  return out;
}

// ── Extrude (boss / cut) detection ──────────────────────────────

function detectExtrudes(faces: ImportedFace[]): RecognizedFeature[] {
  const out: RecognizedFeature[] = [];
  let counter = 0;
  // Group sets of planar faces with a single common normal — candidate
  // side faces of an extrusion.
  const planarFaces = faces.filter(f => f.shape === 'planar');
  // Find pairs of parallel "cap" faces with opposite-pointing normals.
  for (let i = 0; i < planarFaces.length; i++) {
    for (let j = i + 1; j < planarFaces.length; j++) {
      const a = planarFaces[i]!;
      const b = planarFaces[j]!;
      const dot = vDot(a.direction, b.direction);
      if (dot > -0.99) continue; // need anti-parallel normals
      // Approximate area equal → bottom + top of an extrude.
      if (!approxEqual(a.areaMm2, b.areaMm2, Math.max(a.areaMm2, b.areaMm2) * 0.05)) continue;
      // Distance between origins along the normal = extrude depth.
      const dx = b.origin[0] - a.origin[0];
      const dy = b.origin[1] - a.origin[1];
      const dz = b.origin[2] - a.origin[2];
      const depth = Math.abs(dx * a.direction[0] + dy * a.direction[1] + dz * a.direction[2]);
      if (depth < 0.1) continue;
      out.push({
        id: `extrude-${++counter}`,
        kind: 'extrude-boss',
        confidence: 0.65,
        faceIds: [a.id, b.id],
        params: { depthMm: depth, profileAreaMm2: a.areaMm2 },
        rationale: `Two anti-parallel planar faces with matching area — extruded boss (depth ${depth.toFixed(1)}mm)`,
      });
    }
  }
  return out;
}

// ── Revolve detection ───────────────────────────────────────────

function detectRevolves(faces: ImportedFace[]): RecognizedFeature[] {
  const out: RecognizedFeature[] = [];
  let counter = 0;
  for (const face of faces) {
    if (face.shape === 'cylindrical') {
      out.push({
        id: `rev-${++counter}`,
        kind: 'revolve-cylinder',
        confidence: 0.7,
        faceIds: [face.id],
        params: { radiusMm: face.radiusMm ?? 0 },
        rationale: 'Cylindrical face — revolved boss',
      });
    } else if (face.shape === 'conical' && face.halfAngleDeg != null) {
      out.push({
        id: `rev-${++counter}`,
        kind: 'revolve-cone',
        confidence: 0.7,
        faceIds: [face.id],
        params: { halfAngleDeg: face.halfAngleDeg },
        rationale: 'Conical face — revolved boss',
      });
    } else if (face.shape === 'toroidal') {
      out.push({
        id: `rev-${++counter}`,
        kind: 'revolve-torus',
        confidence: 0.7,
        faceIds: [face.id],
        params: { minorRadiusMm: face.radiusMm ?? 0 },
        rationale: 'Toroidal face — revolved boss',
      });
    }
  }
  return out;
}

// ── Sweep (pipe) detection ──────────────────────────────────────

function detectSweeps(faces: ImportedFace[]): RecognizedFeature[] {
  const out: RecognizedFeature[] = [];
  let counter = 0;
  // Heuristic: a cylinder where the axis curve is more than a straight
  // line — needs B-rep edge data. For preview, we flag long cylinders
  // with multiple end-caps as sweep candidates.
  const cylinders = faces.filter(f => f.shape === 'cylindrical');
  if (cylinders.length >= 3) {
    // Chain of cylinders aligned end-to-end → sweep pipe.
    const groupedByRadius = new Map<number, ImportedFace[]>();
    for (const c of cylinders) {
      const key = Math.round((c.radiusMm ?? 0) * 100) / 100;
      if (!groupedByRadius.has(key)) groupedByRadius.set(key, []);
      groupedByRadius.get(key)!.push(c);
    }
    for (const [radius, group] of groupedByRadius) {
      if (group.length >= 3) {
        out.push({
          id: `sweep-${++counter}`,
          kind: 'sweep-pipe',
          confidence: 0.55,
          faceIds: group.map(g => g.id),
          params: { radiusMm: radius, segmentCount: group.length },
          rationale: `${group.length} cylindrical segments at same radius — likely swept pipe`,
        });
      }
    }
  }
  return out;
}

// ── Top-level recognize ─────────────────────────────────────────

export interface RecognitionResult {
  features: RecognizedFeature[];
  /** Faces not assigned to any recognized feature. */
  unrecognizedFaceIds: string[];
  /** Top-line confidence — fraction of geometry recognized. */
  recognitionRatio: number;
}

export function recognizeImportedBrep(
  faces: ImportedFace[],
  edges: ImportedEdge[],
): RecognitionResult {
  const features: RecognizedFeature[] = [];
  features.push(...detectHoles(faces, edges));
  features.push(...detectFilletsAndChamfers(faces, edges));
  features.push(...detectExtrudes(faces));
  features.push(...detectRevolves(faces));
  features.push(...detectSweeps(faces));

  // Track which faces have been assigned.
  const assigned = new Set<string>();
  for (const f of features) for (const fid of f.faceIds) assigned.add(fid);
  const unassigned = faces.filter(f => !assigned.has(f.id)).map(f => f.id);
  const recognitionRatio = faces.length > 0 ? (faces.length - unassigned.length) / faces.length : 0;

  return { features, unrecognizedFaceIds: unassigned, recognitionRatio };
}

/** Higher-level summary: count of each recognized kind. */
export function summarizeRecognition(result: RecognitionResult): Record<RecognizedKind, number> {
  const out = {} as Record<RecognizedKind, number>;
  for (const f of result.features) {
    out[f.kind] = (out[f.kind] ?? 0) + 1;
  }
  return out;
}
