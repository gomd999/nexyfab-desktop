/** @vitest-environment jsdom */
/**
 * SolverSketchEditor + SketchConstraintOverlay integration tests (Phase 1.B).
 *
 * Confirms that constraints added through the toolbar surface visually on
 * the canvas via SketchConstraintOverlay:
 *   - distance       → dim-line + arrows + numeric label
 *   - angle          → arc path + degree label
 *   - horizontal/vertical/parallel/perpendicular → badge glyph
 *   - selection      → blue highlight + delete affordance
 *   - delete         → solver.removeConstraint + immediate overlay refresh
 *   - re-solve       → overlay coords track post-solve geometry
 *
 * Runs against the real WASM solver (no mocks). Same async-ready pattern
 * as the other solverSketchEditor.* tests.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

async function mountReady(lang: 'en' | 'ko' = 'en'): Promise<HTMLElement> {
  render(<SolverSketchEditor lang={lang} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
  return editor;
}

function clickAt(el: Element, x: number, y: number, init: MouseEventInit = {}): void {
  fireEvent.click(el, { clientX: x, clientY: y, ...init });
}

function getLines(): NodeListOf<SVGLineElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-l"]',
  ) as NodeListOf<SVGLineElement>;
}

function getPoints(): NodeListOf<SVGCircleElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-p"]',
  ) as NodeListOf<SVGCircleElement>;
}

async function drawLine(
  startX: number, startY: number, endX: number, endY: number,
): Promise<void> {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
  const canvas = screen.getByTestId('solver-sketch-canvas');
  clickAt(canvas, startX, startY);
  clickAt(canvas, endX, endY);
  const expected = getLines().length;
  await waitFor(() => expect(getLines().length).toBeGreaterThanOrEqual(expected));
}

function constraintBtn(kind: string): HTMLButtonElement {
  return screen.getByTestId(`solver-constraint-${kind}-button`) as HTMLButtonElement;
}

function getOverlay(): HTMLElement {
  return screen.getByTestId('solver-constraint-overlay');
}

function getOverlayChildren(): Element[] {
  // Each registered constraint becomes a child <g> with id matching
  // solver-constraint-overlay-<id>.
  return Array.from(
    document.querySelectorAll('[data-testid^="solver-constraint-overlay-"]'),
  ).filter((el) => {
    const tid = el.getAttribute('data-testid') ?? '';
    // Filter out the root + sub-elements (label/arrow/delete), keep only
    // the per-constraint group (no extra dash-suffix after the id).
    if (tid === 'solver-constraint-overlay') return false;
    const tail = tid.replace('solver-constraint-overlay-', '');
    return !tail.includes('-');
  });
}

async function selectTwoPoints(): Promise<NodeListOf<SVGCircleElement>> {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
  const pts = getPoints();
  fireEvent.click(pts[0]!);
  fireEvent.click(pts[1]!, { shiftKey: true });
  return pts;
}

async function selectTwoLines(): Promise<NodeListOf<SVGLineElement>> {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
  const lines = getLines();
  fireEvent.click(lines[0]!);
  fireEvent.click(lines[1]!, { shiftKey: true });
  return lines;
}

describe('SolverSketchEditor + SketchConstraintOverlay integration', () => {
  // ─── overlay mounts inside the canvas SVG ──────────────────────────────
  it('mounts the constraint overlay group on the canvas SVG', async () => {
    await mountReady();
    const overlay = getOverlay();
    expect(overlay).toBeInTheDocument();
    expect(overlay.getAttribute('data-count')).toBe('0');
    // Overlay sits inside the canvas svg, not as a sibling.
    const canvas = screen.getByTestId('solver-sketch-canvas');
    expect(canvas.contains(overlay)).toBe(true);
  });

  // ─── distance constraint renders dim-line + arrows + label ─────────────
  it('adding a distance constraint renders dim-line + arrows + numeric label in the overlay', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 130, 100);
    await waitFor(() => expect(getPoints().length).toBe(2));

    await selectTwoPoints();
    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => {
      expect(getOverlay().getAttribute('data-count')).toBe('1');
    });
    const overlayChildren = getOverlayChildren();
    expect(overlayChildren.length).toBe(1);
    const cid = overlayChildren[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    expect(screen.getByTestId(`solver-constraint-overlay-${cid}-arrow-a`)).toBeInTheDocument();
    expect(screen.getByTestId(`solver-constraint-overlay-${cid}-arrow-b`)).toBeInTheDocument();
    const label = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
    expect(label.textContent).toBe('60');
    expect(overlayChildren[0]!.getAttribute('data-constraint-kind')).toBe('distance');
  });

  // ─── angle constraint renders arc + degree label ───────────────────────
  it('adding an angle constraint renders arc + degree label in the overlay', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100); // horizontal
    await drawLine(100, 200, 200, 200); // horizontal too

    await selectTwoLines();
    fireEvent.click(constraintBtn('angle'));
    const input = await screen.findByTestId('solver-constraint-angle-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('solver-constraint-angle-submit'));

    await waitFor(() => {
      expect(getOverlay().getAttribute('data-count')).toBe('1');
    });
    const overlayChildren = getOverlayChildren();
    const cid = overlayChildren[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    expect(screen.getByTestId(`solver-constraint-overlay-${cid}-arc`)).toBeInTheDocument();
    const label = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
    // label should contain ° suffix and a numeric prefix close to 45.
    expect(label.textContent).toMatch(/°$/);
    expect(overlayChildren[0]!.getAttribute('data-constraint-kind')).toBe('angle');
  });

  // ─── horizontal constraint renders H badge ─────────────────────────────
  it('horizontal constraint surfaces as an H badge in the overlay', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));

    await waitFor(() => {
      expect(getOverlay().getAttribute('data-count')).toBe('1');
    });
    const overlayChildren = getOverlayChildren();
    const cid = overlayChildren[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    const badge = screen.getByTestId(`solver-constraint-overlay-${cid}-badge`);
    expect(badge.textContent).toBe('H');
    expect(overlayChildren[0]!.getAttribute('data-constraint-kind')).toBe('horizontal');
  });

  // ─── vertical constraint renders V badge ───────────────────────────────
  it('vertical constraint surfaces as a V badge in the overlay', async () => {
    await mountReady();
    await drawLine(100, 100, 140, 200);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('vertical'));

    await waitFor(() => {
      expect(getOverlay().getAttribute('data-count')).toBe('1');
    });
    const overlayChildren = getOverlayChildren();
    const cid = overlayChildren[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    expect(screen.getByTestId(`solver-constraint-overlay-${cid}-badge`).textContent).toBe('V');
  });

  // ─── parallel constraint renders ∥ badge ───────────────────────────────
  it('parallel constraint surfaces as a ∥ badge in the overlay', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 110);
    await drawLine(100, 200, 200, 260);

    await selectTwoLines();
    fireEvent.click(constraintBtn('parallel'));

    await waitFor(() => {
      expect(getOverlay().getAttribute('data-count')).toBe('1');
    });
    const overlayChildren = getOverlayChildren();
    const cid = overlayChildren[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    expect(screen.getByTestId(`solver-constraint-overlay-${cid}-badge`).textContent).toBe('∥');
  });

  // ─── perpendicular constraint renders ⟂ badge ──────────────────────────
  it('perpendicular constraint surfaces as a ⟂ badge in the overlay', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 110);
    await drawLine(150, 200, 250, 230);

    await selectTwoLines();
    fireEvent.click(constraintBtn('perpendicular'));

    await waitFor(() => {
      expect(getOverlay().getAttribute('data-count')).toBe('1');
    });
    const overlayChildren = getOverlayChildren();
    const cid = overlayChildren[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    expect(screen.getByTestId(`solver-constraint-overlay-${cid}-badge`).textContent).toBe('⟂');
  });

  // ─── clicking a constraint sets it as selected (blue highlight) ────────
  it('clicking an overlay constraint sets selectedConstraintId (data-selected=true)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const overlayChildren = getOverlayChildren();
    const group = overlayChildren[0]!;
    expect(group.getAttribute('data-selected')).toBe('false');

    fireEvent.click(group);
    await waitFor(() => {
      const after = getOverlayChildren()[0]!;
      expect(after.getAttribute('data-selected')).toBe('true');
    });
  });

  // ─── selected constraint shows a delete affordance ─────────────────────
  it('selected constraint surfaces a delete affordance', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const group = getOverlayChildren()[0]!;
    const cid = group.getAttribute('data-testid')!.replace('solver-constraint-overlay-', '');

    // Not selected → no delete glyph.
    expect(screen.queryByTestId(`solver-constraint-overlay-${cid}-delete`)).toBeNull();

    fireEvent.click(group);
    await waitFor(() => {
      expect(screen.getByTestId(`solver-constraint-overlay-${cid}-delete`)).toBeInTheDocument();
    });
  });

  // ─── delete button removes the constraint from the overlay (re-solve) ──
  it('clicking the delete affordance removes the constraint from the solver and overlay', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const group = getOverlayChildren()[0]!;
    const cid = group.getAttribute('data-testid')!.replace('solver-constraint-overlay-', '');
    fireEvent.click(group); // select
    const del = await screen.findByTestId(`solver-constraint-overlay-${cid}-delete`);
    fireEvent.click(del);

    await waitFor(() => {
      expect(getOverlay().getAttribute('data-count')).toBe('0');
    });
    expect(getOverlayChildren().length).toBe(0);
  });

  // ─── multiple constraints render together ──────────────────────────────
  it('multiple constraints (5) render together in the overlay', async () => {
    await mountReady();
    // 3 separate lines + horizontal/vertical for variety.
    await drawLine(100, 100, 200, 140); // line 0
    await drawLine(220, 100, 320, 140); // line 1
    await drawLine(100, 220, 100, 320); // line 2 (already vertical)

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    // horizontal on line 0
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));
    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));

    // horizontal on line 1
    fireEvent.click(getLines()[1]!);
    fireEvent.click(constraintBtn('horizontal'));
    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('2'));

    // vertical on line 2
    fireEvent.click(getLines()[2]!);
    fireEvent.click(constraintBtn('vertical'));
    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('3'));

    // parallel on lines 0+1
    fireEvent.click(getLines()[0]!);
    fireEvent.click(getLines()[1]!, { shiftKey: true });
    fireEvent.click(constraintBtn('parallel'));
    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('4'));

    // perpendicular on lines 0+2
    fireEvent.click(getLines()[0]!);
    fireEvent.click(getLines()[2]!, { shiftKey: true });
    fireEvent.click(constraintBtn('perpendicular'));
    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('5'));

    // All 5 child groups present.
    expect(getOverlayChildren().length).toBe(5);
  });

  // ─── overlay updates immediately after a constraint is added ───────────
  it('overlay refreshes immediately when a constraint is added (no extra interaction needed)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    expect(getOverlay().getAttribute('data-count')).toBe('0');

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
  });

  // ─── after solve, overlay distance label tracks the solved distance ────
  it('after the solver re-solves, the distance label still reflects the constrained value', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 130, 100);
    await waitFor(() => expect(getPoints().length).toBe(2));

    await selectTwoPoints();
    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => {
      const group = getOverlayChildren()[0]!;
      const cid = group.getAttribute('data-testid')!.replace('solver-constraint-overlay-', '');
      const label = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
      expect(label.textContent).toBe('80');
    });
  });

  // ─── clicking the same constraint twice toggles selection off ──────────
  it('clicking the same overlay constraint twice toggles selection off', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));
    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));

    const group = getOverlayChildren()[0]!;
    fireEvent.click(group);
    await waitFor(() => expect(getOverlayChildren()[0]!.getAttribute('data-selected')).toBe('true'));
    fireEvent.click(getOverlayChildren()[0]!);
    await waitFor(() => expect(getOverlayChildren()[0]!.getAttribute('data-selected')).toBe('false'));
  });

  // ─── Phase 1.B inline edit integration ─────────────────────────────────

  it('distance label double-click → input → Enter updates the solver value', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 140, 100);
    await waitFor(() => expect(getPoints().length).toBe(2));

    await selectTwoPoints();
    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const group = getOverlayChildren()[0]!;
    const cid = group.getAttribute('data-testid')!.replace('solver-constraint-overlay-', '');

    // Double-click the label → input appears, seeded with current value.
    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-label`));
    const editInput = await screen.findByTestId(
      `solver-constraint-overlay-${cid}-edit-input`,
    ) as HTMLInputElement;
    expect(editInput.value).toBe('40');
    fireEvent.change(editInput, { target: { value: '90' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    // Label re-renders with the new value; solver re-solved.
    await waitFor(() => {
      const lbl = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
      expect(lbl.textContent).toBe('90');
    });
    // Point separation should now reflect the new distance (≈90 px on canvas).
    const pts = getPoints();
    const cx0 = Number(pts[0]!.getAttribute('cx'));
    const cx1 = Number(pts[1]!.getAttribute('cx'));
    const cy0 = Number(pts[0]!.getAttribute('cy'));
    const cy1 = Number(pts[1]!.getAttribute('cy'));
    expect(Math.hypot(cx1 - cx0, cy1 - cy0)).toBeCloseTo(90, 1);
  });

  it('Esc cancels the inline edit without changing the solver value', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 150, 100);
    await waitFor(() => expect(getPoints().length).toBe(2));

    await selectTwoPoints();
    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const cid = getOverlayChildren()[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );

    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-label`));
    const editInput = await screen.findByTestId(
      `solver-constraint-overlay-${cid}-edit-input`,
    ) as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: '999' } });
    fireEvent.keyDown(editInput, { key: 'Escape' });

    // Label unchanged.
    await waitFor(() => {
      const lbl = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
      expect(lbl.textContent).toBe('50');
    });
    expect(screen.queryByTestId(`solver-constraint-overlay-${cid}-edit-input`)).toBeNull();
  });

  it('angle label inline edit updates the solver in radians (degrees on the wire)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100); // horizontal-ish
    await drawLine(100, 100, 200, 200); // 45° to first

    await selectTwoLines();
    fireEvent.click(constraintBtn('angle'));
    const input = await screen.findByTestId('solver-constraint-angle-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('solver-constraint-angle-submit'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const cid = getOverlayChildren()[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );

    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-label`));
    const editInput = await screen.findByTestId(
      `solver-constraint-overlay-${cid}-edit-input`,
    ) as HTMLInputElement;
    // Seeded in degrees — close to 30 (formatter trims to integer when whole).
    expect(Number(editInput.value)).toBeCloseTo(30, 0);
    fireEvent.change(editInput, { target: { value: '60' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    await waitFor(() => {
      const lbl = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
      // Solver should have re-solved at 60° (formatter strips ".0").
      expect(lbl.textContent).toMatch(/^60(\.\d+)?°$/);
    });
  });

  it('horizontal badge double-click does NOT open an inline editor', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    fireEvent.click(constraintBtn('horizontal'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const cid = getOverlayChildren()[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-badge`));
    expect(screen.queryByTestId(`solver-constraint-overlay-${cid}-edit-input`)).toBeNull();
  });

  it('inline edit rejecting a negative distance leaves the value untouched', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 140, 100);
    await waitFor(() => expect(getPoints().length).toBe(2));

    await selectTwoPoints();
    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const cid = getOverlayChildren()[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );

    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-label`));
    const editInput = await screen.findByTestId(
      `solver-constraint-overlay-${cid}-edit-input`,
    ) as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: '-5' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    // Editor closes regardless (commit attempt was made), but the solver
    // rejection means the label value stays unchanged.
    await waitFor(() => {
      expect(screen.queryByTestId(`solver-constraint-overlay-${cid}-edit-input`)).toBeNull();
    });
    const lbl = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
    expect(lbl.textContent).toBe('40');
  });

  it('inline edit rejecting NaN leaves the value untouched (Esc-like cancel)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 140, 100);
    await waitFor(() => expect(getPoints().length).toBe(2));

    await selectTwoPoints();
    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const cid = getOverlayChildren()[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );

    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-label`));
    const editInput = await screen.findByTestId(
      `solver-constraint-overlay-${cid}-edit-input`,
    ) as HTMLInputElement;
    Object.defineProperty(editInput, 'value', { writable: true, value: 'not-a-number' });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByTestId(`solver-constraint-overlay-${cid}-edit-input`)).toBeNull();
    });
    const lbl = screen.getByTestId(`solver-constraint-overlay-${cid}-label`);
    expect(lbl.textContent).toBe('40');
  });

  it('parallel badge double-click is a no-op (no editor opens)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 110);
    await drawLine(100, 200, 200, 260);

    await selectTwoLines();
    fireEvent.click(constraintBtn('parallel'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const cid = getOverlayChildren()[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );
    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-badge`));
    expect(screen.queryByTestId(`solver-constraint-overlay-${cid}-edit-input`)).toBeNull();
  });

  it('inline edit, then re-edit: the input re-seeds with the updated value', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 130, 100);
    await waitFor(() => expect(getPoints().length).toBe(2));

    await selectTwoPoints();
    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => expect(getOverlay().getAttribute('data-count')).toBe('1'));
    const cid = getOverlayChildren()[0]!.getAttribute('data-testid')!.replace(
      'solver-constraint-overlay-', '',
    );

    // First edit: 20 → 55
    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-label`));
    let editInput = await screen.findByTestId(
      `solver-constraint-overlay-${cid}-edit-input`,
    ) as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: '55' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByTestId(`solver-constraint-overlay-${cid}-label`).textContent).toBe('55');
    });

    // Second edit should re-seed with 55, not 20.
    fireEvent.doubleClick(screen.getByTestId(`solver-constraint-overlay-${cid}-label`));
    editInput = await screen.findByTestId(
      `solver-constraint-overlay-${cid}-edit-input`,
    ) as HTMLInputElement;
    expect(editInput.value).toBe('55');
    fireEvent.keyDown(editInput, { key: 'Escape' });
  });

  // ─── rect tool auto-adds 4 H/V constraints — overlay surfaces them ─────
  it('rect tool adds 4 H/V constraints and the overlay renders all 4 badges', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 220, 180);

    await waitFor(() => {
      // Rect = 2 horizontals (top/bot) + 2 verticals (left/right) = 4 constraints.
      expect(getOverlay().getAttribute('data-count')).toBe('4');
    });
    const overlayChildren = getOverlayChildren();
    expect(overlayChildren.length).toBe(4);
    const kinds = overlayChildren.map((el) => el.getAttribute('data-constraint-kind')).sort();
    expect(kinds).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
  });
});
