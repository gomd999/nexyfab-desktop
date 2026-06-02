/** @vitest-environment jsdom */
/**
 * SolverSketchEditor — Phase 2 modification-tool tests (trim/extend/offset).
 *
 * Mirrors the patterns in solverSketchEditor.test.tsx (async-init solver,
 * `data-testid` scheme, jsdom env). The three tools are intentionally
 * simple in Phase 1:
 *   - trim   = drop a line entity from the view model
 *   - extend = move endpoint of one line to its intersection with another
 *   - offset = create a parallel line at perpendicular distance (window.prompt)
 *
 * Full SW-style "trim to next intersection" and multi-entity chain offset
 * land in Phase 2/3 per docs/strategy/SW_FUSION_FEATURE_SPEC_FULL.md §1.5.1.
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

function getLines(): NodeListOf<SVGLineElement> {
  return document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]') as NodeListOf<SVGLineElement>;
}

function getPoints(): NodeListOf<SVGCircleElement> {
  return document.querySelectorAll('[data-testid^="solver-sketch-entity-p"]') as NodeListOf<SVGCircleElement>;
}

describe('SolverSketchEditor — modification tools', () => {
  it('renders the 3 new tool buttons (trim/extend/offset) after load', async () => {
    await mountReady();
    for (const t of ['trim', 'extend', 'offset']) {
      expect(screen.getByTestId(`solver-sketch-tool-${t}`)).toBeInTheDocument();
    }
  });

  it('trim: clicking past the intersection moves that endpoint to the intersection (SW-style)', async () => {
    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');

    // Line A: horizontal (100,100) → (300,100). p1, p2 are the first 2 points.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 100, 100);
    clickAt(canvas, 300, 100);

    // Line B: vertical (200, 50) → (200, 200). Crosses A at (200,100).
    clickAt(canvas, 200, 50);
    clickAt(canvas, 200, 200);

    await waitFor(() => expect(getLines().length).toBe(2));
    expect(getPoints().length).toBe(4);

    // Click line A on the p2 side of the intersection (x=250 > 200 = intersection).
    fireEvent.click(screen.getByTestId('solver-sketch-tool-trim'));
    fireEvent.click(getLines()[0]!, { clientX: 250, clientY: 100 });

    // Both lines must still exist (no entity removed; just endpoint moved).
    await waitFor(() => expect(getLines().length).toBe(2));
    // The 2nd point (p2 of line A) should now be at (200, 100).
    await waitFor(() => {
      const p2 = getPoints()[1]!;
      expect(Math.abs(Number(p2.getAttribute('cx')) - 200)).toBeLessThan(1);
      expect(Math.abs(Number(p2.getAttribute('cy')) - 100)).toBeLessThan(1);
    });
    // p1 of line A must be unchanged (still at 100,100).
    const p1 = getPoints()[0]!;
    expect(Math.abs(Number(p1.getAttribute('cx')) - 100)).toBeLessThan(1);
    expect(Math.abs(Number(p1.getAttribute('cy')) - 100)).toBeLessThan(1);
  });

  it('trim: no intersection found falls back to removing the whole line (legacy)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');

    // Two parallel horizontal lines — no intersection.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 100);
    clickAt(canvas, 100, 200);
    clickAt(canvas, 200, 200);

    await waitFor(() => expect(getLines().length).toBe(2));

    fireEvent.click(screen.getByTestId('solver-sketch-tool-trim'));
    // Click middle of first line.
    fireEvent.click(getLines()[0]!, { clientX: 150, clientY: 100 });

    await waitFor(() => expect(getLines().length).toBe(1));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no intersection'));
    warnSpy.mockRestore();
  });

  it('trim: multiple intersections → trims to the one nearest the click', async () => {
    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');

    // Line A: horizontal (50,100) → (400,100). Points 0, 1.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 50, 100);
    clickAt(canvas, 400, 100);

    // Line B: vertical at x=150 (50→200). Crosses A at (150,100). Points 2, 3.
    clickAt(canvas, 150, 50);
    clickAt(canvas, 150, 200);

    // Line C: vertical at x=300 (50→200). Crosses A at (300,100). Points 4, 5.
    clickAt(canvas, 300, 50);
    clickAt(canvas, 300, 200);

    await waitFor(() => expect(getLines().length).toBe(3));

    // Click line A at x=350 (past x=300 intersection, on the p2 side).
    // Nearest intersection to the click is (300,100), so p2 should snap there.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-trim'));
    fireEvent.click(getLines()[0]!, { clientX: 350, clientY: 100 });

    await waitFor(() => {
      const p2 = getPoints()[1]!;
      expect(Math.abs(Number(p2.getAttribute('cx')) - 300)).toBeLessThan(1);
      expect(Math.abs(Number(p2.getAttribute('cy')) - 100)).toBeLessThan(1);
    });
    // All 3 lines remain.
    expect(getLines().length).toBe(3);
  });

  it('trim: clicking on a circle is a no-op (Phase 1 supports lines only)', async () => {
    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');

    // Draw a circle: center (200,200), edge at (250,200) → r=50.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-circle'));
    clickAt(canvas, 200, 200);
    clickAt(canvas, 250, 200);

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]').length).toBe(1);
    });

    fireEvent.click(screen.getByTestId('solver-sketch-tool-trim'));
    const circleEl = document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]')[0]!;
    fireEvent.click(circleEl, { clientX: 250, clientY: 200 });

    // Circle still exists, untouched.
    expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]').length).toBe(1);
  });

  it('trim: clicking a point with trim tool is a no-op (only lines are trimmable)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 100);

    await waitFor(() => expect(getLines().length).toBe(1));
    const pointCountBefore = getPoints().length;
    const lineCountBefore = getLines().length;

    fireEvent.click(screen.getByTestId('solver-sketch-tool-trim'));
    fireEvent.click(getPoints()[0]!);

    // No change.
    expect(getLines().length).toBe(lineCountBefore);
    expect(getPoints().length).toBe(pointCountBefore);
  });

  it('extend: moves an endpoint outward to intersection with another line', async () => {
    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');

    // Line A: horizontal short segment (100,100) → (150,100). p2 will be extended right.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 100, 100);
    clickAt(canvas, 150, 100);

    // Line B: vertical at x=200 → (200, 50) → (200, 200). Crosses line A's
    // infinite extension at (200, 100), which is past line A's p2 (t > 1).
    clickAt(canvas, 200, 50);
    clickAt(canvas, 200, 200);

    await waitFor(() => expect(getLines().length).toBe(2));

    // Switch to extend, then click line A's p2 endpoint (3rd point overall:
    // p1@(100,100), p2@(150,100), p3@(200,50), p4@(200,200)).
    fireEvent.click(screen.getByTestId('solver-sketch-tool-extend'));
    const points = getPoints();
    expect(points.length).toBe(4);
    // p2 of line A is the second-created point.
    fireEvent.click(points[1]!);

    // After extend, that point should be at (200, 100).
    await waitFor(() => {
      const p = getPoints()[1]!;
      const cx = Number(p.getAttribute('cx'));
      const cy = Number(p.getAttribute('cy'));
      expect(Math.abs(cx - 200)).toBeLessThan(1);
      expect(Math.abs(cy - 100)).toBeLessThan(1);
    });
  });

  it('extend: refuses to shrink a line (intersection between endpoints)', async () => {
    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');

    // Line A: (100,100) → (300,100), long horizontal.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 100, 100);
    clickAt(canvas, 300, 100);

    // Line B: vertical at x=200 → crosses A in the middle (t=0.5).
    clickAt(canvas, 200, 50);
    clickAt(canvas, 200, 200);

    await waitFor(() => expect(getLines().length).toBe(2));

    fireEvent.click(screen.getByTestId('solver-sketch-tool-extend'));
    const points = getPoints();
    const beforeCx = Number(points[1]!.getAttribute('cx'));
    const beforeCy = Number(points[1]!.getAttribute('cy'));

    fireEvent.click(points[1]!); // p2 of line A — would require shrink

    // p2 should not have moved.
    const after = getPoints()[1]!;
    expect(Number(after.getAttribute('cx'))).toBe(beforeCx);
    expect(Number(after.getAttribute('cy'))).toBe(beforeCy);
  });

  it('offset: creates a parallel line at perpendicular distance on the click side', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('20');

    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');

    // Horizontal line (100, 100) → (200, 100).
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 100);
    await waitFor(() => expect(getLines().length).toBe(1));

    fireEvent.click(screen.getByTestId('solver-sketch-tool-offset'));
    // Click below the original line (y=150) → offset should land at y=120
    // (below = positive y in svg coords, perpendicular rotated 90° CCW from
    // a left-to-right line points to +y = downward — same side as the click).
    fireEvent.click(getLines()[0]!, { clientX: 150, clientY: 150 });

    expect(promptSpy).toHaveBeenCalled();
    await waitFor(() => expect(getLines().length).toBe(2));

    // The new line's two endpoints should both have y ~ 120.
    const newLine = getLines()[1]!;
    const y1 = Number(newLine.getAttribute('y1'));
    const y2 = Number(newLine.getAttribute('y2'));
    expect(Math.abs(y1 - 120)).toBeLessThan(1);
    expect(Math.abs(y2 - 120)).toBeLessThan(1);

    promptSpy.mockRestore();
  });

  it('offset: prompt cancel (null) creates no new line', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 100);
    await waitFor(() => expect(getLines().length).toBe(1));

    fireEvent.click(screen.getByTestId('solver-sketch-tool-offset'));
    fireEvent.click(getLines()[0]!, { clientX: 150, clientY: 150 });

    expect(promptSpy).toHaveBeenCalled();
    // No second line was added.
    expect(getLines().length).toBe(1);

    promptSpy.mockRestore();
  });

  it('offset: invalid prompt value (negative / NaN) is rejected', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('not-a-number');

    await mountReady();
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 100);
    await waitFor(() => expect(getLines().length).toBe(1));

    fireEvent.click(screen.getByTestId('solver-sketch-tool-offset'));
    fireEvent.click(getLines()[0]!, { clientX: 150, clientY: 150 });

    expect(getLines().length).toBe(1);
    promptSpy.mockRestore();
  });

  it('Korean i18n: trim/extend/offset buttons render Korean labels', async () => {
    await mountReady('ko');
    expect(screen.getByTestId('solver-sketch-tool-trim').textContent).toContain('자르기');
    expect(screen.getByTestId('solver-sketch-tool-extend').textContent).toContain('연장');
    expect(screen.getByTestId('solver-sketch-tool-offset').textContent).toContain('간격복사');
  });
});
