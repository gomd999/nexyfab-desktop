/**
 * contactPairDetector.ts — Find candidate contact pairs between two
 * meshes for FEA contact analysis.
 *
 * In FEA, a *contact pair* is a region where two bodies might
 * touch under load. Setting these up manually is tedious. The
 * detector finds candidate pairs from CAD geometry:
 *
 *   1. For each face on body A, find the nearest face on body B.
 *   2. If the gap is below a threshold AND the face normals are
 *      anti-parallel (facing each other), they form a contact pair.
 *   3. Classify as:
 *        - "bonded" (gap ≈ 0, planar) → tied contact.
 *        - "frictional" (gap < tolerance, curved normals) → sliding.
 *        - "spotweld" (single point contact).
 *
 * Output: list of pairs with face indices, gap, contact type +
 * confidence score.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface MeshFace {
  /** Face id within its parent body. */
  id: string;
  /** Centroid in world coordinates. */
  centroid: Vec3;
  /** Outward unit normal. */
  normal: Vec3;
  /** Face area, mm². */
  areaMm2: number;
}

export interface MeshBody {
  /** Body id. */
  id: string;
  /** Faces. */
  faces: MeshFace[];
}

export type ContactType = 'bonded' | 'frictional' | 'spotweld' | 'no-contact';

export interface ContactPair {
  bodyA: string;
  faceA: string;
  bodyB: string;
  faceB: string;
  /** Gap in mm. */
  gapMm: number;
  /** Cosine of angle between normals (-1 means perfectly facing). */
  normalAlignment: number;
  contactType: ContactType;
  /** 0..1 confidence based on alignment + area matching. */
  confidence: number;
}

export interface DetectionResult {
  pairs: ContactPair[];
  /** Faces on body A unmatched. */
  unmatchedA: string[];
  /** Faces on body B unmatched. */
  unmatchedB: string[];
}

export interface DetectionOptions {
  /** Max gap to consider in contact, mm. */
  maxGapMm: number;
  /** Cosine threshold (normals must be more anti-parallel than this; -1 = perfectly). */
  cosineThreshold: number;
  /** Minimum face area to consider as bonded contact. */
  bondedMinAreaMm2: number;
}

export const DEFAULT_OPTIONS: DetectionOptions = {
  maxGapMm: 0.5,
  cosineThreshold: -0.5,
  bondedMinAreaMm2: 10,
};

// ── Top-level entry ────────────────────────────────────────────

export function detectContactPairs(bodyA: MeshBody, bodyB: MeshBody, options: Partial<DetectionOptions> = {}): DetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pairs: ContactPair[] = [];
  const usedB = new Set<string>();

  for (const fa of bodyA.faces) {
    let bestPair: ContactPair | null = null;
    let bestScore = -Infinity;
    for (const fb of bodyB.faces) {
      if (usedB.has(fb.id)) continue;
      const gap = distance(fa.centroid, fb.centroid);
      if (gap > opts.maxGapMm) continue;
      const alignment = dot(fa.normal, fb.normal);
      if (alignment > opts.cosineThreshold) continue; // not anti-parallel enough
      const score = -alignment - gap / Math.max(0.01, opts.maxGapMm);
      if (score > bestScore) {
        bestScore = score;
        const type = classifyContact(gap, alignment, fa.areaMm2, fb.areaMm2, opts);
        bestPair = {
          bodyA: bodyA.id,
          faceA: fa.id,
          bodyB: bodyB.id,
          faceB: fb.id,
          gapMm: gap,
          normalAlignment: alignment,
          contactType: type,
          confidence: contactConfidence(gap, alignment, fa.areaMm2, fb.areaMm2),
        };
      }
    }
    if (bestPair) {
      pairs.push(bestPair);
      usedB.add(bestPair.faceB);
    }
  }

  const matchedA = new Set(pairs.map(p => p.faceA));
  const matchedB = new Set(pairs.map(p => p.faceB));
  const unmatchedA = bodyA.faces.filter(f => !matchedA.has(f.id)).map(f => f.id);
  const unmatchedB = bodyB.faces.filter(f => !matchedB.has(f.id)).map(f => f.id);

  return { pairs, unmatchedA, unmatchedB };
}

// ── Classification ─────────────────────────────────────────────

function classifyContact(gap: number, alignment: number, areaA: number, areaB: number, opts: DetectionOptions): ContactType {
  const isFacing = alignment < -0.9;
  const isAligned = alignment < -0.7;
  const minArea = Math.min(areaA, areaB);
  if (gap < 0.05 && isFacing && minArea >= opts.bondedMinAreaMm2) return 'bonded';
  if (gap < 0.1 && minArea < 1) return 'spotweld';
  if (isAligned) return 'frictional';
  return 'no-contact';
}

function contactConfidence(gap: number, alignment: number, areaA: number, areaB: number): number {
  // 0..1 based on gap (smaller is better), alignment (more anti-parallel is better),
  // and area ratio (more equal is better).
  const gapScore = Math.max(0, 1 - gap / 0.5);
  const alignmentScore = Math.max(0, -alignment);
  const ratio = Math.min(areaA, areaB) / Math.max(areaA, areaB, 1e-6);
  return (gapScore * 0.4 + alignmentScore * 0.4 + ratio * 0.2);
}

// ── Helpers ────────────────────────────────────────────────────

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// ── Summary ────────────────────────────────────────────────────

export interface ContactSummary {
  pairCount: number;
  bondedCount: number;
  frictionalCount: number;
  spotweldCount: number;
  averageGapMm: number;
  averageConfidence: number;
}

export function summarize(result: DetectionResult): ContactSummary {
  if (result.pairs.length === 0) {
    return { pairCount: 0, bondedCount: 0, frictionalCount: 0, spotweldCount: 0, averageGapMm: 0, averageConfidence: 0 };
  }
  const counts = { bonded: 0, frictional: 0, spotweld: 0, 'no-contact': 0 };
  let gap = 0;
  let conf = 0;
  for (const p of result.pairs) {
    counts[p.contactType]++;
    gap += p.gapMm;
    conf += p.confidence;
  }
  return {
    pairCount: result.pairs.length,
    bondedCount: counts.bonded,
    frictionalCount: counts.frictional,
    spotweldCount: counts.spotweld,
    averageGapMm: gap / result.pairs.length,
    averageConfidence: conf / result.pairs.length,
  };
}
