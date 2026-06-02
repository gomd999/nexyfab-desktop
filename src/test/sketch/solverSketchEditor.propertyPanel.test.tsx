/** @vitest-environment jsdom */
/**
 * SolverSketchEditor + SketchEntityPropertyPanel integration tests.
 *
 * Verifies that the standalone SketchEntityPropertyPanel is mounted in
 * SolverSketchEditor's right sidebar, that its `selection`/`entityData`
 * track the editor's unified selection, and that its `onChange` /
 * `onDelete` callbacks route through SketchSolver setters and trigger
 * a re-solve.
 *
 * Solver itself runs with the real WASM (planegcs). Tests assert on
 * post-solve geometry + DOM state rather than spying solver internals.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';
import { PROPERTY_DEBOUNCE_MS } from '@/app/[lang]/shape-generator/sketch/SketchEntityPropertyPanel';
import { SketchSolver } from '@/lib/sketch/solver';

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

function getCircles(): NodeListOf<SVGCircleElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-c"]',
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

async function drawCircle(
  centerX: number, centerY: number, edgeX: number, edgeY: number,
): Promise<void> {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-circle'));
  const canvas = screen.getByTestId('solver-sketch-canvas');
  clickAt(canvas, centerX, centerY);
  clickAt(canvas, edgeX, edgeY);
  const expected = getCircles().length;
  await waitFor(() => expect(getCircles().length).toBeGreaterThanOrEqual(expected));
}

/**
 * Debounce-aware change helper. The property-panel inputs debounce at
 * PROPERTY_DEBOUNCE_MS so a raw `fireEvent.change` will not fire onChange
 * synchronously — we have to wait for the debounce window to elapse.
 *
 * Uses act() + a real-timer wait (vs fake timers) because the solver's
 * async tick + planegcs WASM use the real Node timers/microtasks; the
 * vitest hybrid timer-mode causes deadlocks against WASM init.
 */
async function flushDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, PROPERTY_DEBOUNCE_MS + 30));
  });
}

describe('SolverSketchEditor + SketchEntityPropertyPanel integration', () => {
  // ─── property sidebar mount ────────────────────────────────────────────
  it('mounts the property panel sidebar in the ready state', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-sketch-property-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-panel')).toBeInTheDocument();
    // Empty selection → hint visible inside the panel.
    expect(screen.getByTestId('solver-entity-property-empty')).toBeInTheDocument();
  });

  // ─── point selection populates panel ───────────────────────────────────
  it('selecting a point exposes x/y/isFixed inputs in the panel', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    const pts = getPoints();
    expect(pts.length).toBe(2);
    fireEvent.click(pts[0]!, { clientX: 100, clientY: 100 });

    expect(screen.getByTestId('solver-entity-property-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-y-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-isFixed-checkbox')).toBeInTheDocument();
  });

  // ─── editing x in panel updates the solver point ───────────────────────
  it('changing point x in the panel updates the SVG point cx after debounce', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getPoints()[0]!);

    const xInput = screen.getByTestId('solver-entity-property-x-input') as HTMLInputElement;
    fireEvent.change(xInput, { target: { value: '50' } });
    await flushDebounce();

    await waitFor(() => {
      const pt = getPoints()[0]!;
      expect(Number(pt.getAttribute('cx'))).toBeCloseTo(50, 1);
    });
  });

  it('changing point y in the panel updates the SVG point cy after debounce', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getPoints()[0]!);

    const yInput = screen.getByTestId('solver-entity-property-y-input') as HTMLInputElement;
    fireEvent.change(yInput, { target: { value: '25' } });
    await flushDebounce();

    await waitFor(() => {
      const pt = getPoints()[0]!;
      expect(Number(pt.getAttribute('cy'))).toBeCloseTo(25, 1);
    });
  });

  // ─── isFixed toggle + visual red marker ────────────────────────────────
  it('toggling isFixed marks the point fixed and renders it red (data-point-fixed=true)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getPoints()[0]!);

    const cb = screen.getByTestId('solver-entity-property-isFixed-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);

    await waitFor(() => {
      const pt = getPoints()[0]!;
      expect(pt.getAttribute('data-point-fixed')).toBe('true');
      // #dc2626 is the fixed-point fill (see SVG circle.fill ternary).
      expect(pt.getAttribute('fill')).toBe('#dc2626');
    });
  });

  // ─── line selection populates panel ────────────────────────────────────
  it('selecting a line shows x1/y1/x2/y2 inputs + length + angle readouts', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);

    expect(screen.getByTestId('solver-entity-property-x1-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-y1-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-x2-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-y2-input')).toBeInTheDocument();
    const lenReadout = screen.getByTestId('solver-entity-property-length-readout');
    const angReadout = screen.getByTestId('solver-entity-property-angle-readout');
    // Length ~100 (horizontal line of dx=100).
    expect(Number(lenReadout.textContent)).toBeCloseTo(100, 0);
    // Angle ~0° for a horizontal line.
    expect(angReadout.textContent).toContain('0');
  });

  // ─── editing line x2 moves the second endpoint ─────────────────────────
  it('editing line x2 moves the second endpoint via solver setLineEndpoints', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);

    const x2Input = screen.getByTestId('solver-entity-property-x2-input') as HTMLInputElement;
    fireEvent.change(x2Input, { target: { value: '300' } });
    await flushDebounce();

    await waitFor(() => {
      const line = getLines()[0]!;
      expect(Number(line.getAttribute('x2'))).toBeCloseTo(300, 1);
    });
  });

  // ─── circle selection + radius edit ────────────────────────────────────
  it('selecting a circle shows cx/cy/radius inputs', async () => {
    await mountReady();
    await drawCircle(150, 150, 200, 150);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getCircles()[0]!);

    expect(screen.getByTestId('solver-entity-property-cx-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-cy-input')).toBeInTheDocument();
    const rInput = screen.getByTestId('solver-entity-property-radius-input') as HTMLInputElement;
    expect(rInput).toBeInTheDocument();
    // Distance from (150,150) to (200,150) = 50.
    expect(Number(rInput.value)).toBeCloseTo(50, 0);
  });

  it('editing circle radius updates the rendered radius after debounce', async () => {
    await mountReady();
    await drawCircle(150, 150, 200, 150);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getCircles()[0]!);

    const rInput = screen.getByTestId('solver-entity-property-radius-input') as HTMLInputElement;
    fireEvent.change(rInput, { target: { value: '75' } });
    await flushDebounce();

    await waitFor(() => {
      const c = getCircles()[0]!;
      expect(Number(c.getAttribute('r'))).toBeCloseTo(75, 1);
    });
  });

  // ─── delete button removes entity from view + selection ────────────────
  it('clicking delete removes the entity and clears its selection', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    expect(screen.getByTestId('solver-entity-delete-button')).toBeInTheDocument();

    const before = getLines().length;
    fireEvent.click(screen.getByTestId('solver-entity-delete-button'));

    await waitFor(() => {
      expect(getLines().length).toBe(before - 1);
    });
    // Selection cleared → empty hint reappears.
    expect(screen.getByTestId('solver-entity-property-empty')).toBeInTheDocument();
  });

  // ─── multi-select shows the multi placeholder, hides inputs ────────────
  it('shift-clicking 2 entities shows the multi-selection placeholder (no field inputs)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = getPoints();
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });

    expect(screen.getByTestId('solver-entity-property-multi')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-entity-property-x-input')).toBeNull();
  });

  // ─── panel x edit triggers a re-solve (status pill stays ready) ────────
  it('panel edit triggers a re-solve (status pill remains "ready" when no conflict)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getPoints()[0]!);

    const xInput = screen.getByTestId('solver-entity-property-x-input') as HTMLInputElement;
    fireEvent.change(xInput, { target: { value: '120' } });
    await flushDebounce();

    const status = screen.getByTestId('solver-sketch-status');
    // No constraints active → status stays in its empty-hint or "ready" mode.
    expect(['ready', 'redundant']).toContain(status.getAttribute('data-status'));
  });

  // ─── selection ↔ panel sync: switching selection rewires panel ─────────
  it('clicking a different entity rewires the panel to show the new entity', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    const pts = getPoints();
    // First select a point — panel shows point fields.
    fireEvent.click(pts[0]!);
    expect(screen.getByTestId('solver-entity-property-x-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-entity-property-x1-input')).toBeNull();

    // Now select the line — panel rewires to line fields.
    fireEvent.click(getLines()[0]!);
    expect(screen.getByTestId('solver-entity-property-x1-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-entity-property-x-input')).toBeNull();
  });

  // ─── clearing selection (ESC) returns panel to empty hint ──────────────
  it('ESC clears selection and the panel returns to its empty-hint state', async () => {
    const editor = await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getPoints()[0]!);
    expect(screen.getByTestId('solver-entity-property-x-input')).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByTestId('solver-entity-property-x-input')).toBeNull();
    expect(screen.getByTestId('solver-entity-property-empty')).toBeInTheDocument();
  });

  // ─── invalid radius is rejected (no solver update, aria-invalid set) ───
  it('invalid radius (negative) is rejected and the SVG circle radius stays unchanged', async () => {
    await mountReady();
    await drawCircle(150, 150, 200, 150);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getCircles()[0]!);

    const beforeR = Number(getCircles()[0]!.getAttribute('r'));
    const rInput = screen.getByTestId('solver-entity-property-radius-input') as HTMLInputElement;
    fireEvent.change(rInput, { target: { value: '-10' } });
    await flushDebounce();

    expect(rInput.getAttribute('aria-invalid')).toBe('true');
    // SVG radius didn't change because onChange was suppressed by the panel.
    expect(Number(getCircles()[0]!.getAttribute('r'))).toBe(beforeR);
  });

  // ─── re-toggling isFixed off restores the default fill ─────────────────
  it('toggling isFixed off again returns the point to its default (non-red) fill', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getPoints()[0]!);

    const cb = screen.getByTestId('solver-entity-property-isFixed-checkbox') as HTMLInputElement;
    fireEvent.click(cb); // on
    await waitFor(() => expect(getPoints()[0]!.getAttribute('data-point-fixed')).toBe('true'));
    fireEvent.click(cb); // off
    await waitFor(() => expect(getPoints()[0]!.getAttribute('data-point-fixed')).toBe('false'));
    // Default selected fill is the cyan/selected color, not red.
    expect(getPoints()[0]!.getAttribute('fill')).not.toBe('#dc2626');
  });
});

// ─── Phase 2 bulk-edit integration ─────────────────────────────────────────
//
// SketchEntityPropertyPanel's BulkEditor fires onChange / onDelete *once
// per selected entity* synchronously. The editor must:
//   1. apply each solver mutation immediately so subsequent calls in the
//      burst see the new state,
//   2. mirror each mutation into the view-side `entities` array,
//   3. defer the re-solve so a burst of N calls collapses to 1 solve.
//
// These tests draw geometry, build a multi-selection by shift-clicking, and
// then drive the bulk inputs / bulk delete button. Solve count is verified
// by spying on SketchSolver.prototype.solve.
describe('SolverSketchEditor — bulk property panel edits', () => {
  /** Wait for the scheduleSolveAndApply setTimeout(0) plus an extra macrotask
   *  so the deferred solve has definitely flushed. */
  async function flushDeferredSolve(): Promise<void> {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  async function selectAllPoints(): Promise<void> {
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    // Clear any prior selection so the first point-click reliably starts a
    // fresh single-select (otherwise re-clicking an already-selected point
    // toggles it off — see handleEntityClick's single-select branch).
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 0, clientY: 0 });
    const pts = Array.from(getPoints());
    fireEvent.click(pts[0]!);
    for (let i = 1; i < pts.length; i++) {
      fireEvent.click(pts[i]!, { shiftKey: true });
    }
  }

  // ─── 3-point selection populates bulk x/y/isFixed inputs ─────────────
  it('selecting 3 points exposes solver-entity-bulk-x / -y / -isFixed in the panel', async () => {
    await mountReady();
    // Three independent lines → 6 points (we then select 3 of them).
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);
    await drawLine(120, 140, 220, 140);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    expect(pts.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });
    fireEvent.click(pts[2]!, { shiftKey: true });

    expect(screen.getByTestId('solver-entity-property-multi')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-bulk-x')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-bulk-y')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-bulk-isFixed')).toBeInTheDocument();
    // Per-entity single-edit inputs must NOT leak into bulk mode.
    expect(screen.queryByTestId('solver-entity-property-x-input')).toBeNull();
  });

  // ─── bulk x edit propagates to every selected point ──────────────────
  it('bulk x edit moves every selected point to the new x via solver.setPointX', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);
    await drawLine(120, 140, 220, 140);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    // Pick the three "left endpoints" (the start of each line).
    const targets = [pts[0]!, pts[2]!, pts[4]!];
    const targetIds = targets.map((p) => p.getAttribute('data-testid')!);
    fireEvent.click(targets[0]!);
    fireEvent.click(targets[1]!, { shiftKey: true });
    fireEvent.click(targets[2]!, { shiftKey: true });

    const bulkX = screen.getByTestId('solver-entity-bulk-x') as HTMLInputElement;
    fireEvent.change(bulkX, { target: { value: '50' } });
    await flushDebounce();
    await flushDeferredSolve();

    await waitFor(() => {
      for (const id of targetIds) {
        const pt = document.querySelector(`[data-testid="${id}"]`) as SVGCircleElement;
        expect(Number(pt.getAttribute('cx'))).toBeCloseTo(50, 1);
      }
    });
  });

  // ─── bulk y edit propagates similarly ────────────────────────────────
  it('bulk y edit moves every selected point to the new y', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);
    await drawLine(120, 140, 220, 140);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    const targets = [pts[0]!, pts[2]!, pts[4]!];
    const targetIds = targets.map((p) => p.getAttribute('data-testid')!);
    fireEvent.click(targets[0]!);
    fireEvent.click(targets[1]!, { shiftKey: true });
    fireEvent.click(targets[2]!, { shiftKey: true });

    const bulkY = screen.getByTestId('solver-entity-bulk-y') as HTMLInputElement;
    fireEvent.change(bulkY, { target: { value: '77' } });
    await flushDebounce();
    await flushDeferredSolve();

    await waitFor(() => {
      for (const id of targetIds) {
        const pt = document.querySelector(`[data-testid="${id}"]`) as SVGCircleElement;
        expect(Number(pt.getAttribute('cy'))).toBeCloseTo(77, 1);
      }
    });
  });

  // ─── bulk delete removes all selected entities + clears selection ────
  it('bulk delete button removes every selected point and clears selection', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);
    await drawLine(120, 140, 220, 140);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await selectAllPoints();
      const beforePts = getPoints().length;
      expect(beforePts).toBeGreaterThanOrEqual(6);
      fireEvent.click(screen.getByTestId('solver-entity-bulk-delete'));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      await flushDeferredSolve();

      await waitFor(() => {
        // All 6 points should be removed (selectAllPoints picked every point).
        expect(getPoints().length).toBe(0);
      });
      // Selection cleared → empty hint reappears.
      expect(screen.getByTestId('solver-entity-property-empty')).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  // ─── mixed selection (point + line) shows mixed hint, no bulk fields ─
  it('mixed selection (point + line) shows the mixed hint and hides bulk number inputs', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    const line = getLines()[0]!;
    fireEvent.click(pts[0]!);
    fireEvent.click(line, { shiftKey: true });

    expect(screen.getByTestId('solver-entity-property-mixed')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-entity-bulk-x')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-y')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-isFixed')).toBeNull();
  });

  // ─── 2 lines → noBulkFields message (no editable common fields) ──────
  it('selecting 2 lines shows the multi wrapper with no bulk-editable fields', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    await drawLine(120, 160, 240, 200);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lines = Array.from(getLines());
    fireEvent.click(lines[0]!);
    fireEvent.click(lines[1]!, { shiftKey: true });

    expect(screen.getByTestId('solver-entity-property-multi')).toBeInTheDocument();
    // None of the bulk number / boolean inputs are exposed for lines.
    expect(screen.queryByTestId('solver-entity-bulk-x')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-y')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-isFixed')).toBeNull();
    // Per-entity (single-edit) line inputs must not leak through either.
    expect(screen.queryByTestId('solver-entity-property-x1-input')).toBeNull();
  });

  // ─── 2 circles → noBulkFields message ────────────────────────────────
  it('selecting 2 circles shows the multi wrapper with no bulk-editable fields', async () => {
    await mountReady();
    await drawCircle(150, 150, 200, 150);
    await drawCircle(250, 250, 300, 250);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const circles = Array.from(getCircles());
    expect(circles.length).toBe(2);
    fireEvent.click(circles[0]!);
    fireEvent.click(circles[1]!, { shiftKey: true });

    expect(screen.getByTestId('solver-entity-property-multi')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-entity-bulk-x')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-isFixed')).toBeNull();
    expect(screen.queryByTestId('solver-entity-property-radius-input')).toBeNull();
  });

  // ─── bulk isFixed tri-state: mixed → fix all ─────────────────────────
  it('bulk isFixed click on mixed state pins every selected point as fixed', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);

    // First fix one of the four points via the single-select path so the
    // bulk state is mixed before we toggle.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    fireEvent.click(pts[0]!);
    const cb = screen.getByTestId('solver-entity-property-isFixed-checkbox') as HTMLInputElement;
    fireEvent.click(cb);
    await flushDeferredSolve();
    await waitFor(() => expect(pts[0]!.getAttribute('data-point-fixed')).toBe('true'));

    // Now extend selection to ALL points and trigger the bulk isFixed checkbox.
    await selectAllPoints();
    const bulkFixed = screen.getByTestId('solver-entity-bulk-isFixed') as HTMLInputElement;
    // Mixed state → indeterminate, checked=false. Click normalises to true.
    expect(bulkFixed.indeterminate).toBe(true);
    fireEvent.click(bulkFixed);
    await flushDeferredSolve();

    await waitFor(() => {
      for (const pt of Array.from(getPoints())) {
        expect(pt.getAttribute('data-point-fixed')).toBe('true');
      }
    });
  });

  // ─── bulk-edit fires solver.solve() only once (debounce contract) ────
  //
  // Without debouncing, a 3-point bulk x change would fire 3 onChange calls
  // in sequence → 3 solver.solve() invocations. With scheduleSolveAndApply
  // coalescing into a single macrotask, the entire burst should collapse to
  // exactly 1 solve. The test asserts the total solve count post-flush.
  it('3-point bulk x edit triggers solver.solve() exactly once for the burst', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);
    await drawLine(120, 140, 220, 140);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    const targets = [pts[0]!, pts[2]!, pts[4]!];
    fireEvent.click(targets[0]!);
    fireEvent.click(targets[1]!, { shiftKey: true });
    fireEvent.click(targets[2]!, { shiftKey: true });

    // Spy AFTER setup so we only count the bulk-edit's solves (the canvas
    // clicks earlier already triggered their own solves we don't want to
    // count against the debounce contract).
    const solveSpy = vi.spyOn(SketchSolver.prototype, 'solve');
    try {
      const bulkX = screen.getByTestId('solver-entity-bulk-x') as HTMLInputElement;
      fireEvent.change(bulkX, { target: { value: '60' } });
      await flushDebounce();
      await flushDeferredSolve();
      // Three synchronous setPointX mutations → one solver.solve() call.
      expect(solveSpy.mock.calls.length).toBe(1);
    } finally {
      solveSpy.mockRestore();
    }
  });

  // ─── bulk-delete also collapses to one solve ─────────────────────────
  it('3-point bulk delete triggers solver.solve() at most once for the burst', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);
    await drawLine(120, 140, 220, 140);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    const targets = [pts[0]!, pts[2]!, pts[4]!];
    fireEvent.click(targets[0]!);
    fireEvent.click(targets[1]!, { shiftKey: true });
    fireEvent.click(targets[2]!, { shiftKey: true });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const solveSpy = vi.spyOn(SketchSolver.prototype, 'solve');
    try {
      fireEvent.click(screen.getByTestId('solver-entity-bulk-delete'));
      // Solve hasn't run yet — only synchronous remove + state updates so far.
      expect(solveSpy.mock.calls.length).toBe(0);
      await flushDeferredSolve();
      expect(solveSpy.mock.calls.length).toBe(1);
    } finally {
      solveSpy.mockRestore();
      confirmSpy.mockRestore();
    }
  });

  // ─── bulk-delete cancelled does NOT touch the solver ─────────────────
  it('bulk delete cancelled (confirm = false) does not remove any entity', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await drawLine(110, 120, 210, 120);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    const before = pts.length;
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });
    fireEvent.click(pts[2]!, { shiftKey: true });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      fireEvent.click(screen.getByTestId('solver-entity-bulk-delete'));
      await flushDeferredSolve();
      expect(getPoints().length).toBe(before);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  // ─── multi-select header still uses the canonical "Multiple selection" label ─
  it('bulk header preserves the "Multiple selection (N)" label from Phase 1.B', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = Array.from(getPoints());
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });

    const multi = screen.getByTestId('solver-entity-property-multi');
    expect(multi.textContent).toMatch(/Multiple selection.*2/);
  });
});
