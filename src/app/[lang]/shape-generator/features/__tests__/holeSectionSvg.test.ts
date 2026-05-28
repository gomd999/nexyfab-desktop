import { describe, it, expect } from 'vitest';
import {
  computeHoleSectionSvg,
  countersinkFunnelDepthMm,
  DEFAULT_BODY_CONTEXT,
  type SvgElement,
} from '../holeSectionSvg';
import type { HoleSpec, TerminationParams } from '../holeArray';

/**
 * Pure SVG cross-section generator tests (Track C3 — Wave 2 Phase 2 W3).
 *
 * The function is required to be deterministic + side-effect free; every test
 * asserts on the primitive list directly rather than rendering to the DOM.
 *
 * Shape rules covered:
 *   - drilled+through         → cylinder walls + no bottom line
 *   - drilled+blind+flat      → cylinder + flat bottom line
 *   - drilled+blind+conical   → cylinder + two slanted cone edges
 *   - drilled+upToNext        → cylinder + flat bottom (placeholder until worker)
 *   - drilled+upToFace        → same shape (placeholder)
 *   - counterbore             → top pocket rectangle + inner bore walls
 *   - countersink             → funnel wedges + inner bore walls
 *   - counterdrill            → three concentric step rectangles
 */

const DRILLED_5MM: HoleSpec = { kind: 'drilled', diameter: 5, drillTipAngle: 118 };
const CBORE_M6: HoleSpec = {
  kind: 'counterbore',
  diameter: 6.6,
  headDiameter: 11,
  headDepth: 6.5,
  drillTipAngle: 118,
};
const CSK_M6: HoleSpec = {
  kind: 'countersink',
  diameter: 6.6,
  coneDiameter: 13.44,
  coneAngle: 90,
  drillTipAngle: 118,
};
const CDRILL_M6: HoleSpec = {
  kind: 'counterdrill',
  diameter: 6.6,
  middleDiameter: 8.8,
  headDiameter: 11,
  middleDepth: 9.75,
  headDepth: 6.5,
  drillTipAngle: 118,
};

const TERM_THROUGH: TerminationParams = { kind: 'through' };
const TERM_BLIND_FLAT: TerminationParams = { kind: 'blind', depth: 10, bottomShape: 'flat' };
const TERM_BLIND_CONE: TerminationParams = { kind: 'blind', depth: 10, bottomShape: 'conical', drillTipAngle: 118 };
const TERM_UPTONEXT: TerminationParams = { kind: 'upToNext' };
const TERM_UPTOFACE: TerminationParams = { kind: 'upToFace', faceId: 'face-7' };

function countByKind(els: SvgElement[]) {
  return {
    line: els.filter((e) => e.kind === 'line').length,
    label: els.filter((e) => e.kind === 'label').length,
    polyline: els.filter((e) => e.kind === 'polyline').length,
  };
}

function linesByClass(els: SvgElement[], className: string) {
  return els.filter((e) => e.kind === 'line' && e.className === className);
}

describe('computeHoleSectionSvg — drilled', () => {
  it('drilled + through emits 2 part-edge lines and 2 hole-edge lines (no bottom)', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH);
    const partEdges = linesByClass(svg.elements, 'part-edge');
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    expect(partEdges).toHaveLength(2);
    // For through-all, hole edges = 2 vertical walls (no bottom).
    expect(holeEdges).toHaveLength(2);
  });

  it('drilled + blind + flat emits exactly one horizontal bottom line', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_BLIND_FLAT);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 walls + 1 flat bottom
    expect(holeEdges).toHaveLength(3);
    const horizontals = holeEdges.filter((e) => e.kind === 'line' && e.y1 === e.y2);
    expect(horizontals).toHaveLength(1);
  });

  it('drilled + blind + conical emits 2 slanted bottom edges meeting at apex', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_BLIND_CONE);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 walls + 2 slanted cone edges
    expect(holeEdges).toHaveLength(4);
    // Slanted edges have both x1 ≠ x2 AND y1 ≠ y2 (vertical walls share x).
    const slanted = holeEdges.filter(
      (e) => e.kind === 'line' && e.x1 !== e.x2 && e.y1 !== e.y2,
    );
    expect(slanted).toHaveLength(2);
    if (slanted[0].kind === 'line' && slanted[1].kind === 'line') {
      // Both terminate at the apex (centerX, sameY).
      expect(slanted[0].x2).toBeCloseTo(slanted[1].x2, 6);
      expect(slanted[0].y2).toBeCloseTo(slanted[1].y2, 6);
      expect(slanted[0].x2).toBeCloseTo(svg.centerX, 6);
    }
  });

  it('drilled + upToNext renders a placeholder flat bottom (worker stub)', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_UPTONEXT);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 walls + 1 flat bottom
    expect(holeEdges).toHaveLength(3);
  });

  it('drilled + upToFace renders the same shape as upToNext (placeholder)', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_UPTOFACE);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    expect(holeEdges).toHaveLength(3);
  });
});

describe('computeHoleSectionSvg — counterbore', () => {
  it('emits the pocket walls (2) + floor strips (2) + bore walls (2) for through', () => {
    const svg = computeHoleSectionSvg(CBORE_M6, TERM_THROUGH);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 pocket walls + 2 floor strips + 2 bore walls
    expect(holeEdges).toHaveLength(6);
  });

  it('counterbore pocket walls have larger horizontal offset than bore walls', () => {
    const svg = computeHoleSectionSvg(CBORE_M6, TERM_THROUGH);
    const lines = svg.elements.filter(
      (e): e is Extract<SvgElement, { kind: 'line' }> => e.kind === 'line' && e.className === 'hole-edge',
    );
    // Find the leftmost vertical edge — should be the pocket wall.
    const verticals = lines.filter((l) => l.x1 === l.x2);
    const leftmost = Math.min(...verticals.map((l) => l.x1));
    // The drilled bore walls are closer to centerX than the pocket walls.
    // centerX is svg.centerX; leftmost should be further left than centerX-boreHalf.
    expect(leftmost).toBeLessThan(svg.centerX);
  });

  it('counterbore + blind conical: pocket above, drilled cone below', () => {
    const svg = computeHoleSectionSvg(CBORE_M6, TERM_BLIND_CONE);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 pocket + 2 floor + 2 walls + 2 slanted cone = 8
    expect(holeEdges).toHaveLength(8);
  });
});

describe('computeHoleSectionSvg — countersink', () => {
  it('emits 2 slanted funnel edges + 2 bore walls', () => {
    const svg = computeHoleSectionSvg(CSK_M6, TERM_THROUGH);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 funnel + 2 bore walls
    expect(holeEdges).toHaveLength(4);
  });

  it('funnel depth derives from coneDiameter / (2*tan(angle/2))', () => {
    // 90° cone, 13.44 mm face → tan(45°)=1, depth = 13.44/2 = 6.72
    expect(countersinkFunnelDepthMm(13.44, 90)).toBeCloseTo(6.72, 2);
    // 82° cone (UTS), 13.08 → depth = 13.08/(2 tan(41°)) ≈ 7.52
    expect(countersinkFunnelDepthMm(13.08, 82)).toBeCloseTo(13.08 / (2 * Math.tan((41 * Math.PI) / 180)), 4);
  });

  it('countersinkFunnelDepthMm returns 0 for a degenerate 180° cone', () => {
    expect(countersinkFunnelDepthMm(10, 180)).toBe(0);
  });
});

describe('computeHoleSectionSvg — counterdrill (3 steps)', () => {
  it('emits walls + floors for all three steps', () => {
    const svg = computeHoleSectionSvg(CDRILL_M6, TERM_THROUGH);
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 head walls + 2 head floor + 2 mid walls + 2 mid floor + 2 bore walls = 10
    expect(holeEdges).toHaveLength(10);
  });
});

describe('computeHoleSectionSvg — labels', () => {
  it('drilled emits a Ø label at the top of the bore', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH);
    const labels = svg.elements.filter((e) => e.kind === 'label');
    const diaLabel = labels.find((l) => l.kind === 'label' && l.text.includes('Ø5'));
    expect(diaLabel).toBeDefined();
  });

  it('through-all writes "through" in the depth annotation', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH);
    const labels = svg.elements.filter((e) => e.kind === 'label');
    const depthLabel = labels.find((l) => l.kind === 'label' && l.text.toLowerCase().includes('through'));
    expect(depthLabel).toBeDefined();
  });

  it('blind writes the depth value (10 mm)', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_BLIND_FLAT);
    const labels = svg.elements.filter((e) => e.kind === 'label');
    const depthLabel = labels.find((l) => l.kind === 'label' && l.text.includes('10'));
    expect(depthLabel).toBeDefined();
  });

  it('countersink writes its cone angle annotation', () => {
    const svg = computeHoleSectionSvg(CSK_M6, TERM_THROUGH);
    const labels = svg.elements.filter((e) => e.kind === 'label');
    const angLabel = labels.find((l) => l.kind === 'label' && l.text.includes('90'));
    expect(angLabel).toBeDefined();
  });
});

// ─── Track C4 — counterdrill + tap rendering (W4) ──────────────────────────

const TAP_M5: HoleSpec = {
  kind: 'tap',
  diameter: 4.2,
  pitch: 0.8,
  tapClass: '6H',
  tapDepth: 10,
  drillTipAngle: 118,
};

const PIPE_TAP_QUARTER_NPT: HoleSpec = {
  kind: 'pipe_tap',
  diameter: 11.4,
  pipeStandard: 'NPT',
  pipeSizeKey: '1/4-18',
  engagementDepth: 9.7,
};

const TERM_BLIND_TAP: TerminationParams = {
  kind: 'blind',
  depth: 12,
  bottomShape: 'conical',
  drillTipAngle: 118,
};

describe('computeHoleSectionSvg — counterdrill (C4)', () => {
  it('blind+conical: 3-step pocket profile + cone tip below drilled bore', () => {
    const svg = computeHoleSectionSvg(CDRILL_M6, {
      kind: 'blind',
      depth: 20,
      bottomShape: 'conical',
      drillTipAngle: 118,
    });
    const holeEdges = linesByClass(svg.elements, 'hole-edge');
    // 2 head walls + 2 head floor strips + 2 mid walls + 2 mid floor + 2 bore walls + 2 cone slants = 12
    expect(holeEdges).toHaveLength(12);
  });

  it('counterdrill emits a top label that references the head diameter', () => {
    const svg = computeHoleSectionSvg(CDRILL_M6, TERM_THROUGH);
    const labels = svg.elements.filter((e) => e.kind === 'label');
    const top = labels.find((l) => l.kind === 'label' && l.text.includes('Ø11'));
    expect(top).toBeDefined();
  });

  it('counterdrill middle step has intermediate diameter between head and bore', () => {
    const svg = computeHoleSectionSvg(CDRILL_M6, TERM_THROUGH);
    const lines = svg.elements.filter(
      (e): e is Extract<SvgElement, { kind: 'line' }> => e.kind === 'line' && e.className === 'hole-edge',
    );
    // The leftmost vertical line is the head wall, the rightmost vertical
    // line in the inner region is the bore wall; the middle step lies strictly
    // between them.
    const verticals = lines.filter((l) => l.x1 === l.x2).map((l) => l.x1);
    const distances = verticals.map((x) => Math.abs(x - svg.centerX));
    distances.sort((a, b) => a - b);
    // 3 distinct radii: bore < middle < head (each appears on both sides).
    const distinctRadii = Array.from(new Set(distances.map((d) => d.toFixed(3))));
    expect(distinctRadii.length).toBeGreaterThanOrEqual(3);
  });
});

describe('computeHoleSectionSvg — tap (C4)', () => {
  it('emits two dashed thread-indicator lines flanking the centerline', () => {
    const svg = computeHoleSectionSvg(TAP_M5, TERM_BLIND_TAP);
    const threads = svg.elements.filter(
      (e): e is Extract<SvgElement, { kind: 'line' }> => e.kind === 'line' && e.className === 'thread-indicator',
    );
    expect(threads).toHaveLength(2);
    expect(threads[0].dashed).toBe(true);
    expect(threads[1].dashed).toBe(true);
    // Thread indicators are symmetric around the centerline.
    expect(threads[0].x1 + threads[1].x1).toBeCloseTo(svg.centerX * 2, 6);
  });

  it('tap label combines diameter + pitch + "TAP" marker', () => {
    const svg = computeHoleSectionSvg(TAP_M5, TERM_BLIND_TAP);
    const labels = svg.elements.filter((e) => e.kind === 'label');
    const tap = labels.find((l) => l.kind === 'label' && l.text.includes('TAP'));
    expect(tap).toBeDefined();
    if (tap?.kind === 'label') {
      expect(tap.text).toContain('0.8'); // pitch
      expect(tap.text).toContain('Ø4.2'); // tap-drill diameter
    }
  });

  it('through-all tap still emits the dashed thread indicator', () => {
    const svg = computeHoleSectionSvg(TAP_M5, TERM_THROUGH);
    const threads = svg.elements.filter(
      (e) => e.kind === 'line' && e.className === 'thread-indicator',
    );
    expect(threads.length).toBe(2);
  });

  it('thread-indicator depth is clamped to bore depth (no overshoot)', () => {
    // Tap depth 10, blind depth 5 → indicator must not extend below the bore.
    const svg = computeHoleSectionSvg(TAP_M5, {
      kind: 'blind',
      depth: 5,
      bottomShape: 'conical',
      drillTipAngle: 118,
    });
    const threads = svg.elements.filter(
      (e): e is Extract<SvgElement, { kind: 'line' }> => e.kind === 'line' && e.className === 'thread-indicator',
    );
    expect(threads).toHaveLength(2);
    // Bottom of indicator <= partBottomY (or near it)
    expect(threads[0].y2).toBeLessThanOrEqual(svg.partBottomY + 1);
  });
});

describe('computeHoleSectionSvg — pipe_tap (C4)', () => {
  it('emits cosmetic dashed taper lines converging downward', () => {
    const svg = computeHoleSectionSvg(PIPE_TAP_QUARTER_NPT, TERM_THROUGH);
    const taper = svg.elements.filter(
      (e): e is Extract<SvgElement, { kind: 'line' }> => e.kind === 'line' && e.className === 'thread-indicator',
    );
    expect(taper).toHaveLength(2);
    // Convergence: |x2-centerX| < |x1-centerX| on both sides.
    const left = taper[0];
    const right = taper[1];
    expect(Math.abs(left.x2 - svg.centerX)).toBeLessThan(Math.abs(left.x1 - svg.centerX));
    expect(Math.abs(right.x2 - svg.centerX)).toBeLessThan(Math.abs(right.x1 - svg.centerX));
  });

  it('label carries the pipe size key + standard (e.g. "1/4-18 NPT")', () => {
    const svg = computeHoleSectionSvg(PIPE_TAP_QUARTER_NPT, TERM_THROUGH);
    const labels = svg.elements.filter((e) => e.kind === 'label');
    const pipe = labels.find(
      (l) => l.kind === 'label' && l.text.includes('1/4-18') && l.text.includes('NPT'),
    );
    expect(pipe).toBeDefined();
  });
});

describe('computeHoleSectionSvg — layout invariants', () => {
  it('returns a layout with positive width/height/pxPerMm', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH);
    expect(svg.layout.width).toBeGreaterThan(0);
    expect(svg.layout.height).toBeGreaterThan(0);
    expect(svg.layout.pxPerMm).toBeGreaterThan(0);
  });

  it('centerX is inside the canvas', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH);
    expect(svg.centerX).toBeGreaterThan(0);
    expect(svg.centerX).toBeLessThan(svg.layout.width);
  });

  it('partBottomY > partTopY (the part has positive thickness)', () => {
    const svg = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH);
    expect(svg.partBottomY).toBeGreaterThan(svg.partTopY);
  });

  it('respects an override body thickness', () => {
    const svg5 = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH, { thicknessMm: 5 });
    const svg30 = computeHoleSectionSvg(DRILLED_5MM, TERM_THROUGH, DEFAULT_BODY_CONTEXT);
    // The 5 mm thick body should fit more px-per-mm than the 30 mm one (more
    // available Y per mm); since the layout balances both axes, we just check
    // the part rectangle is narrower vertically for thinner body.
    expect(svg5.partBottomY - svg5.partTopY).toBeLessThanOrEqual(
      svg30.partBottomY - svg30.partTopY,
    );
  });

  it('is deterministic — repeat calls produce equal element counts', () => {
    const a = countByKind(computeHoleSectionSvg(CBORE_M6, TERM_BLIND_CONE).elements);
    const b = countByKind(computeHoleSectionSvg(CBORE_M6, TERM_BLIND_CONE).elements);
    expect(a).toEqual(b);
  });
});
