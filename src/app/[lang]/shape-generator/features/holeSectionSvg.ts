/**
 * Pure SVG cross-section generator for the Hole Wizard Preview tab.
 *
 * Phase 2 Week 3 Track C3 deliverable. The Preview tab (Tab 5 in
 * `HoleWizardModalV2`) renders a 2D schematic of the hole — drill profile,
 * counterbore pocket, countersink funnel, and the termination shape (flat /
 * conical / through). This file produces the geometric primitives only; the
 * React component wraps them in an `<svg>` element with labels.
 *
 * Why SVG (not Three.js)?  Spec §6.1.5 specifies a 2D schematic, ≤ 200×120 px,
 * < 50 ms per redraw. SVG keeps the modal cheap to mount in jsdom (tests run
 * synchronously) and avoids spinning up a WebGL context every time the user
 * tweaks the depth slider. Production preview redraws are O(handful) per second
 * in the worst case.
 *
 * Coordinate system:
 *   - +X = horizontal (width of the schematic)
 *   - +Y = vertical, **points down** (matches SVG convention)
 *   - origin at the top-left of the canvas
 *   - the "top face" of the part is at y=topMargin; the bore extends down
 *
 * All inputs are mm; the renderer scales mm → px via the `pxPerMm` field
 * on the layout so the same calculation can be used for the inline modal
 * preview *and* a larger zoomed view (if a future review tab wants one).
 */

import type {
  HoleSpec,
  TerminationParams,
  BlindBottomShape,
} from './holeArray';

// ─── Layout config ─────────────────────────────────────────────────────────

export interface SectionLayout {
  /** Canvas width in px (inline modal default: 220). */
  width: number;
  /** Canvas height in px (inline modal default: 160). */
  height: number;
  /** Pixels per mm. Computed from `width / boundingDiameterMm * 0.55`. */
  pxPerMm: number;
  /** Top margin (px) — distance from canvas top to part top face. */
  topMargin: number;
  /** Bottom margin (px) — distance from canvas bottom to part bottom face (through-all only). */
  bottomMargin: number;
}

/**
 * Approximate body context — bounding box hint for the through-all path.
 * Spec §6.1.5 shows the part top-and-bottom faces; without a body context
 * we default to a 30 mm-thick generic plate so the schematic still renders.
 */
export interface BodyContext {
  /** Plate / body thickness along the hole axis (mm). */
  thicknessMm: number;
}

/** Default body context used when the caller doesn't supply one. */
export const DEFAULT_BODY_CONTEXT: BodyContext = { thicknessMm: 30 };

// ─── Primitive geometry types ──────────────────────────────────────────────

export interface SvgLine {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Optional style hint. */
  className?: 'part-edge' | 'hole-edge' | 'centerline' | 'dim';
}

export interface SvgPolyline {
  kind: 'polyline';
  points: Array<{ x: number; y: number }>;
  className?: 'hole-edge' | 'part-edge';
  closed?: boolean;
}

export interface SvgLabel {
  kind: 'label';
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  className?: 'dim' | 'annotation';
}

/** Discriminated SVG primitive for the Preview tab to map → `<line>` / `<text>`. */
export type SvgElement = SvgLine | SvgPolyline | SvgLabel;

export interface SvgElements {
  /** Layout metadata for the wrapping `<svg>` element. */
  layout: SectionLayout;
  /** Centerline X coordinate (the vertical axis the hole is mirrored around). */
  centerX: number;
  /** Y of the part top face. */
  partTopY: number;
  /** Y of the part bottom face (for through-all rendering). */
  partBottomY: number;
  /** All primitives in render order: part outline first, hole second, labels last. */
  elements: SvgElement[];
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function computeLayout(spec: HoleSpec, body: BodyContext): SectionLayout {
  // The widest mm dimension drives the scale. For drilled holes that's the
  // bore ⌀; for counterbore / counterdrill it's the head ⌀; for countersink
  // it's the cone ⌀. We add 4 mm padding on each side so the part outline
  // doesn't kiss the canvas edge.
  let widest = spec.diameter;
  if (spec.kind === 'counterbore' || spec.kind === 'counterdrill') {
    widest = Math.max(widest, spec.headDiameter);
  }
  if (spec.kind === 'countersink') {
    widest = Math.max(widest, spec.coneDiameter);
  }
  const partHalfWidthMm = widest + 8; // 4 mm padding each side, doubled
  const partHeightMm = body.thicknessMm;

  const width = 220;
  const height = 160;
  const topMargin = 14;
  const bottomMargin = 14;
  const availableX = width - 60; // leave room for dim labels on right
  const availableY = height - topMargin - bottomMargin;

  // Fit the part into the available canvas — pick the *smaller* scale so
  // both axes fit. mm per pixel along X and Y respectively.
  const pxPerMmX = availableX / Math.max(partHalfWidthMm * 2, 1);
  const pxPerMmY = availableY / Math.max(partHeightMm, 1);
  const pxPerMm = Math.min(pxPerMmX, pxPerMmY);

  return { width, height, pxPerMm, topMargin, bottomMargin };
}

function mmToPx(mm: number, layout: SectionLayout): number {
  return mm * layout.pxPerMm;
}

/**
 * Compute the visible bore depth in mm given the termination params + body
 * context. For `through` we return the full plate thickness so the bore
 * runs end-to-end; for `blind` we use the depth; for `upToNext` / `upToFace`
 * we render at 60% thickness as a visual cue (the real face-pick happens
 * at the worker, post-W4).
 */
function resolveBoreDepthMm(
  term: TerminationParams,
  body: BodyContext,
): number {
  switch (term.kind) {
    case 'through':
      return body.thicknessMm;
    case 'blind':
      return Math.max(0.1, term.depth);
    case 'upToNext':
    case 'upToFace':
      return body.thicknessMm * 0.6;
  }
}

/**
 * Resolve the effective blind bottom shape + apex angle. Defaults match
 * spec §2.1: bottomShape='conical', drillTipAngle=118.
 */
function resolveBlindBottom(term: TerminationParams): {
  shape: BlindBottomShape;
  apexAngleDeg: number;
} {
  if (term.kind !== 'blind') return { shape: 'flat', apexAngleDeg: 180 };
  return {
    shape: term.bottomShape ?? 'conical',
    apexAngleDeg: term.drillTipAngle ?? 118,
  };
}

/**
 * Cone tip extension (mm) below the cylindrical bore for a conical drill bottom.
 * Geometry: half the diameter divided by tan(half-apex-angle).
 */
function coneTipExtensionMm(diameter: number, apexAngleDeg: number): number {
  if (apexAngleDeg >= 180) return 0;
  const half = (apexAngleDeg * Math.PI) / 180 / 2;
  const t = Math.tan(half);
  if (t <= 0) return 0;
  return diameter / 2 / t;
}

/**
 * Countersink funnel depth (mm). Geometry: half the cone-face diameter
 * divided by tan(half-included-angle).
 */
export function countersinkFunnelDepthMm(
  coneDiameter: number,
  coneAngleDeg: number,
): number {
  if (coneAngleDeg <= 0 || coneAngleDeg >= 180) return 0;
  const half = (coneAngleDeg * Math.PI) / 180 / 2;
  const t = Math.tan(half);
  if (t <= 0) return 0;
  return coneDiameter / 2 / t;
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Compute the SVG element list for a hole-spec + termination combination.
 *
 * Pure function — no DOM, no state, no async. Output is the full primitive
 * list the Preview tab maps over. Re-running with the same inputs produces
 * an identical result.
 *
 * Layout strategy:
 *   1. Pick a scale that fits the widest hole feature + part thickness.
 *   2. Draw the part outline as two horizontal rules (top + bottom face).
 *   3. Draw the hole profile (mirror around centerline):
 *      - drilled  : two vertical edges + bottom (flat / conical / open)
 *      - counterbore: top "shoulder" rectangle + inner drill profile
 *      - countersink: top wedge funnel + inner drill profile
 *   4. Add dimension labels with anchor tuned to keep them inside the canvas.
 *
 * The cross-section is **mirror-symmetric** by construction; we compute one
 * side and the renderer can either mirror at render time or emit explicit
 * left + right primitives. We choose the explicit form so the test suite
 * can count line primitives deterministically.
 */
export function computeHoleSectionSvg(
  spec: HoleSpec,
  term: TerminationParams,
  body: BodyContext = DEFAULT_BODY_CONTEXT,
): SvgElements {
  const layout = computeLayout(spec, body);
  const centerX = layout.width * 0.4; // shift left so labels fit on right
  const partTopY = layout.topMargin;
  const thicknessPx = mmToPx(body.thicknessMm, layout);
  const partBottomY = partTopY + thicknessPx;
  const elements: SvgElement[] = [];

  // Estimate part rectangle half-width so the "top face" line spans the
  // visible region (not the entire canvas) — gives a clearer schematic.
  const partHalfMm = Math.max(
    spec.diameter,
    spec.kind === 'counterbore' || spec.kind === 'counterdrill' ? spec.headDiameter : 0,
    spec.kind === 'countersink' ? spec.coneDiameter : 0,
  ) + 6;
  const partHalfPx = mmToPx(partHalfMm, layout);
  const partLeftX = centerX - partHalfPx;
  const partRightX = centerX + partHalfPx;

  // ── Part outline (top + bottom face) ─────────────────────────────────────
  elements.push({
    kind: 'line',
    x1: partLeftX,
    y1: partTopY,
    x2: partRightX,
    y2: partTopY,
    className: 'part-edge',
  });
  if (term.kind === 'through') {
    elements.push({
      kind: 'line',
      x1: partLeftX,
      y1: partBottomY,
      x2: partRightX,
      y2: partBottomY,
      className: 'part-edge',
    });
  } else {
    // Blind / upToNext / upToFace — still draw the bottom face so the part
    // looks like a part. The bore stops above it.
    elements.push({
      kind: 'line',
      x1: partLeftX,
      y1: partBottomY,
      x2: partRightX,
      y2: partBottomY,
      className: 'part-edge',
    });
  }

  // Centerline (dashed in renderer, just tagged here).
  elements.push({
    kind: 'line',
    x1: centerX,
    y1: partTopY - 6,
    x2: centerX,
    y2: partBottomY + 6,
    className: 'centerline',
  });

  // ── Bore profile ─────────────────────────────────────────────────────────
  // Compute the bottom-of-bore Y. For conical-blind the cylindrical part
  // ends `coneTipExtensionMm(diameter, apex)` *above* the depth limit so
  // the tip cone reaches that depth at its apex. For flat-bottomed blind
  // the cylinder ends at depth, and the cone is suppressed.
  const drillDiameter = spec.diameter;
  const boreHalfMm = drillDiameter / 2;
  const boreHalfPx = mmToPx(boreHalfMm, layout);

  // Counterbore / countersink prelude — the drilled bore starts deeper.
  let boreTopY = partTopY;
  if (spec.kind === 'counterbore' || spec.kind === 'counterdrill') {
    const headHalfPx = mmToPx(spec.headDiameter / 2, layout);
    const headDepthPx = mmToPx(spec.headDepth, layout);

    // Pocket profile: from top face, go down headDepth on either side; the
    // floor is at boreTopY = partTopY + headDepth.
    boreTopY = partTopY + headDepthPx;

    // Left wall + floor + right wall (closed top via the part-edge above)
    elements.push({
      kind: 'line',
      x1: centerX - headHalfPx,
      y1: partTopY,
      x2: centerX - headHalfPx,
      y2: boreTopY,
      className: 'hole-edge',
    });
    elements.push({
      kind: 'line',
      x1: centerX + headHalfPx,
      y1: partTopY,
      x2: centerX + headHalfPx,
      y2: boreTopY,
      className: 'hole-edge',
    });
    // Floor: from pocket wall to bore wall (both sides)
    elements.push({
      kind: 'line',
      x1: centerX - headHalfPx,
      y1: boreTopY,
      x2: centerX - boreHalfPx,
      y2: boreTopY,
      className: 'hole-edge',
    });
    elements.push({
      kind: 'line',
      x1: centerX + headHalfPx,
      y1: boreTopY,
      x2: centerX + boreHalfPx,
      y2: boreTopY,
      className: 'hole-edge',
    });

    // Counterdrill middle step (extends the pocket pattern with a third
    // diameter between head and bore).
    if (spec.kind === 'counterdrill') {
      const midHalfPx = mmToPx(spec.middleDiameter / 2, layout);
      const midDepthPx = mmToPx(spec.middleDepth, layout);
      const midBottomY = partTopY + midDepthPx;
      // Walls dropping from head floor to mid floor
      elements.push({
        kind: 'line',
        x1: centerX - midHalfPx,
        y1: boreTopY,
        x2: centerX - midHalfPx,
        y2: midBottomY,
        className: 'hole-edge',
      });
      elements.push({
        kind: 'line',
        x1: centerX + midHalfPx,
        y1: boreTopY,
        x2: centerX + midHalfPx,
        y2: midBottomY,
        className: 'hole-edge',
      });
      // Mid floor → bore wall transitions
      elements.push({
        kind: 'line',
        x1: centerX - midHalfPx,
        y1: midBottomY,
        x2: centerX - boreHalfPx,
        y2: midBottomY,
        className: 'hole-edge',
      });
      elements.push({
        kind: 'line',
        x1: centerX + midHalfPx,
        y1: midBottomY,
        x2: centerX + boreHalfPx,
        y2: midBottomY,
        className: 'hole-edge',
      });
      boreTopY = midBottomY;
    }
  } else if (spec.kind === 'countersink') {
    // Funnel: top face has diameter = coneDiameter; bottom of funnel has
    // diameter = drillDiameter. Funnel depth derives from cone angle.
    const funnelDepthMm = countersinkFunnelDepthMm(
      spec.coneDiameter,
      spec.coneAngle,
    );
    const funnelDepthPx = mmToPx(funnelDepthMm, layout);
    const coneHalfPx = mmToPx(spec.coneDiameter / 2, layout);
    boreTopY = partTopY + funnelDepthPx;

    // Two slanted edges from top face down to bore wall start.
    elements.push({
      kind: 'line',
      x1: centerX - coneHalfPx,
      y1: partTopY,
      x2: centerX - boreHalfPx,
      y2: boreTopY,
      className: 'hole-edge',
    });
    elements.push({
      kind: 'line',
      x1: centerX + coneHalfPx,
      y1: partTopY,
      x2: centerX + boreHalfPx,
      y2: boreTopY,
      className: 'hole-edge',
    });
  }

  // ── Drilled bore (common to all kinds except pure cosmetic pipe_tap which
  // ──  still renders as a tapered tap — we treat pipe_tap as cylinder + tip).
  const boreDepthMm = resolveBoreDepthMm(term, body);
  const boreDepthPx = mmToPx(boreDepthMm, layout);

  let boreBottomY = boreTopY + boreDepthPx;
  // Clamp to part bottom for through-all so we don't overshoot.
  if (term.kind === 'through') {
    boreBottomY = partBottomY;
  }

  // Conical-tip extension for blind holes.
  const blindShape = resolveBlindBottom(term);
  let coneApexExtraMm = 0;
  if (term.kind === 'blind' && blindShape.shape === 'conical') {
    coneApexExtraMm = coneTipExtensionMm(spec.diameter, blindShape.apexAngleDeg);
  }
  const coneApexExtraPx = mmToPx(coneApexExtraMm, layout);

  // Cylindrical walls — left + right.
  // For conical blind, the cylinder ends at boreBottomY (the user-specified depth
  // is at the cylinder bottom; cone extends past that with the apex extra below).
  const cylinderBottomY = boreBottomY;
  elements.push({
    kind: 'line',
    x1: centerX - boreHalfPx,
    y1: boreTopY,
    x2: centerX - boreHalfPx,
    y2: cylinderBottomY,
    className: 'hole-edge',
  });
  elements.push({
    kind: 'line',
    x1: centerX + boreHalfPx,
    y1: boreTopY,
    x2: centerX + boreHalfPx,
    y2: cylinderBottomY,
    className: 'hole-edge',
  });

  // Bottom of bore — depends on termination.
  if (term.kind === 'through') {
    // No bottom line — the hole runs through; the part bottom face line
    // already shows the opening. No-op.
  } else if (term.kind === 'blind') {
    if (blindShape.shape === 'flat' || blindShape.apexAngleDeg >= 180) {
      // Flat bottom — a horizontal line across the bore.
      elements.push({
        kind: 'line',
        x1: centerX - boreHalfPx,
        y1: cylinderBottomY,
        x2: centerX + boreHalfPx,
        y2: cylinderBottomY,
        className: 'hole-edge',
      });
    } else {
      // Conical bottom — two slanted edges meeting at the apex below.
      const apexY = cylinderBottomY + coneApexExtraPx;
      elements.push({
        kind: 'line',
        x1: centerX - boreHalfPx,
        y1: cylinderBottomY,
        x2: centerX,
        y2: apexY,
        className: 'hole-edge',
      });
      elements.push({
        kind: 'line',
        x1: centerX + boreHalfPx,
        y1: cylinderBottomY,
        x2: centerX,
        y2: apexY,
        className: 'hole-edge',
      });
    }
  } else {
    // upToNext / upToFace — render a flat-bottomed schematic with a tag.
    elements.push({
      kind: 'line',
      x1: centerX - boreHalfPx,
      y1: cylinderBottomY,
      x2: centerX + boreHalfPx,
      y2: cylinderBottomY,
      className: 'hole-edge',
    });
  }

  // ── Dimension annotations ─────────────────────────────────────────────────
  // Ø diameter at the top of the bore (or pocket).
  const topAnnotY = Math.max(8, partTopY - 4);
  elements.push({
    kind: 'label',
    x: centerX,
    y: topAnnotY,
    text:
      spec.kind === 'counterbore' || spec.kind === 'counterdrill'
        ? `Ø${spec.headDiameter} × ${spec.headDepth}`
        : spec.kind === 'countersink'
          ? `Ø${spec.coneDiameter} × ${spec.coneAngle}°`
          : `Ø${spec.diameter}`,
    anchor: 'middle',
    className: 'dim',
  });
  // Drill ⌀ label inside / right of bore.
  if (spec.kind !== 'drilled') {
    elements.push({
      kind: 'label',
      x: centerX + boreHalfPx + 6,
      y: (boreTopY + cylinderBottomY) / 2,
      text: `Ø${spec.diameter}`,
      anchor: 'start',
      className: 'dim',
    });
  }
  // Depth label (right side).
  const depthLabel =
    term.kind === 'through'
      ? 'through'
      : term.kind === 'blind'
        ? `${term.depth} mm`
        : term.kind === 'upToNext'
          ? '→ next face'
          : '→ pinned face';
  elements.push({
    kind: 'label',
    x: layout.width - 4,
    y: (partTopY + partBottomY) / 2,
    text: depthLabel,
    anchor: 'end',
    className: 'dim',
  });

  return { layout, centerX, partTopY, partBottomY, elements };
}
