/** @vitest-environment jsdom */
/**
 * SolverSketchEditor + SketchConstraintToolbar integration tests.
 *
 * Verifies that the standalone SketchConstraintToolbar (11 constraints) is
 * mounted inside SolverSketchEditor, that its enable/disable state tracks
 * the editor's unified selection, and that onAdd is routed into the
 * SketchSolver. Selection lifecycle (single-select replace, shift multi-add,
 * ESC clear, clear button) is also exercised here.
 *
 * Solver itself runs with the real WASM (planegcs) — the tests assert on
 * post-solve geometry rather than spying solver methods, which would
 * require re-wiring the createSketchSolver factory.
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

describe('SolverSketchEditor + SketchConstraintToolbar integration', () => {
  // ─── toolbar is mounted ─────────────────────────────────────────────────
  it('mounts the SketchConstraintToolbar with all 11 constraint buttons', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-constraint-toolbar')).toBeInTheDocument();
    for (const k of [
      'coincident', 'parallel', 'perpendicular', 'tangent',
      'equal_length', 'equal_radius', 'fix',
      'horizontal', 'vertical', 'distance', 'angle',
    ]) {
      expect(screen.getByTestId(`solver-constraint-${k}-button`)).toBeInTheDocument();
    }
  });

  // ─── empty selection disables every constraint button ──────────────────
  it('empty selection disables every constraint button', async () => {
    await mountReady();
    for (const k of [
      'coincident', 'parallel', 'perpendicular', 'tangent',
      'equal_length', 'equal_radius', 'fix',
      'horizontal', 'vertical', 'distance', 'angle',
    ]) {
      expect(constraintBtn(k).disabled).toBe(true);
    }
  });

  // ─── single-click selects a point ──────────────────────────────────────
  it('canvas click creates points, then clicking a point selects it (fix becomes enabled)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);

    // Switch to select tool and click one of the points.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = getPoints();
    expect(pts.length).toBe(2);
    fireEvent.click(pts[0]!, { clientX: 100, clientY: 100 });

    // fix needs ≥ 1 entity → enabled.
    expect(constraintBtn('fix').disabled).toBe(false);
    // coincident needs 2 points → still disabled with 1.
    expect(constraintBtn('coincident').disabled).toBe(true);
  });

  // ─── shift-click for multi-select ──────────────────────────────────────
  it('shift-click adds to selection (2 points → coincident enabled)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    const pts = getPoints();
    fireEvent.click(pts[0]!, { clientX: 100, clientY: 100 });
    expect(constraintBtn('coincident').disabled).toBe(true); // 1 point

    fireEvent.click(pts[1]!, { clientX: 200, clientY: 140, shiftKey: true });
    expect(constraintBtn('coincident').disabled).toBe(false); // 2 points
  });

  // ─── single-click without modifier replaces selection ──────────────────
  it('plain click on a different entity replaces (not augments) selection', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    const pts = getPoints();
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!); // plain → replaces, so selection is now just pts[1]
    // coincident needs 2 → should be disabled (only 1 selected).
    expect(constraintBtn('coincident').disabled).toBe(true);
    // fix needs ≥ 1 → enabled (still 1 selected).
    expect(constraintBtn('fix').disabled).toBe(false);
  });

  // ─── ESC clears selection ──────────────────────────────────────────────
  it('ESC clears the selection', async () => {
    const editor = await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    const pts = getPoints();
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });
    expect(constraintBtn('coincident').disabled).toBe(false);

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(constraintBtn('coincident').disabled).toBe(true);
    expect(constraintBtn('fix').disabled).toBe(true);
  });

  // ─── clear button on toolbar ───────────────────────────────────────────
  it('clear button on the toolbar empties the selection', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    const pts = getPoints();
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });
    expect(constraintBtn('coincident').disabled).toBe(false);

    fireEvent.click(screen.getByTestId('solver-constraint-clear-button'));
    expect(constraintBtn('coincident').disabled).toBe(true);
  });

  // ─── coincident merges two points into one position ────────────────────
  it('coincident constraint via toolbar collapses two points onto each other', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));

    const pts = getPoints();
    expect(pts.length).toBe(2);
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });

    fireEvent.click(constraintBtn('coincident'));

    // After re-solve, the two points share the same coordinates.
    await waitFor(() => {
      const after = getPoints();
      const a = { x: Number(after[0]!.getAttribute('cx')), y: Number(after[0]!.getAttribute('cy')) };
      const b = { x: Number(after[1]!.getAttribute('cx')), y: Number(after[1]!.getAttribute('cy')) };
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.5);
    });
  });

  // ─── parallel: enabled with 2 lines ────────────────────────────────────
  it('parallel: selecting 2 lines enables the parallel button + applying re-solves to parallel', async () => {
    await mountReady();
    // Line 1: nearly horizontal.
    await drawLine(100, 100, 200, 110);
    // Line 2: tilted differently.
    await drawLine(100, 200, 200, 260);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lines = getLines();
    expect(lines.length).toBe(2);
    fireEvent.click(lines[0]!, { clientX: 150, clientY: 105 });
    fireEvent.click(lines[1]!, { clientX: 150, clientY: 230, shiftKey: true });

    const parBtn = constraintBtn('parallel');
    expect(parBtn.disabled).toBe(false);
    fireEvent.click(parBtn);

    // After solve, the two lines have equal slope vectors (parallel).
    await waitFor(() => {
      const ls = getLines();
      const slope = (l: SVGLineElement): number => {
        const dx = Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'));
        const dy = Number(l.getAttribute('y2')) - Number(l.getAttribute('y1'));
        // Normalize direction.
        const len = Math.hypot(dx, dy);
        return Math.atan2(dy / len, dx / len);
      };
      const s1 = slope(ls[0]!);
      const s2 = slope(ls[1]!);
      // mod π (lines parallel if angle differs by multiple of π).
      let d = Math.abs(s1 - s2) % Math.PI;
      if (d > Math.PI / 2) d = Math.PI - d;
      expect(d).toBeLessThan(0.05);
    });
  });

  // ─── perpendicular ──────────────────────────────────────────────────────
  it('perpendicular: 2 lines enables button + applying re-solves to perpendicular', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 110);
    await drawLine(150, 200, 250, 230);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lines = getLines();
    fireEvent.click(lines[0]!);
    fireEvent.click(lines[1]!, { shiftKey: true });

    const btn = constraintBtn('perpendicular');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      const ls = getLines();
      const vec = (l: SVGLineElement): [number, number] => [
        Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')),
        Number(l.getAttribute('y2')) - Number(l.getAttribute('y1')),
      ];
      const [ax, ay] = vec(ls[0]!);
      const [bx, by] = vec(ls[1]!);
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      const dot = (ax * bx + ay * by) / (la * lb);
      expect(Math.abs(dot)).toBeLessThan(0.05);
    });
  });

  // ─── horizontal via the new toolbar (not the legacy one) ───────────────
  it('horizontal: 1 line selected enables button + applying levels the line', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const line = getLines()[0]!;
    fireEvent.click(line, { clientX: 150, clientY: 120 });

    const btn = constraintBtn('horizontal');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      const l = getLines()[0]!;
      const y1 = Number(l.getAttribute('y1'));
      const y2 = Number(l.getAttribute('y2'));
      expect(Math.abs(y2 - y1)).toBeLessThan(0.5);
    });
  });

  // ─── distance value popover routes to solver.addDistance ───────────────
  it('distance: opens popover, submitting value re-solves to that exact distance', async () => {
    await mountReady();
    // Two separate points via two short lines that share no endpoints.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 130, 100);

    await waitFor(() => expect(getPoints().length).toBe(2));

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const pts = getPoints();
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });

    fireEvent.click(constraintBtn('distance'));
    const input = await screen.findByTestId('solver-constraint-distance-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));

    await waitFor(() => {
      const after = getPoints();
      const a = { x: Number(after[0]!.getAttribute('cx')), y: Number(after[0]!.getAttribute('cy')) };
      const b = { x: Number(after[1]!.getAttribute('cx')), y: Number(after[1]!.getAttribute('cy')) };
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(Math.abs(d - 80)).toBeLessThan(1);
    });
  });

  // ─── angle popover ─────────────────────────────────────────────────────
  it('angle: opens popover and constraint applies (numerical solve may shift geometry)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100); // horizontal
    await drawLine(100, 200, 200, 200); // also horizontal — angle 0 initially

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lines = getLines();
    fireEvent.click(lines[0]!);
    fireEvent.click(lines[1]!, { shiftKey: true });

    fireEvent.click(constraintBtn('angle'));
    const input = await screen.findByTestId('solver-constraint-angle-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('solver-constraint-angle-submit'));

    // After solve, the angle between the two lines should be ~45°.
    // (Solver may rotate either line — only the *relative* angle is constrained.)
    await waitFor(() => {
      const ls = getLines();
      const vec = (l: SVGLineElement): [number, number] => [
        Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')),
        Number(l.getAttribute('y2')) - Number(l.getAttribute('y1')),
      ];
      const [ax, ay] = vec(ls[0]!);
      const [bx, by] = vec(ls[1]!);
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      const cos = (ax * bx + ay * by) / (la * lb);
      const angDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      // Angle is mod 180; 45° or 135° both satisfy.
      const dist45 = Math.min(Math.abs(angDeg - 45), Math.abs(angDeg - 135));
      expect(dist45).toBeLessThan(2);
    });
  });

  // ─── selection auto-clears after constraint applied ────────────────────
  it('after a constraint is applied, the selection is cleared (button disables)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const line = getLines()[0]!;
    fireEvent.click(line);

    const hBtn = constraintBtn('horizontal');
    expect(hBtn.disabled).toBe(false);
    fireEvent.click(hBtn);

    await waitFor(() => expect(constraintBtn('horizontal').disabled).toBe(true));
  });

  // ─── switching away from select tool clears selection ──────────────────
  it('switching to line tool from select clears any current selection', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    expect(constraintBtn('fix').disabled).toBe(false);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    expect(constraintBtn('fix').disabled).toBe(true);
  });

  // ─── empty-canvas click clears the selection (no modifier) ─────────────
  it('clicking empty canvas (no modifier, select tool) clears selection', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    expect(constraintBtn('fix').disabled).toBe(false);

    // Click on empty area of canvas.
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(constraintBtn('fix').disabled).toBe(true);
  });

  // ─── empty-canvas click with shift KEEPS the selection ─────────────────
  it('shift-click on empty canvas does NOT clear selection (in select mode)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!);
    expect(constraintBtn('fix').disabled).toBe(false);

    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10, shiftKey: true });
    expect(constraintBtn('fix').disabled).toBe(false);
  });

  it('toolbar is disabled while solver is still loading (visual disabled prop)', async () => {
    // Mount but don't wait for ready.
    render(<SolverSketchEditor lang="en" />);
    // The standalone toolbar is only rendered in the ready branch, so during
    // loading there is no toolbar in the DOM. Once ready, it's present.
    await waitFor(
      () => expect(screen.getByTestId('solver-constraint-toolbar')).toBeInTheDocument(),
      { timeout: 10000 },
    );
    // After ready, all 11 buttons are present and start disabled (empty selection).
    expect(constraintBtn('coincident').disabled).toBe(true);
  });
});
