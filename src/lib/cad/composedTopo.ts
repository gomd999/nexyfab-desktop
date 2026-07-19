/**
 * composedTopo — stable edge names across a boolean (K2.2 of ADR-014).
 *
 * A primitive's edges get provenance names from topoNaming (`e.vert.0`, …). A
 * boolean (Fuse/Cut/Common) keeps SOME of those edges verbatim, drops others,
 * and introduces new seam edges along the intersection. K2.2 re-derives a stable
 * naming for the RESULT by geometric inheritance.
 *
 * ## W1-B (ADR-017) — role prefixes are FEATURE-scoped, not positional
 *
 * The original scheme prefixed an inherited name with the operand's POSITION in
 * the boolean (`a/` = accumulator, `b/` = tool) and re-prefixed on every chained
 * boolean. That made a name a function of *how many booleans ran before it*:
 * inserting a second cut turned the authored `b/e.vert.0` (hole #1) into a name
 * that resolved to hole #2 — a silent mismatch, measured at 50% in the ADR-017
 * spike (S2b). The fix is a naming convention only (no kernel API):
 *
 *  1. **Prefix = the operand's stable feature id**, not its position. Base stays
 *     `base/e.vert.0` no matter how many tools are inserted after it.
 *  2. **Already-qualified names pass through unchanged.** A chained boolean does
 *     NOT re-prefix names that already carry their originating feature, so the
 *     namespace stops growing (`a/a/e.vert.0` no longer happens) and a name
 *     survives the insertion of an unrelated feature.
 *  3. **Seams are scoped to the boolean that created them** (`opId`), so a later
 *     boolean's `seam.0` cannot shadow an earlier one's. The seam *derivation*
 *     (deterministic midpoint order) is untouched — that is Wave 3's job.
 *  4. **Ambiguity is never resolved by guessing.** If two operands would produce
 *     the same composed name, BOTH result edges are left unnamed and the name is
 *     recorded as ambiguous. `anchor()` returns null and `lossReason()` says why.
 *
 * Rule 4 is what makes the legacy positional path safe rather than merely
 * deprecated: callers that still pass `role: 'a' | 'b'` now collide instead of
 * shadowing, so they degrade to an explicit reference loss — never to a silent
 * wrong entity. That is ADR-017 D1: a lost reference is a product decision, a
 * silently relocated fillet is a defect.
 *
 * The names resolve back to 3D anchors so the OCCT bridge can pick the kernel's
 * re-indexed `TopoDS_Edge` for a fillet — exactly as in K3, now on a composed
 * shape. This is the kernel-agnostic re-match; pure + testable.
 */

import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { sub, lengthOf } from '@/lib/sketch/sketchPlane';

/** Why a name failed to resolve. Never "we picked something close enough". */
export type LossReason =
  /** No such name in this topology (feature deleted, edge consumed, or a name
   *  minted by a different naming scheme — see `legacy-role`). */
  | 'unknown'
  /** Two operands claimed this exact name; refusing to guess which. */
  | 'ambiguous'
  /** A positional name (`a/…`, `b/…`) from the pre-W1-B scheme. It cannot be
   *  re-interpreted safely, because the position it referred to is exactly the
   *  thing that moves when a feature is inserted. Reported distinctly so the UI
   *  can say "re-select this edge" instead of "unknown edge". */
  | 'legacy-role';

/** A name→anchor source the fillet path resolves edges against. */
export interface EdgeAnchorSource {
  /** 3D anchor (midpoint) of the named edge, or null if unknown. */
  anchor(name: string): Vec3 | null;
  /** Every resolvable edge name (for error messages / UI pickers). */
  names(): string[];
  /** Diagnosis for a name that did NOT resolve; null if it did resolve. */
  lossReason?(name: string): LossReason | null;
}

/** A positional prefix minted by the pre-W1-B scheme (`a/…`, `b/…`, `a/b/…`). */
const LEGACY_ROLE = /^[ab]\/(?:[ab]\/)*/;

export function isLegacyRoleName(name: string): boolean {
  return LEGACY_ROLE.test(name);
}

/** Wrap a primitive's stable topology as an anchor source. */
export function fromAnchors(
  map: ReadonlyMap<string, Vec3>,
  ambiguous: ReadonlySet<string> = new Set(),
): EdgeAnchorSource {
  return {
    anchor: (name) => map.get(name) ?? null,
    names: () => [...map.keys()].sort(),
    lossReason: (name) => {
      if (map.has(name)) return null;
      if (ambiguous.has(name)) return 'ambiguous';
      return isLegacyRoleName(name) ? 'legacy-role' : 'unknown';
    },
  };
}

export interface BooleanInput {
  /**
   * Stable feature/node id of this operand — the prefix inherited names get.
   * PREFER THIS. It must identify the feature, not its slot in the boolean.
   */
  featureId?: string;
  /**
   * @deprecated Positional role ('a' = accumulator, 'b' = tool). Unstable: the
   * same string denotes a different feature once another operand is inserted.
   * Retained so existing callers compile; ambiguity now degrades to an explicit
   * loss (see module docs, rule 4) rather than a silent mismatch. Pass
   * `featureId` instead.
   */
  role?: string;
  /** Edge names of this input. */
  names: string[];
  /** 3D anchor of one of this input's edge names. */
  anchorOf(name: string): Vec3 | null;
}

export interface ComposeOptions {
  /** Coincidence tolerance (mm). */
  tol?: number;
  /**
   * Stable id of the BOOLEAN itself. Scopes the seam names it mints
   * (`${opId}/seam.0`) so a later boolean cannot shadow them. Omitted → bare
   * `seam.k`, which is only unique when a single boolean is in play.
   */
  opId?: string;
}

function coincides(a: Vec3, b: Vec3, tol: number): boolean {
  return lengthOf(sub(a, b)) <= tol;
}

function sortKey(v: Vec3): string {
  const q = (n: number) => Math.round(n * 1000).toString().padStart(8, '0');
  return `${q(v.x)},${q(v.y)},${q(v.z)}`;
}

/**
 * Compose an inherited name. A name that already carries a feature qualifier
 * (contains '/') is passed through untouched — re-prefixing it is what made the
 * old scheme positional.
 */
function qualify(prefix: string | undefined, name: string): string {
  if (name.includes('/')) return name;
  return prefix ? `${prefix}/${name}` : name;
}

/**
 * Build the composed naming for a boolean result.
 *
 * @param inputs       the boolean's operands, each with named edges + anchors
 * @param resultMids   midpoints of the RESULT's unique edges (kernel order)
 * @param opts         tolerance + the boolean's own id (seam scope). A bare
 *                     number is accepted for the legacy `tol` positional arg.
 */
export function composeBooleanTopo(
  inputs: ReadonlyArray<BooleanInput>,
  resultMids: ReadonlyArray<Vec3>,
  opts: ComposeOptions | number = {},
): EdgeAnchorSource {
  const { tol = 1e-3, opId } = typeof opts === 'number' ? { tol: opts, opId: undefined } : opts;

  const named = new Map<string, Vec3>();
  const indexOfName = new Map<string, number>();
  const ambiguous = new Set<string>();
  const claimed = new Set<number>(); // result-edge indices an input has claimed
  const poisoned = new Set<number>(); // indices whose provenance is ambiguous

  // Inherit names for surviving edges.
  for (const input of inputs) {
    const prefix = input.featureId ?? input.role;
    for (const name of input.names) {
      const a = input.anchorOf(name);
      if (!a) continue;
      const idx = resultMids.findIndex(
        (m, i) => !claimed.has(i) && !poisoned.has(i) && coincides(m, a, tol),
      );
      if (idx < 0) continue;

      const composed = qualify(prefix, name);

      // Same composed name from two operands → we cannot tell which edge the
      // user meant. Refuse both (D1: explicit loss over a silent wrong pick).
      if (ambiguous.has(composed) || named.has(composed)) {
        const prev = indexOfName.get(composed);
        if (prev !== undefined) {
          claimed.delete(prev);
          poisoned.add(prev);
          named.delete(composed);
          indexOfName.delete(composed);
        }
        poisoned.add(idx);
        ambiguous.add(composed);
        continue;
      }

      claimed.add(idx);
      named.set(composed, resultMids[idx]);
      indexOfName.set(composed, idx);
    }
  }

  // Remaining result edges are intersection seams — deterministic by midpoint,
  // scoped to THIS boolean so a later one cannot shadow them. (The ordering
  // itself is unchanged; replacing it with kernel history is Wave 3 / W3-A.)
  const seamPrefix = opId ? `${opId}/` : '';
  const seams = resultMids
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => !claimed.has(i) && !poisoned.has(i))
    .sort((p, q) => (sortKey(p.m) < sortKey(q.m) ? -1 : 1));
  seams.forEach(({ m }, k) => named.set(`${seamPrefix}seam.${k}`, m));

  return fromAnchors(named, ambiguous);
}
