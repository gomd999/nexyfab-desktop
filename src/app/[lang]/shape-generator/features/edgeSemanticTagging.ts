/**
 * edgeSemanticTagging.ts — Survive B-rep split / merge across booleans.
 *
 * The single-edge persistent-id strategy (containsPoint + ofLength)
 * breaks when an upstream boolean splits one edge into two. The fillet
 * feature was anchored to the original edge; after the split the
 * containsPoint matches one of the two pieces and the other goes
 * un-filleted, producing a visible C0 kink in the surface.
 *
 * Semantic tagging fixes this by attaching a stable *intent* tag to a
 * selection at click-time. When the pipeline re-evaluates, it looks up
 * all current edges that share the tag — splits / merges produce a
 * one-to-many mapping that the EdgeFinder builder unions with `.or()`.
 *
 * The tag is opaque to OCCT — it's a NexyFab-side concept the topology
 * tracker maintains alongside the edge cache.
 */

import type { EdgeSelectionInfo } from '../editing/selectionInfo';

/** True when `frag` is a fragment of the same physical edge as `orig` — i.e. it
 *  is parallel, lies on `orig`'s infinite line (perpendicular offset ≤ tolMm),
 *  and falls within `orig`'s reach along that line. This is what makes a
 *  boolean-split fragment inherit the original selection's tag even though its
 *  midpoint has moved well away from the original click point. Parallel-but-
 *  offset edges (e.g. the opposite edge of a box) are rejected by the
 *  perpendicular-offset test, so they do NOT steal the tag. */
function fragmentLiesOnEdge(
  frag: EdgeSelectionInfo,
  orig: EdgeSelectionInfo,
  tolMm: number,
): boolean {
  const fd = frag.direction, od = orig.direction;
  if (!fd || !od) return false;
  const fl = Math.hypot(fd[0], fd[1], fd[2]);
  const ol = Math.hypot(od[0], od[1], od[2]);
  if (fl < 1e-9 || ol < 1e-9) return false;
  const ux = od[0] / ol, uy = od[1] / ol, uz = od[2] / ol;
  // Parallel?
  const dot = (fd[0] * ux + fd[1] * uy + fd[2] * uz) / fl;
  if (Math.abs(dot) < 0.999) return false;
  // Decompose (frag.position − orig.position) into along- and perpendicular-axis.
  const wx = frag.position[0] - orig.position[0];
  const wy = frag.position[1] - orig.position[1];
  const wz = frag.position[2] - orig.position[2];
  const along = wx * ux + wy * uy + wz * uz;
  const perpX = wx - along * ux, perpY = wy - along * uy, perpZ = wz - along * uz;
  const perp = Math.hypot(perpX, perpY, perpZ);
  if (perp > tolMm) return false;                 // not on the same line
  // The two must OVERLAP along the line, not just be collinear: the gap between
  // their reference points may not exceed their combined half-extents. This
  // tags a split fragment (shorter, inside) AND a merged super-edge (longer,
  // straddling) while a genuinely separate edge further down the same line —
  // beyond both half-lengths — is rejected.
  return Math.abs(along) <= (orig.length + frag.length) / 2 + tolMm;
}

export type SemanticTag = string & { readonly __brand: 'SemanticTag' };

/** Mint a tag from a click. The tag is the persistent id when
 *  available; otherwise a stable hash of the position + length. */
export function mintSemanticTag(sel: EdgeSelectionInfo): SemanticTag {
  if (sel.persistentId) return sel.persistentId as SemanticTag;
  // FNV-1a-ish 32-bit hash of quantised position + length. Good
  // enough for our cache-key purposes — never used for security.
  const qx = Math.round(sel.position[0] * 1000);
  const qy = Math.round(sel.position[1] * 1000);
  const qz = Math.round(sel.position[2] * 1000);
  const ql = Math.round(sel.length * 1000);
  let h = 0x811c9dc5;
  for (const v of [qx, qy, qz, ql]) {
    h ^= v >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `e_${h.toString(16).padStart(8, '0')}` as SemanticTag;
}

/** Map a tag to the *current* set of edge selections that should be
 *  treated as part of that intent. The registry is rebuilt every time
 *  the pipeline re-evaluates — entries are not persisted to disk. */
export class SemanticTagRegistry {
  private byTag = new Map<SemanticTag, EdgeSelectionInfo[]>();

  /** Register the click-time selection under a fresh or existing tag. */
  register(tag: SemanticTag, sel: EdgeSelectionInfo): void {
    const list = this.byTag.get(tag);
    if (list) list.push(sel);
    else this.byTag.set(tag, [sel]);
  }

  /** Resolve a tag to every selection sharing it (after split). */
  resolve(tag: SemanticTag): EdgeSelectionInfo[] {
    return this.byTag.get(tag) ?? [];
  }

  /** After a boolean op, add new fragments to existing tags. The
   *  match uses position proximity — fragments within `tolMm` of any
   *  existing tagged endpoint inherit that tag. */
  propagateAfterBoolean(
    newSelections: EdgeSelectionInfo[],
    tolMm = 0.5,
  ): { taggedFragments: number; orphans: EdgeSelectionInfo[] } {
    let tagged = 0;
    const orphans: EdgeSelectionInfo[] = [];
    for (const ns of newSelections) {
      const match = this.findClosestTag(ns, tolMm);
      if (match) {
        this.register(match, ns);
        tagged++;
      } else {
        orphans.push(ns);
      }
    }
    return { taggedFragments: tagged, orphans };
  }

  private findClosestTag(
    candidate: EdgeSelectionInfo,
    tolMm: number,
  ): SemanticTag | null {
    const tolSq = tolMm * tolMm;
    for (const [tag, sels] of this.byTag) {
      for (const s of sels) {
        // Fast path — (near-)coincident click points (an unchanged edge).
        const dx = s.position[0] - candidate.position[0];
        const dy = s.position[1] - candidate.position[1];
        const dz = s.position[2] - candidate.position[2];
        if (dx * dx + dy * dy + dz * dz <= tolSq) return tag;
        // A boolean SPLIT yields fragments whose midpoints sit far from the
        // original click point, so point proximity alone misses them (the very
        // bug this module exists to fix). A fragment of the same edge is instead
        // identified by COLLINEARITY: parallel direction + lying on the original
        // edge's line, within its reach. That tags both halves of a split.
        if (fragmentLiesOnEdge(candidate, s, tolMm)) return tag;
      }
    }
    return null;
  }

  /** Diagnostic: how many tags currently hold > 1 selection? */
  splitCount(): number {
    let n = 0;
    for (const sels of this.byTag.values()) if (sels.length > 1) n++;
    return n;
  }

  /** Reset between pipeline runs. */
  clear(): void {
    this.byTag.clear();
  }

  /** Iterate all tags + their selections. */
  entries(): Array<[SemanticTag, EdgeSelectionInfo[]]> {
    return Array.from(this.byTag.entries());
  }
}
