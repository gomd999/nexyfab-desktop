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
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';
import { PROPERTY_DEBOUNCE_MS } from '@/app/[lang]/shape-generator/sketch/SketchEntityPropertyPanel';

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
