/**
 * featureTreeIntentDetector — NL → PlanIntent regex-based classifier.
 *
 * Phase 1 of the Phase 3.AI multi-step planner: no LLM dependency, just
 * deterministic regex matching against a small command vocabulary. Returning
 * `null` means "regex didn't match" — callers (e.g., the LLM wrapper in
 * `featureTreeAssistantLlm` or a higher-level orchestrator) should treat
 * this as a signal to fall back to LLM-based intent extraction.
 *
 * Why pure regex first?
 *   - Zero latency / zero cost on the common command vocabulary.
 *   - Deterministic = unit-testable + cache-friendly.
 *   - Lets the LLM budget focus on the *long tail* of free-form NL prompts.
 *   - The LLM fallback can reuse the same PlanIntent schema (just emit
 *     {kind, …params}), so the planner is decoupled from intent extraction.
 *
 * Vocabulary covered (Phase 1):
 *   1. create_box_with_fillet
 *      - "(make|create) (a )?box <W>x<H>x<D> with (rounded edges|fillet) (radius )?<r>"
 *      - "<W>x<H>x<D> box with fillet <r>"
 *   2. create_box_with_holes
 *      - "(make|create) (a )?box <W>x<H>x<D> with (a )?(hole|holes)( <count>)?( diameter <d>)?"
 *   3. create_cylinder
 *      - "(make|create) (a )?cylinder (radius|r) <r> (height|h) <h>"
 *      - "cylinder <r>x<h>"
 *   4. add_fillet_to_last
 *      - "add (a )?fillet( radius)? <r>"
 *      - "(round|fillet) (the )?(last |top |all )?edges?( radius)? <r>"
 *   5. add_chamfer_to_last
 *      - "add (a )?chamfer( distance)? <d>"
 *      - "(bevel|chamfer) (the )?(last |top |all )?edges?( distance)? <d>"
 *   6. create_assembly_stack
 *      - "create <n> stacked parts"
 *      - "<n> part assembly"
 *      - "stack <n> parts"
 *
 * LLM integration point (for the wrapper that calls this module):
 *   - `detectIntent(text) === null` ⇒ pass `text` to the LLM, asking for a
 *     JSON-encoded PlanIntent (the LLM prompt template can list the 6 kinds
 *     verbatim from `INTENT_KINDS` below).
 *   - LLM's JSON output is then handed to `planFromIntent` from the planner.
 *   - This module never calls an LLM directly — keeps it pure + testable.
 */

import type { PlanIntent } from './featureTreePlanner';

/** Enumerated for the LLM-fallback prompt template + UI dropdowns. */
export const INTENT_KINDS = [
  'create_box_with_holes',
  'create_box_with_fillet',
  'create_cylinder',
  'add_fillet_to_last',
  'add_chamfer_to_last',
  'create_assembly_stack',
  // ── Phase 3.AI.2 — 6 additional kinds ──────────────────────────────────
  'create_box_with_chamfer',
  'create_box_with_pocket',
  'create_cylinder_with_hole',
  'create_pattern_grid',
  'create_revolve_axis',
  'add_pattern_to_last',
] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

/**
 * Detect a PlanIntent from a free-form natural-language string.
 * Returns null when no regex matches — caller should fall back to an LLM.
 */
export function detectIntent(input: string): PlanIntent | null {
  const text = input.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  // Order matters: more specific patterns first.
  // Phase 3.AI.2 additions are tried *before* their single-feature counterparts
  // when they share keywords (e.g., "box ... with pocket" before "box ... fillet").
  return (
    matchCreateBoxWithPocket(lower) ??
    matchCreateBoxWithChamfer(lower) ??
    matchCreateBoxWithFillet(lower) ??
    matchCreateBoxWithHoles(lower) ??
    matchCreatePatternGrid(lower) ??
    matchCreateCylinderWithHole(lower) ??
    matchCreateCylinder(lower) ??
    matchCreateRevolveAxis(lower) ??
    matchAssemblyStack(lower) ??
    matchAddPatternToLast(lower) ??
    matchAddFilletToLast(lower) ??
    matchAddChamferToLast(lower) ??
    null
  );
}

// ─── Per-intent matchers ─────────────────────────────────────────────────

/**
 * "create a box 50x50x30 with rounded edges radius 5"
 * "make box 50 x 50 x 30 with fillet 5"
 * "box 50x50x30 fillet 5"
 */
function matchCreateBoxWithFillet(t: string): PlanIntent | null {
  // First locate WxHxD dimensions; then look for fillet/round keyword + r.
  const dims = matchBoxDims(t);
  if (!dims) return null;
  const filletPat =
    /(?:rounded\s+edges?|fillet|round)\s*(?:radius|r)?\s*(\d+(?:\.\d+)?)/;
  const m = t.match(filletPat);
  if (!m) return null;
  const radius = Number(m[1]!);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return {
    kind: 'create_box_with_fillet',
    size: dims,
    filletRadius: radius,
  };
}

/**
 * "create a box 50x50x30 with 4 holes diameter 6"
 * "make box 100x100x20 with hole diameter 10"
 */
function matchCreateBoxWithHoles(t: string): PlanIntent | null {
  const dims = matchBoxDims(t);
  if (!dims) return null;
  if (!/\bholes?\b/.test(t)) return null;
  // Optional count + diameter.
  const countMatch = t.match(/(\d+)\s+holes?/);
  const diaMatch = t.match(/(?:diameter|dia|d)\s*(\d+(?:\.\d+)?)/);
  const count = countMatch ? Number(countMatch[1]!) : 1;
  const diameter = diaMatch ? Number(diaMatch[1]!) : 6;
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!Number.isFinite(diameter) || diameter <= 0) return null;
  // Place holes in a row along x, evenly spaced.
  const holes: Array<{ x: number; y: number; diameter: number }> = [];
  const stepX = dims.x / (count + 1);
  for (let i = 0; i < count; i++) {
    holes.push({ x: stepX * (i + 1), y: dims.y / 2, diameter });
  }
  return { kind: 'create_box_with_holes', size: dims, holes };
}

/**
 * "create a cylinder radius 25 height 60"
 * "cylinder r 10 h 20"
 * "cylinder 25x60"  (radius x height shorthand)
 */
function matchCreateCylinder(t: string): PlanIntent | null {
  if (!/\bcylinder\b/.test(t)) return null;
  // radius/height keyword form
  const rMatch = t.match(/(?:radius|r)\s*(\d+(?:\.\d+)?)/);
  const hMatch = t.match(/(?:height|h)\s*(\d+(?:\.\d+)?)/);
  if (rMatch && hMatch) {
    const radius = Number(rMatch[1]!);
    const height = Number(hMatch[1]!);
    if (Number.isFinite(radius) && radius > 0 && Number.isFinite(height) && height > 0) {
      return { kind: 'create_cylinder', radius, height };
    }
  }
  // "cylinder 25x60" shorthand — only matches when there's no third dim
  // (otherwise it would be a box).
  const shortMatch = t.match(/cylinder\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?!\s*x)/);
  if (shortMatch) {
    const radius = Number(shortMatch[1]!);
    const height = Number(shortMatch[2]!);
    if (Number.isFinite(radius) && radius > 0 && Number.isFinite(height) && height > 0) {
      return { kind: 'create_cylinder', radius, height };
    }
  }
  return null;
}

/**
 * "add fillet 5"
 * "fillet radius 3"
 * "round all edges 2"
 */
function matchAddFilletToLast(t: string): PlanIntent | null {
  // Reject if there's a box dimension triple (delegated to box matcher).
  if (matchBoxDims(t)) return null;
  // Reject "cylinder ..." since cylinder takes precedence.
  if (/\bcylinder\b/.test(t)) return null;
  // Reject prompts that mention "box" — they're partial/malformed box
  // creation prompts (a real box prompt would have matched matchBoxDims).
  if (/\bbox\b/.test(t)) return null;
  const pat =
    /(?:^|\b)(?:add\s+(?:a\s+)?fillet|fillet|round)\s+(?:radius\s+|r\s*)?(?:(?:all|the|last|top)\s+edges?\s+)?(?:radius\s+|r\s*)?(\d+(?:\.\d+)?)/;
  const m = t.match(pat);
  if (!m) {
    // "round all edges radius 5" — alternate ordering.
    const alt = t.match(
      /(?:round|fillet)\s+(?:all|the|last|top)\s+edges?\s+(?:radius\s+|r\s*)?(\d+(?:\.\d+)?)/,
    );
    if (!alt) return null;
    const radius = Number(alt[1]!);
    if (!Number.isFinite(radius) || radius <= 0) return null;
    return { kind: 'add_fillet_to_last', radius };
  }
  const radius = Number(m[1]!);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return { kind: 'add_fillet_to_last', radius };
}

/**
 * "add chamfer 3"
 * "chamfer distance 2"
 * "bevel all edges 1.5"
 */
function matchAddChamferToLast(t: string): PlanIntent | null {
  if (matchBoxDims(t)) return null;
  if (/\bcylinder\b/.test(t)) return null;
  // Reject partial/malformed box prompts — see matchAddFilletToLast.
  if (/\bbox\b/.test(t)) return null;
  const pat =
    /(?:^|\b)(?:add\s+(?:a\s+)?chamfer|chamfer|bevel)\s+(?:distance\s+|d\s*)?(?:(?:all|the|last|top)\s+edges?\s+)?(?:distance\s+|d\s*)?(\d+(?:\.\d+)?)/;
  const m = t.match(pat);
  if (!m) {
    const alt = t.match(
      /(?:chamfer|bevel)\s+(?:all|the|last|top)\s+edges?\s+(?:distance\s+|d\s*)?(\d+(?:\.\d+)?)/,
    );
    if (!alt) return null;
    const distance = Number(alt[1]!);
    if (!Number.isFinite(distance) || distance <= 0) return null;
    return { kind: 'add_chamfer_to_last', distance };
  }
  const distance = Number(m[1]!);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  return { kind: 'add_chamfer_to_last', distance };
}

/**
 * "create 3 stacked parts"
 * "stack 4 parts"
 * "3 part assembly"
 * Optional: "spaced 5"
 */
function matchAssemblyStack(t: string): PlanIntent | null {
  const stackPat =
    /(?:create\s+|stack\s+)?(\d+)\s+(?:stacked\s+parts?|part\s+(?:stack|assembly)|parts?\s+(?:stack|assembly|stacked))/;
  const altPat = /stack\s+(\d+)\s+parts?/;
  const m = t.match(stackPat) ?? t.match(altPat);
  if (!m) return null;
  const partCount = Number(m[1]!);
  if (!Number.isInteger(partCount) || partCount <= 0) return null;
  const spaceMatch = t.match(/(?:spaced|spacing)\s+(\d+(?:\.\d+)?)/);
  const spacing = spaceMatch ? Number(spaceMatch[1]!) : 10;
  if (!Number.isFinite(spacing) || spacing < 0) return null;
  return { kind: 'create_assembly_stack', partCount, spacing };
}

// ─── Phase 3.AI.2 — 6 additional matchers ───────────────────────────────

/**
 * "box 50x50x30 chamfer 2"
 * "create box 80x40x20 with chamfer distance 3"
 * "make a box 100x100x10 with chamfered edges 1.5"
 */
function matchCreateBoxWithChamfer(t: string): PlanIntent | null {
  const dims = matchBoxDims(t);
  if (!dims) return null;
  // Disambiguate against pocket/fillet prompts that may include "chamfer"
  // accidentally — those are matched by their own matchers above.
  if (/\bpocket\b/.test(t)) return null;
  if (/\bfillet\b|\brounded\s+edges?\b/.test(t)) return null;
  const pat =
    /(?:chamfer(?:ed\s+edges?)?|bevel)\s*(?:distance|d)?\s*(\d+(?:\.\d+)?)/;
  const m = t.match(pat);
  if (!m) return null;
  const distance = Number(m[1]!);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  return {
    kind: 'create_box_with_chamfer',
    size: dims,
    chamferDistance: distance,
  };
}

/**
 * "box 50x50x30 with pocket depth 10 radius 5"
 * "create box 100x100x20 pocket depth 5 r 8"
 */
function matchCreateBoxWithPocket(t: string): PlanIntent | null {
  const dims = matchBoxDims(t);
  if (!dims) return null;
  if (!/\bpocket\b/.test(t)) return null;
  const depthMatch = t.match(/depth\s+(\d+(?:\.\d+)?)/);
  const radiusMatch = t.match(/(?:radius|r)\s+(\d+(?:\.\d+)?)/);
  if (!depthMatch || !radiusMatch) return null;
  const pocketDepth = Number(depthMatch[1]!);
  const pocketRadius = Number(radiusMatch[1]!);
  if (!Number.isFinite(pocketDepth) || pocketDepth <= 0) return null;
  if (!Number.isFinite(pocketRadius) || pocketRadius <= 0) return null;
  return {
    kind: 'create_box_with_pocket',
    size: dims,
    pocketDepth,
    pocketRadius,
  };
}

/**
 * "cylinder 25 60 with hole 10"
 * "create cylinder radius 25 height 60 hole 10"
 * "cylinder 25x60 with hole radius 10"
 */
function matchCreateCylinderWithHole(t: string): PlanIntent | null {
  if (!/\bcylinder\b/.test(t)) return null;
  if (!/\bhole\b/.test(t)) return null;
  // Locate radius/height first.
  let radius: number | null = null;
  let height: number | null = null;
  const rMatch = t.match(/(?:radius|r)\s*(\d+(?:\.\d+)?)/);
  const hMatch = t.match(/(?:height|h)\s*(\d+(?:\.\d+)?)/);
  if (rMatch && hMatch) {
    radius = Number(rMatch[1]!);
    height = Number(hMatch[1]!);
  } else {
    // Shorthand: "cylinder 25 60" or "cylinder 25x60"
    const short = t.match(/cylinder\s+(\d+(?:\.\d+)?)\s*(?:x|\s)\s*(\d+(?:\.\d+)?)/);
    if (short) {
      radius = Number(short[1]!);
      height = Number(short[2]!);
    }
  }
  if (radius === null || height === null) return null;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  // Hole radius: explicit "hole 10" or "hole radius 10" or "hole r 10".
  const holeMatch = t.match(/hole\s+(?:radius\s+|r\s*)?(\d+(?:\.\d+)?)/);
  if (!holeMatch) return null;
  const holeRadius = Number(holeMatch[1]!);
  if (!Number.isFinite(holeRadius) || holeRadius <= 0) return null;
  return {
    kind: 'create_cylinder_with_hole',
    radius,
    height,
    holeRadius,
  };
}

/**
 * "grid 3x3 cubes spacing 100"
 * "create grid 4x2 cylinders spacing 50"
 * "5x5 grid of cubes spacing 10"
 */
function matchCreatePatternGrid(t: string): PlanIntent | null {
  if (!/\bgrid\b/.test(t)) return null;
  const gridMatch = t.match(/(\d+)\s*x\s*(\d+)/);
  if (!gridMatch) return null;
  const cx = Number(gridMatch[1]!);
  const cy = Number(gridMatch[2]!);
  if (!Number.isInteger(cx) || cx <= 0) return null;
  if (!Number.isInteger(cy) || cy <= 0) return null;
  const spaceMatch = t.match(/spacing\s+(\d+(?:\.\d+)?)/);
  if (!spaceMatch) return null;
  const spacing = Number(spaceMatch[1]!);
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  // Base feature: "cubes"/"box" → extrude_box, "cylinders" → cylinder.
  let baseFeature: 'extrude_box' | 'cylinder' = 'extrude_box';
  if (/\bcylinders?\b/.test(t)) baseFeature = 'cylinder';
  else if (/\b(?:cubes?|boxes?)\b/.test(t)) baseFeature = 'extrude_box';
  else return null; // require explicit shape keyword
  return {
    kind: 'create_pattern_grid',
    baseFeature,
    count: { x: cx, y: cy },
    spacing,
  };
}

/**
 * "revolve triangle 25 60"
 * "revolve rectangle radius 30 height 80"
 * "create a revolve of triangle r 10 h 20"
 */
function matchCreateRevolveAxis(t: string): PlanIntent | null {
  if (!/\brevolve\b/.test(t)) return null;
  let profile: 'rectangle' | 'triangle' | null = null;
  if (/\btriangle\b/.test(t)) profile = 'triangle';
  else if (/\brectangle\b|\brect\b/.test(t)) profile = 'rectangle';
  if (!profile) return null;
  let radius: number | null = null;
  let height: number | null = null;
  const rMatch = t.match(/(?:radius|r)\s*(\d+(?:\.\d+)?)/);
  const hMatch = t.match(/(?:height|h)\s*(\d+(?:\.\d+)?)/);
  if (rMatch && hMatch) {
    radius = Number(rMatch[1]!);
    height = Number(hMatch[1]!);
  } else {
    // Shorthand: "revolve triangle 25 60" — first 2 bare numbers after
    // the profile word.
    const short = t.match(
      new RegExp(`${profile}\\s+(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)`),
    );
    if (short) {
      radius = Number(short[1]!);
      height = Number(short[2]!);
    }
  }
  if (radius === null || height === null) return null;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  return {
    kind: 'create_revolve_axis',
    profile,
    radius,
    height,
  };
}

/**
 * "linear pattern 5 spacing 50"
 * "circular pattern 8 around 360"
 * "circular pattern 6"  (default 360°)
 * "linear pattern 4 spacing 25 mm"
 */
function matchAddPatternToLast(t: string): PlanIntent | null {
  // Reject if a box dimension triple is present (delegated to box matchers).
  if (matchBoxDims(t)) return null;
  // Reject grid prompts (handled by matchCreatePatternGrid).
  if (/\bgrid\b/.test(t)) return null;
  const linMatch = t.match(/linear\s+pattern\s+(\d+)/);
  if (linMatch) {
    const count = Number(linMatch[1]!);
    if (!Number.isInteger(count) || count < 2) return null;
    const spaceMatch = t.match(/spacing\s+(\d+(?:\.\d+)?)/);
    if (!spaceMatch) return null;
    const spacing = Number(spaceMatch[1]!);
    if (!Number.isFinite(spacing) || spacing <= 0) return null;
    return {
      kind: 'add_pattern_to_last',
      patternKind: 'linear',
      count,
      spacing,
    };
  }
  const cirMatch = t.match(/circular\s+pattern\s+(\d+)/);
  if (cirMatch) {
    const count = Number(cirMatch[1]!);
    if (!Number.isInteger(count) || count < 2) return null;
    const angleMatch = t.match(/(?:around|angle)\s+(\d+(?:\.\d+)?)/);
    const angle = angleMatch ? Number(angleMatch[1]!) : 360;
    if (!Number.isFinite(angle) || angle <= 0 || angle > 360) return null;
    return {
      kind: 'add_pattern_to_last',
      patternKind: 'circular',
      count,
      angle,
    };
  }
  return null;
}

// ─── Shared sub-pattern matchers ─────────────────────────────────────────

/**
 * Box dimension matcher: "50x50x30", "50 x 50 x 30", "50by50by30".
 * Returns { x, y, z } or null. Lower-case input expected.
 */
function matchBoxDims(t: string): { x: number; y: number; z: number } | null {
  const m = t.match(
    /(\d+(?:\.\d+)?)\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/,
  );
  if (!m) return null;
  const x = Number(m[1]!);
  const y = Number(m[2]!);
  const z = Number(m[3]!);
  if (!Number.isFinite(x) || x <= 0) return null;
  if (!Number.isFinite(y) || y <= 0) return null;
  if (!Number.isFinite(z) || z <= 0) return null;
  return { x, y, z };
}
