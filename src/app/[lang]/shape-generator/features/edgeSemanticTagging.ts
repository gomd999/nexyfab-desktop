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
        const dx = s.position[0] - candidate.position[0];
        const dy = s.position[1] - candidate.position[1];
        const dz = s.position[2] - candidate.position[2];
        if (dx * dx + dy * dy + dz * dz <= tolSq) return tag;
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
