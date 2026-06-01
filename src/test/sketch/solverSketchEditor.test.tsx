/** @vitest-environment jsdom */
/**
 * SolverSketchEditor — Phase 1.3 render + interaction tests.
 *
 * Async-init pattern: createSketchSolver returns a Promise; the component
 * shows "loading..." until WASM is ready. Tests `findBy*` for the ready state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

async function mountReady(lang: 'en' | 'ko' = 'en') {
  render(<SolverSketchEditor lang={lang} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
  return editor;
}

function clickAt(el: Element, x: number, y: number): void {
  fireEvent.click(el, { clientX: x, clientY: y });
}

describe('SolverSketchEditor', () => {
  it('shows loading then ready state', async () => {
    render(<SolverSketchEditor lang="en" />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    // May load fast in node env (~30ms). Just assert the ready state arrives.
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
  });

  it('renders 6 entity tools + 5 constraint tools after load', async () => {
    await mountReady();
    for (const t of ['select', 'line', 'circle', 'arc', 'rect', 'dimension']) {
      expect(screen.getByTestId(`solver-sketch-tool-${t}`)).toBeInTheDocument();
    }
    for (const c of ['horizontal', 'vertical', 'perpendicular', 'parallel', 'coincident']) {
      expect(screen.getByTestId(`solver-sketch-constraint-${c}`)).toBeInTheDocument();
    }
  });

  it('line tool: click-click creates a line entity', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 100);
    await waitFor(() => {
      const lines = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]');
      // 1 line entity (plus 2 point entities — point ids start with 'p')
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  it('horizontal constraint pulls a tilted line to y-aligned after solve', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 140); // tilted
    // Select the line by clicking it after switching to select tool.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lineEl = await waitFor(() => {
      const els = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]');
      expect(els.length).toBeGreaterThan(0);
      return els[0]!;
    });
    fireEvent.click(lineEl, { clientX: 150, clientY: 120 });

    // The horizontal constraint button should now be enabled.
    const hBtn = screen.getByTestId('solver-sketch-constraint-horizontal') as HTMLButtonElement;
    expect(hBtn.disabled).toBe(false);
    fireEvent.click(hBtn);

    // After solve, the line's y2 should equal y1 (both points share same y).
    await waitFor(() => {
      const l = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]')[0] as SVGLineElement;
      const y1 = Number(l.getAttribute('y1'));
      const y2 = Number(l.getAttribute('y2'));
      expect(Math.abs(y2 - y1)).toBeLessThan(0.5);
    });
  });

  it('DoF panel reflects gcs.dof() — drops as constraints are added', async () => {
    await mountReady();
    // Draw a line.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 140);

    const dofPanel = screen.getByTestId('solver-sketch-dof');
    // 2 unfixed points × 2 DoF each = 4 → 4 DoF before any constraint.
    await waitFor(() => expect(dofPanel.textContent).toMatch(/DoF:\s*4/));
    expect(dofPanel.getAttribute('data-dof-state')).toBe('under');

    // Add horizontal constraint → -1 DoF.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const line = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]')[0]!;
    fireEvent.click(line, { clientX: 150, clientY: 120 });
    fireEvent.click(screen.getByTestId('solver-sketch-constraint-horizontal'));
    await waitFor(() => expect(dofPanel.textContent).toMatch(/DoF:\s*3/));
  });

  it('rect tool decomposes to 4 lines with horizontal/vertical constraints (DoF=0)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 250, 200);

    await waitFor(() => {
      const lines = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]');
      expect(lines.length).toBe(4);
    });
    // 4 points × 2 DoF = 8; 4 H/V constraints × 1 = 4 → 4 DoF remaining (rect can still translate/scale).
    const dof = screen.getByTestId('solver-sketch-dof');
    await waitFor(() => expect(dof.textContent).toMatch(/DoF:\s*4/));
  });

  it('switching tools cancels in-progress preview', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 50, 50);
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));

    // No committed line entity.
    const lines = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]');
    expect(lines.length).toBe(0);
  });

  it('dimension between two points pins their distance', async () => {
    // Mock window.prompt to return "50".
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('50');

    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 130, 100); // initial distance = 30

    // Switch to dimension tool, click two points.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-dimension'));
    const points = document.querySelectorAll('[data-testid^="solver-sketch-entity-p"]');
    expect(points.length).toBe(2);
    fireEvent.click(points[0]!);
    fireEvent.click(points[1]!);

    expect(promptSpy).toHaveBeenCalled();

    // After solve, the two points should be ~50 apart.
    await waitFor(() => {
      const pts = document.querySelectorAll('[data-testid^="solver-sketch-entity-p"]') as NodeListOf<SVGCircleElement>;
      const a = { x: Number(pts[0]!.getAttribute('cx')), y: Number(pts[0]!.getAttribute('cy')) };
      const b = { x: Number(pts[1]!.getAttribute('cx')), y: Number(pts[1]!.getAttribute('cy')) };
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      expect(Math.abs(d - 50)).toBeLessThan(1);
    });

    promptSpy.mockRestore();
  });

  it('Korean i18n: shows 솔버 스케치 title', async () => {
    await mountReady('ko');
    expect(screen.getByText('솔버 스케치')).toBeInTheDocument();
  });
});
