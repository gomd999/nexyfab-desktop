/**
 * Assembly Mate Auto-Suggestion Engine
 *
 * When two bodies are selected (or a standard part is dropped onto a host),
 * this engine analyses both geometries and suggests the most likely mate types
 * with pre-filled face indices.
 *
 * Algorithm:
 *  1. Extract dominant face groups from each body (normals + centroids).
 *  2. For each pair of faces (one from each body), compute a "match score"
 *     based on:
 *       – Normal alignment (coincident → anti-parallel, parallel → same dir)
 *       – Area ratio (faces of similar size are better candidates)
 *       – Whether both faces are circular (→ concentric suggestion)
 *  3. Return the top-N suggestions sorted by score.
 *
 * Usage:
 *   const suggestions = suggestMates(geoA, geoB);
 *   // → [{ type: 'coincident', faceA: 3, faceB: 7, score: 0.92 }, ...]
 */

import * as THREE from 'three';
import type { MateType } from './AssemblyMates';
import { solveMates } from './AssemblyMates';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaceGroup {
  /** Dominant normal direction */
  normal: THREE.Vector3;
  /** Average centroid of all triangles in group */
  centroid: THREE.Vector3;
  /** Total surface area (mm²) */
  area: number;
  /** First triangle index belonging to this group */
  faceIndex: number;
  /** Whether this face appears to be circular (suitable for concentric) */
  isCircular: boolean;
}

export interface MateSuggestion {
  type: MateType;
  /** Face index in geometry A */
  faceA: number;
  /** Face index in geometry B */
  faceB: number;
  /** Confidence score 0–1 */
  score: number;
  /** Human-readable rationale */
  reason: string;
  /** Suggested value for distance/angle mates (mm or deg) */
  suggestedValue?: number;
}

// ─── Face group extraction ────────────────────────────────────────────────────

const NORMAL_CLUSTER_TOL = 0.15; // dot product tolerance for grouping

function extractFaceGroups(geo: THREE.BufferGeometry, maxGroups = 8): FaceGroup[] {
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute | null;
  const index = geo.getIndex();

  const triCount = index
    ? Math.floor(index.count / 3)
    : Math.floor(posAttr.count / 3);

  // Collect per-triangle normals + centroids
  const triNormals: THREE.Vector3[] = [];
  const triCentroids: THREE.Vector3[] = [];
  const triAreas: number[] = [];

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (index) {
      i0 = index.getX(t * 3); i1 = index.getX(t * 3 + 1); i2 = index.getX(t * 3 + 2);
    } else {
      i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2;
    }
    const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
    const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
    const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);

    const n = normAttr
      ? new THREE.Vector3().fromBufferAttribute(normAttr, i0).normalize()
      : new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(b, a),
          new THREE.Vector3().subVectors(c, a),
        ).normalize();

    triNormals.push(n);
    triCentroids.push(new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3));

    // Triangle area = 0.5 |AB × AC|
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    triAreas.push(new THREE.Vector3().crossVectors(ab, ac).length() * 0.5);
  }

  // Cluster by normal similarity
  const clusters: number[][] = []; // each cluster holds triangle indices

  for (let t = 0; t < triCount; t++) {
    let matched = false;
    for (const cluster of clusters) {
      const rep = triNormals[cluster[0]];
      if (Math.abs(triNormals[t].dot(rep)) > 1 - NORMAL_CLUSTER_TOL) {
        cluster.push(t);
        matched = true;
        break;
      }
    }
    if (!matched) clusters.push([t]);
  }

  // Build FaceGroup per cluster (sorted by area desc, take top maxGroups)
  const groups: FaceGroup[] = clusters.map(cluster => {
    const centroid = new THREE.Vector3();
    let area = 0;
    const domNormal = new THREE.Vector3();
    for (const t of cluster) {
      centroid.addScaledVector(triCentroids[t], triAreas[t]);
      domNormal.addScaledVector(triNormals[t], triAreas[t]);
      area += triAreas[t];
    }
    if (area > 0) { centroid.divideScalar(area); domNormal.divideScalar(area); }
    domNormal.normalize();

    // Circularity heuristic: sample a ring of centroids — if their distances
    // to the cluster centroid are roughly equal, the face is circular.
    let isCircular = false;
    if (cluster.length >= 8) {
      const dists = cluster.map(t => triCentroids[t].distanceTo(centroid));
      const meanD = dists.reduce((s, d) => s + d, 0) / dists.length;
      const stdD = Math.sqrt(dists.reduce((s, d) => s + (d - meanD) ** 2, 0) / dists.length);
      isCircular = meanD > 0 && stdD / meanD < 0.25;
    }

    return { normal: domNormal, centroid, area, faceIndex: cluster[0], isCircular };
  });

  return groups
    .sort((a, b) => b.area - a.area)
    .slice(0, maxGroups);
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scorePair(
  gA: FaceGroup,
  gB: FaceGroup,
): { type: MateType; score: number; reason: string; suggestedValue?: number } | null {
  const dot = gA.normal.dot(gB.normal);
  const areaRatio = Math.min(gA.area, gB.area) / Math.max(gA.area, gB.area + 1e-9);

  // Coincident: normals anti-parallel, similar area
  if (dot < -0.85 && areaRatio > 0.3) {
    const score = 0.5 * (1 - (dot + 1)) + 0.3 * areaRatio + 0.2;
    return { type: 'coincident', score: Math.min(1, score), reason: 'Anti-parallel faces of similar size' };
  }

  // Concentric: both faces appear circular and normals are roughly aligned
  if (gA.isCircular && gB.isCircular && Math.abs(dot) > 0.7) {
    const score = 0.6 + 0.4 * areaRatio;
    return { type: 'concentric', score: Math.min(1, score), reason: 'Circular face pair — bore/shaft alignment' };
  }

  // Parallel: normals aligned (same direction)
  if (dot > 0.85 && areaRatio > 0.2) {
    const dist = gA.centroid.distanceTo(gB.centroid);
    return { type: 'parallel', score: 0.5 * areaRatio + 0.2, reason: 'Parallel faces', suggestedValue: Math.round(dist * 10) / 10 };
  }

  // Distance: faces roughly facing each other, reasonable separation
  if (dot < -0.5) {
    const dist = gA.centroid.distanceTo(gB.centroid);
    if (dist > 0 && dist < 500) {
      return { type: 'distance', score: 0.3 + 0.2 * areaRatio, reason: 'Gap between facing surfaces', suggestedValue: Math.round(dist * 10) / 10 };
    }
  }

  return null;
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Suggest the most likely mate constraints between two bodies.
 *
 * @param geoA       Geometry of body A (world space)
 * @param geoB       Geometry of body B (world space)
 * @param maxResults Maximum number of suggestions (default 4)
 */
export function suggestMates(
  geoA: THREE.BufferGeometry,
  geoB: THREE.BufferGeometry,
  maxResults = 4,
): MateSuggestion[] {
  if (!geoA.getAttribute('normal')) geoA.computeVertexNormals();
  if (!geoB.getAttribute('normal')) geoB.computeVertexNormals();

  const groupsA = extractFaceGroups(geoA);
  const groupsB = extractFaceGroups(geoB);

  const candidates: MateSuggestion[] = [];

  for (const gA of groupsA) {
    for (const gB of groupsB) {
      const scored = scorePair(gA, gB);
      if (scored && scored.score > 0.25) {
        candidates.push({
          type: scored.type,
          faceA: gA.faceIndex,
          faceB: gB.faceIndex,
          score: scored.score,
          reason: scored.reason,
          suggestedValue: scored.suggestedValue,
        });
      }
    }
  }

  // Sort by score, deduplicate by type (keep best per type)
  const seen = new Set<MateType>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(s => {
      if (seen.has(s.type)) return false;
      seen.add(s.type);
      return true;
    })
    .slice(0, maxResults);
}

/**
 * Snap-align body B to body A using the first coincident/concentric suggestion.
 * Returns the new world transform for body B.
 */
export function snapBtoA(
  geoA: THREE.BufferGeometry,
  transformA: THREE.Matrix4,
  geoB: THREE.BufferGeometry,
  transformB: THREE.Matrix4,
): THREE.Matrix4 | null {
  const suggestions = suggestMates(geoA, geoB, 2);
  if (suggestions.length === 0) return null;

  const best = suggestions[0];

  const results: Map<string, THREE.Matrix4> = solveMates(
    [
      { id: 'A', geometry: geoA, transform: transformA },
      { id: 'B', geometry: geoB, transform: transformB },
    ],
    [{
      id: 'auto_mate',
      type: best.type,
      partA: 'A',
      partB: 'B',
      faceA: best.faceA,
      faceB: best.faceB,
      value: best.suggestedValue,
      locked: false,
    }],
    3,
  );
  return results.get('B') ?? null;
}

/**
 * Build a human-readable label for a suggestion.
 */
export function mateSuggestionLabel(s: MateSuggestion, lang = 'en'): string {
  const types: Record<string, Record<MateType, string>> = {
    en: {
      coincident: 'Coincident', concentric: 'Concentric',
      distance: 'Distance', angle: 'Angle',
      parallel: 'Parallel', perpendicular: 'Perpendicular',
      tangent: 'Tangent', hinge: 'Hinge',
      slider: 'Slider', gear: 'Gear',
    },
    ko: {
      coincident: '일치', concentric: '동심',
      distance: '거리', angle: '각도',
      parallel: '평행', perpendicular: '직각',
      tangent: '접선', hinge: '힌지',
      slider: '슬라이더', gear: '기어',
    },
  };
  const lk = lang === 'ko' || lang === 'kr' ? 'ko' : 'en';
  const typeLabel = types[lk][s.type] ?? s.type;
  const conf = Math.round(s.score * 100);
  const val = s.suggestedValue !== undefined ? ` (${s.suggestedValue} mm)` : '';
  return `${typeLabel}${val} — ${conf}% conf`;
}
