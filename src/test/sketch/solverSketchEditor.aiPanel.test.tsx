/** @vitest-environment jsdom */
/**
 * SolverSketchEditor ↔ SketchConstraintAiPanel integration tests.
 *
 * Covers the wiring added by the ZZZZZ batch:
 *   - "AI" toggle button (`solver-sketch-ai-toggle`) sits in the title bar.
 *   - Panel default = OFF (no `sketch-ai-panel` mounted on initial load).
 *   - Toggle ON → panel mounts; toggle again → panel unmounts.
 *   - NL → intent → solver mapping (per-intent SELECTED placeholder
 *     substitution against the editor's current selection).
 *   - 6-lang label rendering for the toggle button + parent panel.
 *
 * Strategy: drive the real component (with its real planegcs WASM solver
 * spun up via async init). Each test mounts a fresh editor, draws a few
 * canonical entities via the canvas tools, then turns on the AI panel
 * and runs an NL prompt through it. Post-condition asserts are on
 * post-solve geometry (point/line coords, DoF readout) — same style as
 * solverSketchEditor.constraints.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

async function mountReady(
  lang: 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar' = 'en',
): Promise<HTMLElement> {
  render(<SolverSketchEditor lang={lang} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(
    () => expect(editor.getAttribute('data-state')).toBe('ready'),
    { timeout: 10000 },
  );
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

function typeInto(testId: string, value: string): void {
  const el = screen.getByTestId(testId) as HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

async function sendPrompt(prompt: string): Promise<void> {
  typeInto('sketch-ai-input', prompt);
  fireEvent.click(screen.getByTestId('sketch-ai-send'));
  await waitFor(() =>
    expect(screen.queryByTestId('sketch-ai-apply')).not.toBeNull(),
  );
}

async function applyPrompt(prompt: string): Promise<void> {
  await sendPrompt(prompt);
  fireEvent.click(screen.getByTestId('sketch-ai-apply'));
}

describe('SolverSketchEditor + SketchConstraintAiPanel integration', () => {
  it('renders the "AI" toggle button (default off, panel not mounted)', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-sketch-ai-toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('sketch-ai-panel')).toBeNull();
  });

  it('clicking the toggle mounts the AI panel; clicking again unmounts it', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-sketch-ai-toggle');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('sketch-ai-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-ai-input')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('sketch-ai-panel')).toBeNull();
  });

  it('"make all lines horizontal" applies addHorizontal to every line', async () => {
    await mountReady();
    // Two tilted lines.
    await drawLine(100, 100, 200, 140);
    await drawLine(220, 100, 320, 150);
    expect(getLines().length).toBe(2);

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await applyPrompt('make all lines horizontal');

    // After solve, both lines should be ~horizontal (y1 ≈ y2 for each).
    await waitFor(() => {
      const lines = getLines();
      expect(lines.length).toBe(2);
      for (const l of Array.from(lines)) {
        const y1 = Number(l.getAttribute('y1'));
        const y2 = Number(l.getAttribute('y2'));
        expect(Math.abs(y2 - y1)).toBeLessThan(0.5);
      }
    });
  });

  it('"make all lines vertical" applies addVertical to every line', async () => {
    await mountReady();
    await drawLine(100, 100, 140, 200);
    await drawLine(220, 80, 280, 180);
    expect(getLines().length).toBe(2);

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await applyPrompt('make all lines vertical');

    await waitFor(() => {
      const lines = getLines();
      expect(lines.length).toBe(2);
      for (const l of Array.from(lines)) {
        const x1 = Number(l.getAttribute('x1'));
        const x2 = Number(l.getAttribute('x2'));
        expect(Math.abs(x2 - x1)).toBeLessThan(0.5);
      }
    });
  });

  it('"make selected parallel" with 2 lines selected → both lines become parallel', async () => {
    await mountReady();
    // Line A: tilted +20° -ish
    await drawLine(100, 100, 200, 140);
    // Line B: different slope
    await drawLine(220, 100, 320, 160);
    expect(getLines().length).toBe(2);

    // Select both lines via shift-click.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lines = Array.from(getLines());
    fireEvent.click(lines[0]!, { clientX: 150, clientY: 120 });
    fireEvent.click(lines[1]!, { clientX: 270, clientY: 130, shiftKey: true });

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await applyPrompt('make selected lines parallel');

    // Both lines should have ~equal slope after solve.
    await waitFor(() => {
      const out = Array.from(getLines());
      expect(out.length).toBe(2);
      const slopes = out.map((l) => {
        const dx = Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'));
        const dy = Number(l.getAttribute('y2')) - Number(l.getAttribute('y1'));
        return Math.atan2(dy, dx);
      });
      // Normalize π flip for parallel detection.
      const norm = (a: number): number => {
        let v = a;
        while (v > Math.PI / 2) v -= Math.PI;
        while (v < -Math.PI / 2) v += Math.PI;
        return v;
      };
      expect(Math.abs(norm(slopes[0]!) - norm(slopes[1]!))).toBeLessThan(0.05);
    });
  });

  it('"make selected perpendicular" with 2 lines selected → lines become perpendicular', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100); // already horizontal
    await drawLine(220, 100, 320, 160); // tilted
    expect(getLines().length).toBe(2);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lines = Array.from(getLines());
    fireEvent.click(lines[0]!, { clientX: 150, clientY: 100 });
    fireEvent.click(lines[1]!, { clientX: 270, clientY: 130, shiftKey: true });

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await applyPrompt('make selected lines perpendicular');

    // Dot product of the two line direction vectors should be ~0.
    await waitFor(() => {
      const out = Array.from(getLines());
      expect(out.length).toBe(2);
      const dirs = out.map((l) => {
        const dx = Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'));
        const dy = Number(l.getAttribute('y2')) - Number(l.getAttribute('y1'));
        const len = Math.hypot(dx, dy);
        return { x: dx / len, y: dy / len };
      });
      const dot = dirs[0]!.x * dirs[1]!.x + dirs[0]!.y * dirs[1]!.y;
      expect(Math.abs(dot)).toBeLessThan(0.05);
    });
  });

  it('"set distance 50" with 2 points selected → addDistance pins them 50 apart', async () => {
    await mountReady();
    await drawLine(100, 100, 130, 100); // 30 apart
    const pts = Array.from(getPoints());
    expect(pts.length).toBe(2);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await applyPrompt('set distance 50');

    await waitFor(() => {
      const out = Array.from(getPoints());
      const a = { x: Number(out[0]!.getAttribute('cx')), y: Number(out[0]!.getAttribute('cy')) };
      const b = { x: Number(out[1]!.getAttribute('cx')), y: Number(out[1]!.getAttribute('cy')) };
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      expect(Math.abs(d - 50)).toBeLessThan(1);
    });
  });

  it('"merge selected points" with 2 points selected → solver makes them coincident', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    const pts = Array.from(getPoints());
    expect(pts.length).toBe(2);

    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(pts[0]!);
    fireEvent.click(pts[1]!, { shiftKey: true });

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await applyPrompt('merge selected points');

    // After coincident, the two points share the same coordinates.
    await waitFor(() => {
      const out = Array.from(getPoints());
      const a = { x: Number(out[0]!.getAttribute('cx')), y: Number(out[0]!.getAttribute('cy')) };
      const b = { x: Number(out[1]!.getAttribute('cx')), y: Number(out[1]!.getAttribute('cy')) };
      expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    });
  });

  it('parallel intent is a silent no-op when fewer than 2 lines are selected', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    await drawLine(220, 100, 320, 160);
    // Only select the first line.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    fireEvent.click(getLines()[0]!, { clientX: 150, clientY: 120 });

    // Snapshot the second line's slope before.
    const beforeLine2 = getLines()[1]!;
    const slopeBefore =
      Math.atan2(
        Number(beforeLine2.getAttribute('y2')) - Number(beforeLine2.getAttribute('y1')),
        Number(beforeLine2.getAttribute('x2')) - Number(beforeLine2.getAttribute('x1')),
      );

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await applyPrompt('make selected lines parallel');

    // No throw, no change to the unselected line.
    await waitFor(() => {
      const after = getLines()[1]!;
      const slopeAfter =
        Math.atan2(
          Number(after.getAttribute('y2')) - Number(after.getAttribute('y1')),
          Number(after.getAttribute('x2')) - Number(after.getAttribute('x1')),
        );
      expect(Math.abs(slopeAfter - slopeBefore)).toBeLessThan(0.001);
    });
  });

  it('selectionCounts.lines is forwarded so the panel preview shows "Apply N constraints"', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 140);
    await drawLine(220, 100, 320, 160);

    // Select both lines.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
    const lines = Array.from(getLines());
    fireEvent.click(lines[0]!, { clientX: 150, clientY: 120 });
    fireEvent.click(lines[1]!, { clientX: 270, clientY: 130, shiftKey: true });

    fireEvent.click(screen.getByTestId('solver-sketch-ai-toggle'));
    await sendPrompt('make all lines horizontal');

    // Panel should now show "Apply 2 horizontal constraints" (selectionCounts.lines=2).
    expect(screen.getByTestId('sketch-ai-preview').textContent).toContain('2');
  });

  it('Korean i18n: toggle button label = AI', async () => {
    await mountReady('ko');
    expect(screen.getByTestId('solver-sketch-ai-toggle').textContent).toBe('AI');
  });

  it('6-lang smoke: toggle button renders for every language', async () => {
    const langs: Array<'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar'> = [
      'en', 'ko', 'ja', 'zh', 'es', 'ar',
    ];
    for (const lang of langs) {
      const { unmount } = render(<SolverSketchEditor lang={lang} />);
      const editor = await screen.findByTestId('solver-sketch-editor');
      await waitFor(
        () => expect(editor.getAttribute('data-state')).toBe('ready'),
        { timeout: 10000 },
      );
      expect(screen.getByTestId('solver-sketch-ai-toggle')).toBeInTheDocument();
      unmount();
    }
  });
});
