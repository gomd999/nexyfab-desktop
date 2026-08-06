export type RemapTopologyKind = 'face' | 'edge' | 'vertex';

export type TopologyEntitySnapshot = {
  kind: RemapTopologyKind;
  persistentRef: string;
  featureId?: string;
  semanticRole?: string;
  centroid: [number, number, number];
  direction?: [number, number, number];
  measure: number;
  adjacency?: string[];
};

export type TopologyRemapRequest = TopologyEntitySnapshot;
export type TopologyRemapResult = {
  previousRef: string;
  mappedRef?: string;
  quality: 'persistent' | 'derived' | 'ambiguous' | 'broken';
  score: number;
  runnerUpScore?: number;
  reason: string;
};

export type TopologyRemapOptions = {
  acceptScore?: number;
  ambiguityMargin?: number;
};

/** Conservative history-first matcher for topology after regeneration. */
export function remapTopologyEntities(
  previous: readonly TopologyRemapRequest[],
  current: readonly TopologyEntitySnapshot[],
  options: TopologyRemapOptions = {},
): TopologyRemapResult[] {
  const acceptScore = options.acceptScore ?? 0.72;
  const ambiguityMargin = options.ambiguityMargin ?? 0.08;
  const claimed = new Set<string>();
  return previous.map(old => {
    const exact = current.find(candidate => candidate.kind === old.kind && candidate.persistentRef === old.persistentRef && !claimed.has(candidate.persistentRef));
    if (exact) {
      claimed.add(exact.persistentRef);
      return { previousRef: old.persistentRef, mappedRef: exact.persistentRef, quality: 'persistent', score: 1, reason: 'generative provenance id survived regeneration' };
    }
    const ranked = current
      .filter(candidate => candidate.kind === old.kind && !claimed.has(candidate.persistentRef))
      .map(candidate => ({ candidate, score: topologySimilarity(old, candidate) }))
      .sort((a, b) => b.score - a.score || a.candidate.persistentRef.localeCompare(b.candidate.persistentRef));
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.score < acceptScore) {
      return { previousRef: old.persistentRef, quality: 'broken', score: best?.score ?? 0, runnerUpScore: runnerUp?.score, reason: 'no candidate passed the conservative remap threshold' };
    }
    if (runnerUp && best.score - runnerUp.score < ambiguityMargin) {
      return { previousRef: old.persistentRef, quality: 'ambiguous', score: best.score, runnerUpScore: runnerUp.score, reason: 'multiple topology candidates are geometrically equivalent' };
    }
    claimed.add(best.candidate.persistentRef);
    return { previousRef: old.persistentRef, mappedRef: best.candidate.persistentRef, quality: 'derived', score: best.score, runnerUpScore: runnerUp?.score, reason: 'remapped from semantic and geometric invariants' };
  });
}

export function topologySimilarity(a: TopologyEntitySnapshot, b: TopologyEntitySnapshot): number {
  if (a.kind !== b.kind) return 0;
  let score = 0;
  let weight = 0;
  const add = (value: number, w: number) => { score += clamp01(value) * w; weight += w; };
  add(a.featureId && b.featureId ? Number(a.featureId === b.featureId) : 0.5, 0.28);
  add(a.semanticRole && b.semanticRole ? Number(a.semanticRole === b.semanticRole) : 0.5, 0.22);
  add(relativeSimilarity(a.measure, b.measure), 0.18);
  add(distanceSimilarity(a.centroid, b.centroid, characteristicLength(a.measure, b.measure)), 0.16);
  add(a.direction && b.direction ? directionSimilarity(a.direction, b.direction) : 0.5, 0.10);
  add(adjacencySimilarity(a.adjacency, b.adjacency), 0.06);
  const total = weight ? score / weight : 0;
  // Opposite semantic roles (top vs bottom, inner vs outer) are not the same
  // entity even when their area/centroid happens to match after a rebuild.
  if (a.semanticRole && b.semanticRole && a.semanticRole !== b.semanticRole) return Math.min(total, 0.55);
  return total;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const characteristicLength = (a: number, b: number) => Math.max(Math.sqrt(Math.abs(a)), Math.sqrt(Math.abs(b)), 1e-6);
const relativeSimilarity = (a: number, b: number) => {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return 1 - Math.abs(a - b) / scale;
};
const distanceSimilarity = (a: [number, number, number], b: [number, number, number], scale: number) => {
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return Math.exp(-d / Math.max(scale, 1e-6));
};
const directionSimilarity = (a: [number, number, number], b: [number, number, number]) => {
  const la = Math.hypot(...a); const lb = Math.hypot(...b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb));
};
const adjacencySimilarity = (a: string[] | undefined, b: string[] | undefined) => {
  if (!a?.length || !b?.length) return 0.5;
  const aa = new Set(a); const bb = new Set(b);
  let overlap = 0; for (const value of aa) if (bb.has(value)) overlap += 1;
  return overlap / Math.max(aa.size, bb.size);
};
