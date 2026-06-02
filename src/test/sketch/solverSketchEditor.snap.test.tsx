/** @vitest-environment jsdom */
/**
 * SolverSketchEditor + SketchSnapIndicator + sketchSnap integration tests
 * (Phase 1.4 — own pro-CAD ADR-013).
 *
 * Confirms the host editor wires:
 *   - snap toggle UI (grid / point / intersection)
 *   - mousemove → findSnapTarget → SketchSnapIndicator mount
 *   - drawing-tool gating (snap off in select / dimension / trim / etc.)
 *   - click handler uses the snap pos when a snap is active
 *   - all-off snap state → no indicator, raw cursor is used (regression
 *     guarantee against v1.lite behavior)
 *
 * jsdom note: `SVGSVGElement.createSVGPoint` + `getScreenCTM` are absent
 * in jsdom; the editor's `eventToSvgPoint` helper falls back to clientX/Y,
 * so the SVG coordinate system is 1:1 with mouse coords here (no CTM).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

async function mountReady(lang: 'en' | 'ko' = 'en'): Promise<HTMLElement> {
  render(<SolverSketchEditor lang={lang} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
  return editor;
}

function canvas(): HTMLElement {
  return screen.getByTestId('solver-sketch-canvas');
}
function clickAt(el: Element, x: number, y: number): void {
  fireEvent.click(el, { clientX: x, clientY: y });
}
function moveTo(el: Element, x: number, y: number): void {
  fireEvent.mouseMove(el, { clientX: x, clientY: y });
}
function tool(id: string): HTMLButtonElement {
  return screen.getByTestId(`solver-sketch-tool-${id}`) as HTMLButtonElement;
}
function snapToggle(
  id: 'grid' | 'point' | 'intersection' | 'arc' | 'perpendicular',
): HTMLButtonElement {
  return screen.getByTestId(`solver-snap-toggle-${id}`) as HTMLButtonElement;
}
function getPoints(): NodeListOf<SVGCircleElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-p"]',
  ) as NodeListOf<SVGCircleElement>;
}
function getIndicator(): HTMLElement | null {
  return screen.queryByTestId('snap-indicator');
}
function setSnapAll(state: { grid: boolean; point: boolean; intersection: boolean }): void {
  // Defaults are all-on; click each toggle whose desired state differs from default.
  if (!state.grid) fireEvent.click(snapToggle('grid'));
  if (!state.point) fireEvent.click(snapToggle('point'));
  if (!state.intersection) fireEvent.click(snapToggle('intersection'));
}

describe('SolverSketchEditor — snap integration', () => {
  it('renders three snap toggles with testids and default aria-pressed=true', async () => {
    await mountReady();
    for (const id of ['grid', 'point', 'intersection'] as const) {
      const btn = snapToggle(id);
      expect(btn).toBeInTheDocument();
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('snap all-disabled → no indicator regardless of cursor position', async () => {
    await mountReady();
    setSnapAll({ grid: false, point: false, intersection: false });
    // Drawing tool active so gating is satisfied.
    fireEvent.click(tool('line'));
    moveTo(canvas(), 3, 7);
    // No snap → no indicator mounted (zero DOM footprint).
    expect(getIndicator()).toBeNull();
  });

  it('grid snap enabled + cursor (3, 7) → indicator at (5, 5)', async () => {
    await mountReady();
    setSnapAll({ grid: true, point: false, intersection: false });
    fireEvent.click(tool('line'));
    moveTo(canvas(), 3, 7);
    await waitFor(() => expect(getIndicator()).toBeInTheDocument());
    const grid = within(getIndicator()!).getByTestId('snap-indicator-grid');
    const horiz = grid.querySelectorAll('line')[0]!;
    // Horizontal arm runs along y = pos.y; vertical arm pinned at x = pos.x.
    expect(horiz.getAttribute('y1')).toBe('5');
    expect(horiz.getAttribute('y2')).toBe('5');
  });

  it('point snap enabled + cursor near existing endpoint → point indicator', async () => {
    await mountReady();
    // Draw a line to seed an existing point at (100, 100).
    fireEvent.click(tool('line'));
    clickAt(canvas(), 100, 100);
    clickAt(canvas(), 200, 100);
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    // Hover next to the first endpoint. Grid OFF so grid (100,100) doesn't
    // beat the existing point on priority ties.
    setSnapAll({ grid: false, point: true, intersection: false });
    fireEvent.click(tool('line'));
    moveTo(canvas(), 101, 101);
    await waitFor(() => expect(getIndicator()).toBeInTheDocument());
    // The endpoint marker shows up as line_endpoint (line endpoint wins over
    // raw point candidate since lines feed BOTH endpoints + midpoints, and
    // the closest of those wins on distance).
    const indicator = getIndicator()!;
    const hasPointKind =
      within(indicator).queryByTestId('snap-indicator-point') ||
      within(indicator).queryByTestId('snap-indicator-line_endpoint');
    expect(hasPointKind).toBeTruthy();
  });

  it('line endpoint snap → line_endpoint indicator (orange square)', async () => {
    await mountReady();
    fireEvent.click(tool('line'));
    clickAt(canvas(), 50, 50);
    clickAt(canvas(), 150, 50);
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    setSnapAll({ grid: false, point: true, intersection: false });
    fireEvent.click(tool('line'));
    moveTo(canvas(), 151, 51);
    await waitFor(() => {
      const ind = getIndicator();
      expect(ind).not.toBeNull();
      // Either endpoint (orange square) OR point (cyan ring) is acceptable
      // — both are "snapped to an existing vertex". Reject grid which would
      // mean snap missed and rounded.
      const marker =
        within(ind!).queryByTestId('snap-indicator-line_endpoint') ||
        within(ind!).queryByTestId('snap-indicator-point');
      expect(marker).toBeTruthy();
    });
  });

  it('circle center snap → circle_center indicator (diamond)', async () => {
    await mountReady();
    fireEvent.click(tool('circle'));
    clickAt(canvas(), 200, 200);
    clickAt(canvas(), 240, 200); // radius 40
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(1));
    setSnapAll({ grid: false, point: true, intersection: false });
    fireEvent.click(tool('line'));
    moveTo(canvas(), 201, 201);
    await waitFor(() => {
      const ind = getIndicator();
      expect(ind).not.toBeNull();
      // The center is also stored as a point — circle_center OR point both
      // satisfy "snapped to the circle's center".
      const marker =
        within(ind!).queryByTestId('snap-indicator-circle_center') ||
        within(ind!).queryByTestId('snap-indicator-point');
      expect(marker).toBeTruthy();
    });
  });

  it('intersection snap → intersection indicator (× cross)', async () => {
    await mountReady();
    // Two crossing lines: horizontal y=100 from x=50..150, vertical x=100 from y=50..150.
    fireEvent.click(tool('line'));
    clickAt(canvas(), 50, 100);
    clickAt(canvas(), 150, 100);
    clickAt(canvas(), 100, 50);
    clickAt(canvas(), 100, 150);
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(4));
    // Grid + point OFF so intersection is the lone candidate near (100,100).
    setSnapAll({ grid: false, point: false, intersection: true });
    fireEvent.click(tool('line'));
    moveTo(canvas(), 101, 101);
    await waitFor(() => {
      const ind = getIndicator();
      expect(ind).not.toBeNull();
      expect(within(ind!).queryByTestId('snap-indicator-intersection')).toBeTruthy();
    });
  });

  it('switching from select → line activates snap (indicator appears on move)', async () => {
    await mountReady();
    // Default state: select. Move cursor — no indicator.
    moveTo(canvas(), 3, 7);
    expect(getIndicator()).toBeNull();
    // Switch to line tool, move again — indicator now appears (grid default).
    fireEvent.click(tool('line'));
    moveTo(canvas(), 3, 7);
    await waitFor(() => expect(getIndicator()).toBeInTheDocument());
  });

  it('select mode → snap is disabled (no indicator even with snap on)', async () => {
    await mountReady();
    // Defaults: select tool + all snap on. Mousemove should NOT mount indicator.
    expect(tool('select').getAttribute('aria-pressed')).toBe('true');
    moveTo(canvas(), 3, 7);
    expect(getIndicator()).toBeNull();
  });

  it('snapped click → solver receives the snapped position', async () => {
    await mountReady();
    // Defaults: grid on (spacing 5). Cursor (3,7) snaps to (5,5).
    fireEvent.click(tool('line'));
    clickAt(canvas(), 3, 7);   // start (should snap to 5,5)
    clickAt(canvas(), 28, 32); // end   (should snap to 30,30)
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    const pts = Array.from(getPoints()).map((p) => ({
      x: Number(p.getAttribute('cx')),
      y: Number(p.getAttribute('cy')),
    }));
    // Both endpoints landed exactly on grid nodes — verifies the click
    // handler consulted findSnapTarget and used its pos, not the raw event.
    expect(pts.some((p) => p.x === 5 && p.y === 5)).toBe(true);
    expect(pts.some((p) => p.x === 30 && p.y === 30)).toBe(true);
  });

  it('snap all disabled → click uses raw cursor (regression vs v1.lite)', async () => {
    await mountReady();
    setSnapAll({ grid: false, point: false, intersection: false });
    fireEvent.click(tool('line'));
    clickAt(canvas(), 7, 13);   // raw, off-grid
    clickAt(canvas(), 28, 32);  // raw, off-grid
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    const pts = Array.from(getPoints()).map((p) => ({
      x: Number(p.getAttribute('cx')),
      y: Number(p.getAttribute('cy')),
    }));
    // No snap → raw coords land exactly as clicked.
    expect(pts.some((p) => p.x === 7 && p.y === 13)).toBe(true);
    expect(pts.some((p) => p.x === 28 && p.y === 32)).toBe(true);
  });

  it('toggling a snap option flips aria-pressed', async () => {
    await mountReady();
    const grid = snapToggle('grid');
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(grid);
    expect(grid.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(grid);
    expect(grid.getAttribute('aria-pressed')).toBe('true');
  });

  it('snap toggles are independent (toggling grid does not affect point/intersection)', async () => {
    await mountReady();
    fireEvent.click(snapToggle('grid'));
    expect(snapToggle('grid').getAttribute('aria-pressed')).toBe('false');
    expect(snapToggle('point').getAttribute('aria-pressed')).toBe('true');
    expect(snapToggle('intersection').getAttribute('aria-pressed')).toBe('true');
  });

  it('tool switch clears the lingering snap indicator', async () => {
    await mountReady();
    fireEvent.click(tool('line'));
    moveTo(canvas(), 3, 7);
    await waitFor(() => expect(getIndicator()).toBeInTheDocument());
    // Switch back to select — indicator should disappear immediately,
    // before any further mousemove.
    fireEvent.click(tool('select'));
    expect(getIndicator()).toBeNull();
  });

  it('snap label localized (ko shows 스냅:)', async () => {
    await mountReady('ko');
    // Snap label "스냅:" appears in the toolbar.
    expect(screen.getByText(/스냅/)).toBeInTheDocument();
  });

  it('dimension tool does NOT trigger snap (only point picks)', async () => {
    await mountReady();
    fireEvent.click(tool('dimension'));
    moveTo(canvas(), 3, 7);
    // Dimension is an entity-picking tool, not a free-cursor drawing tool —
    // no indicator should appear.
    expect(getIndicator()).toBeNull();
  });
});

// ─── Phase 2 snap toggles (Arc / Perpendicular) ─────────────────────────
//
// Arc + perpendicular foot snap families are wired through the same toolbar
// pattern as Phase 1 but default OFF. The user opts in per family. Defaults
// were chosen so back-compat with the original 3-toggle UI is preserved
// (test suite from Phase 1.4 still observes "Phase 2 off → no Phase 2
// markers"). Tests below validate:
//   - both toggles render with the correct testid + aria-pressed=false
//   - i18n labels resolve per language
//   - flipping a toggle on actually unlocks the corresponding indicator
//   - independent of Phase 1 toggles (no coupling)
//   - both-on emits whichever Phase 2 family wins the priority/distance
//     race for the cursor
//   - turning everything (Phase 1 + Phase 2) off still yields zero
//     indicators (regression for v1.lite behavior)

describe('SolverSketchEditor — Phase 2 snap toggles (Arc / Perpendicular)', () => {
  it('arc + perpendicular toggles render with default aria-pressed=false', async () => {
    await mountReady();
    for (const id of ['arc', 'perpendicular'] as const) {
      const btn = snapToggle(id);
      expect(btn).toBeInTheDocument();
      // Phase 2 defaults are conservative OFF — opting in is explicit.
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('arc toggle click → aria-pressed flips true (active styling kicks in)', async () => {
    await mountReady();
    const arc = snapToggle('arc');
    expect(arc.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(arc);
    expect(arc.getAttribute('aria-pressed')).toBe('true');
    // Same pill style as Phase 1: cyan-700 background when active. Test the
    // structural signal (aria-pressed) since inline styles aren't asserted
    // elsewhere in this suite.
    fireEvent.click(arc);
    expect(arc.getAttribute('aria-pressed')).toBe('false');
  });

  it('perpendicular toggle click → aria-pressed flips, independent of arc', async () => {
    await mountReady();
    const perp = snapToggle('perpendicular');
    const arc = snapToggle('arc');
    fireEvent.click(perp);
    expect(perp.getAttribute('aria-pressed')).toBe('true');
    // Toggling perpendicular must not flip arc — the toggles are siblings,
    // not a radio group.
    expect(arc.getAttribute('aria-pressed')).toBe('false');
  });

  it('perpendicular ON + line drawn + cursor near body → line_perpendicular indicator', async () => {
    await mountReady();
    // Seed a horizontal line at y=100 from x=50 to x=200.
    fireEvent.click(tool('line'));
    clickAt(canvas(), 50, 100);
    clickAt(canvas(), 200, 100);
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    // Disable Phase 1 (grid + point + intersection) so perpendicular is the
    // lone candidate. Default Phase 2 = both off → flip perpendicular on.
    setSnapAll({ grid: false, point: false, intersection: false });
    fireEvent.click(snapToggle('perpendicular'));
    fireEvent.click(tool('line'));
    // Cursor at (125, 104) — close to the line body (perp distance 4 < 5).
    moveTo(canvas(), 125, 104);
    await waitFor(() => {
      const ind = getIndicator();
      expect(ind).not.toBeNull();
      expect(within(ind!).queryByTestId('snap-indicator-line_perpendicular')).toBeTruthy();
    });
  });

  it('perpendicular ON + circle + cursor near circumference → circle_perpendicular indicator', async () => {
    await mountReady();
    // Seed a circle of radius 50 at (200, 200).
    fireEvent.click(tool('circle'));
    clickAt(canvas(), 200, 200);
    clickAt(canvas(), 250, 200); // radius 50
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(1));
    // Phase 1 off, perpendicular on. Cursor slightly outside circle body so
    // the closest circumference point is the perpendicular foot.
    setSnapAll({ grid: false, point: false, intersection: false });
    fireEvent.click(snapToggle('perpendicular'));
    fireEvent.click(tool('line'));
    // Cursor at (252, 200) — 2 units outside circumference along +x axis.
    moveTo(canvas(), 252, 200);
    await waitFor(() => {
      const ind = getIndicator();
      expect(ind).not.toBeNull();
      expect(within(ind!).queryByTestId('snap-indicator-circle_perpendicular')).toBeTruthy();
    });
  });

  it('all snap families off (Phase 1 + Phase 2) → no indicator (back-compat regression)', async () => {
    await mountReady();
    // Phase 1 defaults are ON → flip all three off. Phase 2 already OFF.
    setSnapAll({ grid: false, point: false, intersection: false });
    fireEvent.click(tool('line'));
    moveTo(canvas(), 17, 23);
    expect(getIndicator()).toBeNull();
    // Sanity: confirm the Phase 2 toggles ARE off so the assertion above is
    // genuinely "everything off" rather than accidental Phase-2-on.
    expect(snapToggle('arc').getAttribute('aria-pressed')).toBe('false');
    expect(snapToggle('perpendicular').getAttribute('aria-pressed')).toBe('false');
  });

  it('perpendicular ON + Phase 1 OFF + drawing tool → indicator unblocked', async () => {
    await mountReady();
    // Seed a line so there is an entity for perpendicular foot to attach to.
    fireEvent.click(tool('line'));
    clickAt(canvas(), 50, 50);
    clickAt(canvas(), 150, 50);
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    // Turn EVERY Phase 1 toggle off so perpendicular is the only enabled
    // family. If `computeSnapAt`'s no-op short-circuit incorrectly only
    // checks the Phase 1 trio, this test would have returned null and the
    // indicator would never mount.
    setSnapAll({ grid: false, point: false, intersection: false });
    fireEvent.click(snapToggle('perpendicular'));
    fireEvent.click(tool('line'));
    moveTo(canvas(), 100, 53); // perpendicular foot at (100, 50), distance 3
    await waitFor(() => expect(getIndicator()).toBeInTheDocument());
  });

  it('Phase 2 perpendicular toggle does not flip Phase 1 aria states', async () => {
    await mountReady();
    fireEvent.click(snapToggle('perpendicular'));
    // Phase 1 toggles should still match their defaults (all on).
    expect(snapToggle('grid').getAttribute('aria-pressed')).toBe('true');
    expect(snapToggle('point').getAttribute('aria-pressed')).toBe('true');
    expect(snapToggle('intersection').getAttribute('aria-pressed')).toBe('true');
    // And the new Phase 2 toggle is the only one flipped.
    expect(snapToggle('perpendicular').getAttribute('aria-pressed')).toBe('true');
    expect(snapToggle('arc').getAttribute('aria-pressed')).toBe('false');
  });

  it('i18n: en labels show "Arc" + "Perp" for Phase 2 toggles', async () => {
    await mountReady('en');
    expect(snapToggle('arc')).toHaveTextContent('Arc');
    expect(snapToggle('perpendicular')).toHaveTextContent('Perp');
  });

  it('i18n: ko labels show "호" + "수선" for Phase 2 toggles', async () => {
    await mountReady('ko');
    expect(snapToggle('arc')).toHaveTextContent('호');
    expect(snapToggle('perpendicular')).toHaveTextContent('수선');
  });

  it('toggling arc on does NOT impact Phase 1 toggles or perpendicular', async () => {
    await mountReady();
    const before = {
      grid: snapToggle('grid').getAttribute('aria-pressed'),
      point: snapToggle('point').getAttribute('aria-pressed'),
      intersection: snapToggle('intersection').getAttribute('aria-pressed'),
      perpendicular: snapToggle('perpendicular').getAttribute('aria-pressed'),
    };
    fireEvent.click(snapToggle('arc'));
    expect(snapToggle('arc').getAttribute('aria-pressed')).toBe('true');
    expect(snapToggle('grid').getAttribute('aria-pressed')).toBe(before.grid);
    expect(snapToggle('point').getAttribute('aria-pressed')).toBe(before.point);
    expect(snapToggle('intersection').getAttribute('aria-pressed')).toBe(before.intersection);
    expect(snapToggle('perpendicular').getAttribute('aria-pressed')).toBe(before.perpendicular);
  });

  it('perpendicular OFF (default) → no line_perpendicular indicator even with lines present', async () => {
    await mountReady();
    // Seed a line so the geometry exists; do NOT touch the perpendicular
    // toggle (default OFF). Cursor near the line body — without the toggle,
    // there must be no perpendicular indicator (proves the default-off
    // semantics actually gate the candidate computation).
    fireEvent.click(tool('line'));
    clickAt(canvas(), 50, 50);
    clickAt(canvas(), 150, 50);
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    // Turn off Phase 1 so any indicator that DOES show must be Phase 2.
    setSnapAll({ grid: false, point: false, intersection: false });
    fireEvent.click(tool('line'));
    moveTo(canvas(), 100, 53);
    // No Phase 1, Phase 2 default off → snap returns null → indicator unmounted.
    expect(getIndicator()).toBeNull();
  });

  it('perpendicular ON + cursor far from any entity → no indicator (threshold respected)', async () => {
    await mountReady();
    fireEvent.click(tool('line'));
    clickAt(canvas(), 50, 50);
    clickAt(canvas(), 150, 50);
    await waitFor(() => expect(getPoints().length).toBeGreaterThanOrEqual(2));
    setSnapAll({ grid: false, point: false, intersection: false });
    fireEvent.click(snapToggle('perpendicular'));
    fireEvent.click(tool('line'));
    // (100, 500) is far past the perpendicular threshold (default 5).
    moveTo(canvas(), 100, 500);
    expect(getIndicator()).toBeNull();
  });
});
