/**
 * referenceGeometry/ksConventions.ts — Korean Industrial Standards
 * (KS A 0005 / KS B 0001) datum-label conventions for reference geometry.
 *
 * Wave 2 Phase 2 Track D Week 4. Spec §11 / §13.5.
 *
 * Background:
 *
 *   - **KS A 0005** ("일반 도면 통칙" — general engineering drawing rules)
 *     defines the typographic conventions for drawing symbols, including
 *     datum-feature designators displayed in a square / rectangular box.
 *   - **KS B 0001** ("기계 제도" — mechanical drawing) inherits A 0005 and
 *     specialises datum-frame conventions for machine parts: datum
 *     features are labelled with single capital letters A, B, C, … in
 *     order of importance, drawn inside a square frame and connected to
 *     the feature with a triangle.
 *
 * What this module ships:
 *
 *   - `ksDatumLabel(node, index)` — returns the KS-style label string for
 *     a reference-geometry node when KS conventions are enabled. The
 *     index is the node's creation-order rank within its kind (plane=A,
 *     axis=A', etc.), giving each datum a stable letter assignment.
 *   - `KS_DATUM_LETTERS` — the ordered alphabet (A..Z, then AA..AZ for
 *     overflow per KS A 0005 §6.4).
 *   - `formatKsDatumDisplay(label, ksLabel)` — composes the row display
 *     `"[A] Front offset 30mm"` style with the KS letter prefixed in
 *     brackets. Pure string — no React.
 *
 * Why a separate module (not inline in the tree row):
 *
 *   - KS conventions also apply to the eventual Drawing module (Phase 4
 *     per spec §13.5) and to STEP export labels. Keeping the alphabet
 *     and helper math here lets both the tree section and the future
 *     drawing pass share a single source of truth.
 *   - Toggling KS off (e.g. for a Japanese or US-market deploy) is a
 *     single boolean flag at the call-site — no fork of the tree
 *     rendering code.
 *
 * Per-kind alphabets (KS B 0001 §7.3 — different datum types take
 * different letter pools so a drawing can show "Plane A / Axis B'" side
 * by side without ambiguity):
 *
 *   - Plane: A, B, C, … (plain capitals)
 *   - Axis: A', B', C', … (capitals with prime marker)
 *   - Point: a, b, c, … (lower-case to denote point datum)
 *   - CSys: [A], [B], [C], … (capitals in square brackets per the KS
 *     coordinate-system convention)
 *
 * This separation matches what the Drawing module will need when it
 * renders datum-feature triangles in Phase 4.
 */

import type { ReferenceKind, ReferenceNode } from './types';

/** Ordered alphabet for KS datum labels. A..Z covers the typical part
 *  (max ~26 datums of a single kind); past that we fall back to AA, AB,
 *  AC, … which is uncommon but matches the KS A 0005 §6.4 wording. */
export const KS_DATUM_LETTERS: readonly string[] = (() => {
  const single: string[] = [];
  for (let i = 0; i < 26; i += 1) single.push(String.fromCharCode(65 + i));
  // Overflow doubles. Capped at 26*26 = 702 datums per kind, which is
  // well past any realistic part.
  const double: string[] = [];
  for (let i = 0; i < 26; i += 1) {
    for (let j = 0; j < 26; j += 1) {
      double.push(`${String.fromCharCode(65 + i)}${String.fromCharCode(65 + j)}`);
    }
  }
  return [...single, ...double];
})();

/** Index → KS letter for the given kind. Returns the letter for `index`
 *  in the per-kind alphabet (Plane: A, Axis: A', Point: a, CSys: [A]).
 *
 *  Index is 0-based. Beyond 702 the index wraps modulo the alphabet
 *  length — practically unreachable but safe. */
export function ksDatumLetterForIndex(kind: ReferenceKind, index: number): string {
  const i = Math.max(0, index) % KS_DATUM_LETTERS.length;
  const base = KS_DATUM_LETTERS[i];
  switch (kind) {
    case 'plane':
      return base;
    case 'axis':
      return `${base}'`;
    case 'point':
      return base.toLowerCase();
    case 'csys':
      return `[${base}]`;
  }
}

/** Build a kind → (nodeId → label) lookup from an ordered node list.
 *
 *  Each kind gets its own running index (so the first axis is `A'`
 *  regardless of how many planes precede it). The caller passes nodes in
 *  creation order — usually the same order the tree section iterates,
 *  which is what `useReferenceNodesAdapter.orderedNodes` produces. */
export function buildKsDatumLabels(
  nodes: readonly ReferenceNode[],
): ReadonlyMap<string, string> {
  const counters: Record<ReferenceKind, number> = {
    plane: 0,
    axis: 0,
    point: 0,
    csys: 0,
  };
  const out = new Map<string, string>();
  for (const n of nodes) {
    const idx = counters[n.kind];
    out.set(n.id, ksDatumLetterForIndex(n.kind, idx));
    counters[n.kind] += 1;
  }
  return out;
}

/** Convenience: look up the KS letter for a single node given the full
 *  ordered list. O(N) — for large lists, prefer pre-building the map via
 *  `buildKsDatumLabels` and reusing it. */
export function ksDatumLabel(
  node: ReferenceNode,
  orderedNodes: readonly ReferenceNode[],
): string | null {
  let index = -1;
  let found = false;
  for (const candidate of orderedNodes) {
    if (candidate.kind !== node.kind) continue;
    index += 1;
    if (candidate.id === node.id) {
      found = true;
      break;
    }
  }
  if (!found) return null;
  return ksDatumLetterForIndex(node.kind, index);
}

/** Compose a display string for a row showing the KS datum letter
 *  followed by the human label. Used by `ReferenceGeometryTreeSection`
 *  and the dialog method-list when `useKsConventions` is on.
 *
 *  Examples:
 *    formatKsDatumDisplay('A', 'Offset Plane 1')   → 'A · Offset Plane 1'
 *    formatKsDatumDisplay("B'", 'Axis from edge')  → "B' · Axis from edge"
 *    formatKsDatumDisplay(null, 'Offset Plane 1')  → 'Offset Plane 1'
 *
 *  We use a middle-dot separator (U+00B7) rather than a colon because
 *  KS A 0005 doesn't dictate a separator and the dot reads cleanly in
 *  both KR/EN. */
export function formatKsDatumDisplay(
  ksLetter: string | null | undefined,
  humanLabel: string,
): string {
  if (ksLetter === null || ksLetter === undefined || ksLetter === '') {
    return humanLabel;
  }
  return `${ksLetter} · ${humanLabel}`;
}

/** Default flag — true for the Korean market per the project task
 *  description ("default true for Korean market, configurable"). Call
 *  sites read this when they don't otherwise have a value to thread
 *  through.
 *
 *  When the host wires in a UI store toggle (e.g. via uiStore), that
 *  takes priority over this default. */
export const DEFAULT_USE_KS_CONVENTIONS = true;
