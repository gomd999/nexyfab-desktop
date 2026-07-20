/**
 * featureSeed.ts — W5-D "feature-unit pattern" seed log.
 *
 * Problem: linearPattern/circularPattern historically duplicated the WHOLE
 * body mesh (judgment 260721: 3× vertex count, 3.0000× signed volume — the
 * overlap is double-counted, i.e. a merge, not a union, and certainly not a
 * re-applied feature). A real pattern references its SOURCE FEATURE and
 * re-applies it at each instance position.
 *
 * A feature's `apply()` only sees the incoming geometry + its own params — it
 * cannot see sibling features. So cut/hole (the self-contained tool-body
 * features, per the W2 "leaf 유지" 판정) log their own spec onto the outgoing
 * geometry's userData; a downstream pattern in feature mode reads the log and
 * re-executes the actual subtraction per instance.
 *
 * Honest limitation: the log rides on `BufferGeometry.userData`, which most
 * intermediate features rebuild without copying. A feature-mode pattern must
 * therefore follow its seed feature with only seed-preserving features in
 * between (cut/hole preserve and extend the log). When the log is missing the
 * pattern REJECTS with the reason instead of silently body-copying.
 */
import type * as THREE from 'three';

export const PATTERN_SEED_KEY = 'nfabPatternSeeds';

/** Keep only the most recent N seeds — bounded userData growth. */
export const PATTERN_SEED_CAP = 16;

export type PatternSeedType = 'cut' | 'hole';

export interface PatternSeed {
  /** Pipeline feature id of the source feature (null when applied standalone). */
  featureId: string | null;
  type: PatternSeedType;
  /** Numeric param snapshot exactly as the source feature consumed it.
   *  For end-condition features this includes `endCondition` (enum number)
   *  and, for up_to_face, the RESOLVED `upToPlaneY` so re-application does
   *  not need the original face selection object. */
  params: Record<string, number>;
}

/** Read the seed log off a geometry (empty array when absent/malformed). */
export function readPatternSeeds(g: THREE.BufferGeometry): PatternSeed[] {
  const raw = (g.userData as Record<string, unknown> | undefined)?.[PATTERN_SEED_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is PatternSeed =>
      !!s && typeof s === 'object'
      && ((s as PatternSeed).type === 'cut' || (s as PatternSeed).type === 'hole')
      && typeof (s as PatternSeed).params === 'object',
  );
}

/** Carry the input's seed log onto `out` and append one new entry (capped). */
export function appendPatternSeed(
  out: THREE.BufferGeometry,
  input: THREE.BufferGeometry,
  seed: PatternSeed,
): void {
  const next = [...readPatternSeeds(input), seed].slice(-PATTERN_SEED_CAP);
  out.userData = { ...out.userData, [PATTERN_SEED_KEY]: next };
}

/** Overwrite the seed log (pattern uses this to restore the pre-pattern log so
 *  its own instance re-applications don't shift later `seedBack` references). */
export function setPatternSeeds(g: THREE.BufferGeometry, seeds: PatternSeed[]): void {
  g.userData = { ...g.userData, [PATTERN_SEED_KEY]: seeds };
}
