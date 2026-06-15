/** @vitest-environment jsdom */
/**
 * SolverSketchEditor + sketchTransform integration tests.
 *
 * Verifies the Phase 2.x sketchTransform wiring inside the editor:
 *   - "Transform" toggle (data-testid solver-sketch-transform-toggle).
 *     Default OFF; clicking mounts the inline panel below the constraint
 *     toolbar.
 *   - 4 op buttons (translate / rotate / scale / mirror) and their per-op
 *     input rows.
 *   - Translate / rotate apply through the solver and update geometry.
 *   - Scope inferred from selection: empty → 'all', non-empty → ids only.
 *   - Reset restores the snapshot captured when the panel opened.
 *   - Recapture button re-snapshots so subsequent reset uses the new
 *     baseline.
 *   - Mirror falls back to the 4-input row when selection has no axis pair;
 *     when 2 points are selected, a "use selected" badge appears and the op
 *     mirrors all OTHER points across them.
 *   - i18n: title surfaces in all 6 supported languages.
 *
 * The editor boots the planegcs WASM solver async — every test awaits the
 * 'ready' data-state via `mountReady`. Tests must NOT mutate the solver
 * before that state lands (queries before ready will throw).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor, {
  type EditorLang,
} from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

// ─── helpers ──────────────────────────────────────────────────────────────

async function mountReady(lang: EditorLang = 'en'): Promise<HTMLElement> {
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

function getPoints(): NodeListOf<SVGCircleElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-p"]',
  ) as NodeListOf<SVGCircleElement>;
}

function getLines(): NodeListOf<SVGLineElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-l"]',
  ) as NodeListOf<SVGLineElement>;
}

async function drawLine(
  startX: number, startY: number, endX: number, endY: number,
): Promise<void> {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
  const canvas = screen.getByTestId('solver-sketch-canvas');
  const before = getLines().length;
  clickAt(canvas, startX, startY);
  clickAt(canvas, endX, endY);
  await waitFor(() => expect(getLines().length).toBe(before + 1));
}

async function openTransform(): Promise<void> {
  fireEvent.click(screen.getByTestId('solver-sketch-transform-toggle'));
  await waitFor(() =>
    expect(screen.getByTestId('solver-sketch-transform-panel')).toBeInTheDocument(),
  );
}

function setInput(testid: string, value: string): void {
  const input = screen.getByTestId(testid) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

function selectPointByTestId(idx: number, shift = false): SVGCircleElement {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
  const pts = getPoints();
  const target = pts[idx]!;
  fireEvent.click(target, {
    clientX: Number(target.getAttribute('cx')),
    clientY: Number(target.getAttribute('cy')),
    shiftKey: shift,
  });
  return target;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────

describe('SolverSketchEditor + Transform panel integration', () => {
  it('Transform toggle is visible and starts OFF (panel not mounted)', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-sketch-transform-toggle') as HTMLButtonElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('solver-sketch-transform-panel')).toBeNull();
  });

  it('ON → 4 op buttons render in the panel (translate/rotate/scale/mirror)', async () => {
    await mountReady();
    await openTransform();
    for (const op of ['translate', 'rotate', 'scale', 'mirror']) {
      expect(
        screen.getByTestId(`solver-sketch-transform-op-${op}`),
      ).toBeInTheDocument();
    }
  });

  it('translate dx=10 moves every point by +10 in x (scope = all)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await openTransform();

    // Capture baseline xs before translate.
    const xsBefore = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));
    expect(xsBefore.length).toBe(2);

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-translate'));
    setInput('solver-sketch-transform-input-dx', '10');
    setInput('solver-sketch-transform-input-dy', '0');
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));

    await waitFor(() => {
      const xsAfter = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));
      for (let i = 0; i < xsAfter.length; i++) {
        expect(xsAfter[i]).toBeCloseTo((xsBefore[i] ?? 0) + 10, 1);
      }
    });
  });

  it('rotate 90° pivots an endpoint around the other endpoint', async () => {
    await mountReady();
    // Draw a short horizontal line. Snap may quantize the click coords to
    // the grid, so we DO NOT hard-code the endpoint position — we read it
    // back, compute the rotation analytically, and assert the post-op
    // values match. The first endpoint serves as the pivot.
    await drawLine(100, 100, 130, 100);
    await openTransform();

    const ptsBefore = getPoints();
    const pivotX = Number(ptsBefore[0]!.getAttribute('cx'));
    const pivotY = Number(ptsBefore[0]!.getAttribute('cy'));
    const x = Number(ptsBefore[1]!.getAttribute('cx'));
    const y = Number(ptsBefore[1]!.getAttribute('cy'));
    // 90° CCW around (pivotX, pivotY): (x,y) → (pivotX - (y-pivotY), pivotY + (x-pivotX)).
    const expX = pivotX - (y - pivotY);
    const expY = pivotY + (x - pivotX);

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-rotate'));
    setInput('solver-sketch-transform-input-angle', '90');
    setInput('solver-sketch-transform-input-cx', String(pivotX));
    setInput('solver-sketch-transform-input-cy', String(pivotY));
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));

    await waitFor(() => {
      const pts = getPoints();
      // Pivot is unchanged (rotation around itself).
      expect(Number(pts[0]!.getAttribute('cx'))).toBeCloseTo(pivotX, 1);
      expect(Number(pts[0]!.getAttribute('cy'))).toBeCloseTo(pivotY, 1);
      expect(Number(pts[1]!.getAttribute('cx'))).toBeCloseTo(expX, 1);
      expect(Number(pts[1]!.getAttribute('cy'))).toBeCloseTo(expY, 1);
    });
  });

  it('scope=selection only moves the selected point', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    // Select ONLY the first point.
    const sel = selectPointByTestId(0);
    expect(sel.getAttribute('aria-selected')).toBe('true');

    await openTransform();
    // Scope badge should now read "Selection (1)".
    const panel = screen.getByTestId('solver-sketch-transform-panel');
    expect(panel.getAttribute('data-scope')).toBe('selection');

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-translate'));
    setInput('solver-sketch-transform-input-dx', '50');
    setInput('solver-sketch-transform-input-dy', '0');
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));

    await waitFor(() => {
      const pts = getPoints();
      // Selected point moved by +50; non-selected stayed put.
      expect(Number(pts[0]!.getAttribute('cx'))).toBeCloseTo(150, 1);
      expect(Number(pts[1]!.getAttribute('cx'))).toBeCloseTo(200, 1);
    });
  });

  it('reset restores points to the snapshot captured at panel-open', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await openTransform();

    const xsBefore = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));

    // Translate by (30, 40), then reset.
    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-translate'));
    setInput('solver-sketch-transform-input-dx', '30');
    setInput('solver-sketch-transform-input-dy', '40');
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));
    await waitFor(() => {
      expect(
        Number(getPoints()[0]!.getAttribute('cx')),
      ).toBeCloseTo((xsBefore[0] ?? 0) + 30, 1);
    });

    fireEvent.click(screen.getByTestId('solver-sketch-transform-reset'));
    await waitFor(() => {
      const xsAfter = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));
      for (let i = 0; i < xsAfter.length; i++) {
        expect(xsAfter[i]).toBeCloseTo(xsBefore[i] ?? 0, 1);
      }
    });
  });

  it('recapture sets a new baseline → next reset undoes only post-recapture ops', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await openTransform();

    // First translate (30,0), then recapture, then translate (10,0), then reset.
    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-translate'));
    setInput('solver-sketch-transform-input-dx', '30');
    setInput('solver-sketch-transform-input-dy', '0');
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));
    await waitFor(() => {
      expect(Number(getPoints()[0]!.getAttribute('cx'))).toBeCloseTo(130, 1);
    });

    // Recapture — baseline is now (130, 100).
    fireEvent.click(screen.getByTestId('solver-sketch-transform-recapture'));

    // Second translate (+10).
    setInput('solver-sketch-transform-input-dx', '10');
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));
    await waitFor(() => {
      expect(Number(getPoints()[0]!.getAttribute('cx'))).toBeCloseTo(140, 1);
    });

    // Reset → back to recaptured baseline (130, not 100).
    fireEvent.click(screen.getByTestId('solver-sketch-transform-reset'));
    await waitFor(() => {
      expect(Number(getPoints()[0]!.getAttribute('cx'))).toBeCloseTo(130, 1);
    });
  });

  it('scale 2x around (100,100) doubles the offset of every other point', async () => {
    await mountReady();
    await drawLine(100, 100, 150, 100);
    await openTransform();

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-scale'));
    setInput('solver-sketch-transform-input-factor', '2');
    setInput('solver-sketch-transform-input-cx', '100');
    setInput('solver-sketch-transform-input-cy', '100');
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));

    await waitFor(() => {
      const pts = getPoints();
      expect(Number(pts[0]!.getAttribute('cx'))).toBeCloseTo(100, 1);
      // (150,100) scaled around (100,100) by 2 → (200,100).
      expect(Number(pts[1]!.getAttribute('cx'))).toBeCloseTo(200, 1);
    });
  });

  it('mirror across x-axis (y=100) flips a point above to below', async () => {
    await mountReady();
    // Draw a horizontal pair and a third tilted point so mirror across y=100
    // has something to flip.
    await drawLine(100, 100, 200, 100);
    await drawLine(150, 80, 150, 80); // degenerate 2nd line creates 2 colocated pts
    await openTransform();

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-mirror'));
    // Axis: horizontal line through (0,100)-(1,100) → y=100.
    setInput('solver-sketch-transform-input-mirror-ax', '0');
    setInput('solver-sketch-transform-input-mirror-ay', '100');
    setInput('solver-sketch-transform-input-mirror-bx', '1');
    setInput('solver-sketch-transform-input-mirror-by', '100');
    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));

    await waitFor(() => {
      const pts = getPoints();
      // First two points were at y=100 → unchanged after mirror across y=100.
      expect(Number(pts[0]!.getAttribute('cy'))).toBeCloseTo(100, 1);
      expect(Number(pts[1]!.getAttribute('cy'))).toBeCloseTo(100, 1);
      // The third point was at y=80 → mirrored to y=120 (2*100 - 80).
      expect(Number(pts[2]!.getAttribute('cy'))).toBeCloseTo(120, 1);
    });
  });

  it('scope badge flips to "Selection (N)" the moment a selection appears', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await openTransform();

    // Initially nothing selected → all-scope.
    expect(
      screen.getByTestId('solver-sketch-transform-panel').getAttribute('data-scope'),
    ).toBe('all');

    selectPointByTestId(0);
    await waitFor(() =>
      expect(
        screen.getByTestId('solver-sketch-transform-panel').getAttribute('data-scope'),
      ).toBe('selection'),
    );
  });

  it('switching ops swaps the input row (translate inputs gone when rotate selected)', async () => {
    await mountReady();
    await openTransform();

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-translate'));
    expect(screen.getByTestId('solver-sketch-transform-input-dx')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-rotate'));
    expect(screen.queryByTestId('solver-sketch-transform-input-dx')).toBeNull();
    expect(screen.getByTestId('solver-sketch-transform-input-angle')).toBeInTheDocument();
  });

  it('toggle OFF → panel unmounts; toggle back ON → fresh op-picker view (no input row)', async () => {
    await mountReady();
    await openTransform();
    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-translate'));
    expect(screen.getByTestId('solver-sketch-transform-input-dx')).toBeInTheDocument();

    // Toggle OFF.
    fireEvent.click(screen.getByTestId('solver-sketch-transform-toggle'));
    expect(screen.queryByTestId('solver-sketch-transform-panel')).toBeNull();

    // Toggle back ON — op state was cleared, so input row should be gone.
    fireEvent.click(screen.getByTestId('solver-sketch-transform-toggle'));
    expect(screen.getByTestId('solver-sketch-transform-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-sketch-transform-input-dx')).toBeNull();
  });

  it('mirror with 2 selected points uses them as axis (shows badge, hides A/B inputs)', async () => {
    await mountReady();
    // Two horizontal segments to give us 4 points; 3rd point will be the
    // one we mirror across the axis formed by points 0 and 1.
    await drawLine(100, 100, 200, 100);
    await drawLine(150, 80, 150, 80); // creates pts at y=80 (test-fixture for the body)

    // Shift-select first two points to mark them as the mirror axis.
    selectPointByTestId(0);
    selectPointByTestId(1, true);

    await openTransform();
    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-mirror'));

    // The 2-point axis shortcut renders a badge instead of A/B input fields.
    expect(
      screen.getByTestId('solver-sketch-transform-mirror-axis-from-selection'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('solver-sketch-transform-input-mirror-ax')).toBeNull();

    fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));

    await waitFor(() => {
      const pts = getPoints();
      // First two points sit ON the axis → unchanged.
      expect(Number(pts[0]!.getAttribute('cy'))).toBeCloseTo(100, 1);
      expect(Number(pts[1]!.getAttribute('cy'))).toBeCloseTo(100, 1);
      // Third point at y=80 mirrored across y=100 axis → y=120.
      expect(Number(pts[2]!.getAttribute('cy'))).toBeCloseTo(120, 1);
    });
  });

  it('toggle OFF does NOT mount the panel (back-compat: no test regression)', async () => {
    await mountReady();
    // Without ever clicking the toggle, no transform UI of any kind should
    // exist. Confirms back-compat: a sketch session that never opens the
    // panel sees zero new test surface.
    expect(screen.queryByTestId('solver-sketch-transform-panel')).toBeNull();
    expect(screen.queryByTestId('solver-sketch-transform-op-translate')).toBeNull();
    expect(screen.queryByTestId('solver-sketch-transform-apply')).toBeNull();
  });

  it('Apply with no op selected is a no-op (geometry unchanged)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await openTransform();
    // Don't click any op button. No "Apply" button is rendered (only per-op
    // rows include it), so we just confirm geometry is unchanged and the
    // panel still renders.
    expect(screen.queryByTestId('solver-sketch-transform-apply')).toBeNull();
    const xsBefore = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));
    // Re-render check after a tick — nothing changed.
    await waitFor(() => {
      const xsAfter = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));
      expect(xsAfter).toEqual(xsBefore);
    });
  });

  it('i18n: Korean toggle label reads "변환"', async () => {
    await mountReady('ko');
    const toggle = screen.getByTestId('solver-sketch-transform-toggle');
    expect(toggle.textContent).toContain('변환');
  });

  it('i18n: every locale renders the toggle with its own label', async () => {
    const expectations: Record<EditorLang, string> = {
      en: 'Transform',
      ko: '변환',
      ja: '変換',
      zh: '变换',
      es: 'Transformar',
      ar: 'تحويل',
    };
    for (const lang of Object.keys(expectations) as EditorLang[]) {
      cleanup();
      await mountReady(lang);
      const toggle = screen.getByTestId('solver-sketch-transform-toggle');
      expect(toggle.textContent ?? '').toContain(expectations[lang]);
    }
  });

  it('rotate input rejects NaN inputs (no throw, no movement)', async () => {
    await mountReady();
    await drawLine(100, 100, 200, 100);
    await openTransform();
    const xsBefore = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));

    fireEvent.click(screen.getByTestId('solver-sketch-transform-op-rotate'));
    // Empty angle string parses as NaN → guard in handleTransformApply
    // returns early before calling sketchTransform.rotate.
    setInput('solver-sketch-transform-input-angle', '');
    expect(() => {
      fireEvent.click(screen.getByTestId('solver-sketch-transform-apply'));
    }).not.toThrow();
    const xsAfter = Array.from(getPoints()).map((p) => Number(p.getAttribute('cx')));
    expect(xsAfter).toEqual(xsBefore);
  });
});
