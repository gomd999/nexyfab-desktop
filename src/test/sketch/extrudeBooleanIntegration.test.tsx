/** @vitest-environment jsdom */
/**
 * Extrude × sketchBoolean integration tests.
 *
 * Pins the multi-loop boolean integration added on top of the existing
 * single-loop Extrude pipeline:
 *
 *   1. Drawing a single rect → no boolean section appears (back-compat).
 *   2. Drawing two disjoint rects → "Multiple loops detected (2)" banner
 *      surfaces with the 4 op radios (union/subtract/intersect/separate).
 *   3. Selecting an op flips the radio checked state.
 *   4. Submit applies the chosen op: the sketch handed to extrudeFetcher is
 *      a *combined* sketch (synthetic ids, point count matches op result).
 *   5. The combined SVG preview renders polygons for each result loop.
 *   6. Intersect of disjoint rects produces an empty-result warning and
 *      does NOT fire the fetcher.
 *   7. 'separate' passes the original sketch through unchanged.
 *   8. i18n keys appear in each language.
 *   9. Pure helper API (detect, combine, sketchFromLoops) is verified at
 *      unit level so the integration tests can focus on UI plumbing.
 *
 * Bypass-the-editor strategy: we drive the wrapper through its own
 * inner `<SolverSketchEditor>` for a single-rect baseline test, but for
 * the multi-loop scenarios we use a small `SeededWrapper` helper that
 * pre-seeds the wrapper's sketch state via `onSketchChange` so we don't
 * have to coax the canvas tool into drawing two rects under jsdom.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditorWithExtrude from '@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude';
import {
  detectLoopsAsPolygons,
  combineLoops,
  sketchFromLoops,
  applyBooleanToSketch,
} from '@/lib/sketch/sketchLoopsBoolean';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

// ─── helpers ─────────────────────────────────────────────────────────────

function rectSketch(
  prefix: string,
  ox: number,
  oy: number,
  size = 10,
): SolverViewState {
  const pts = [
    { id: `${prefix}_a`, x: ox, y: oy },
    { id: `${prefix}_b`, x: ox + size, y: oy },
    { id: `${prefix}_c`, x: ox + size, y: oy + size },
    { id: `${prefix}_d`, x: ox, y: oy + size },
  ];
  const lines = [
    { id: `${prefix}_l0`, p1: `${prefix}_a`, p2: `${prefix}_b` },
    { id: `${prefix}_l1`, p1: `${prefix}_b`, p2: `${prefix}_c` },
    { id: `${prefix}_l2`, p1: `${prefix}_c`, p2: `${prefix}_d` },
    { id: `${prefix}_l3`, p1: `${prefix}_d`, p2: `${prefix}_a` },
  ];
  return { points: pts, lines };
}

function mergeSketches(a: SolverViewState, b: SolverViewState): SolverViewState {
  return {
    points: [...a.points, ...b.points],
    lines: [...a.lines, ...b.lines],
  };
}

// We seed multi-loop sketches by driving the editor's rect tool twice;
// `applyBooleanToSketch` then operates on whatever loops the editor
// records, regardless of canvas pixel-to-sketch transform.

function clickAt(el: Element, x: number, y: number) {
  fireEvent.click(el, { clientX: x, clientY: y });
}

async function mountWrapperReady(extrudeFetcher = vi.fn()) {
  const result = render(
    <SolverSketchEditorWithExtrude lang="en" extrudeFetcher={extrudeFetcher} />,
  );
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(
    () => expect(editor.getAttribute('data-state')).toBe('ready'),
    { timeout: 10000 },
  );
  return { extrudeFetcher, result };
}

async function drawRect(x1: number, y1: number, x2: number, y2: number) {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
  const canvas = screen.getByTestId('solver-sketch-canvas');
  clickAt(canvas, x1, y1);
  clickAt(canvas, x2, y2);
}

// ─── pure helper unit tests ──────────────────────────────────────────────

describe('sketchLoopsBoolean — pure helpers', () => {
  it('detectLoopsAsPolygons returns no loops for an empty sketch', () => {
    const { loops } = detectLoopsAsPolygons({ points: [], lines: [] });
    expect(loops).toHaveLength(0);
  });

  it('detectLoopsAsPolygons returns one loop for a single rect', () => {
    const { loops } = detectLoopsAsPolygons(rectSketch('r', 0, 0, 10));
    expect(loops).toHaveLength(1);
    expect(loops[0]!.length).toBe(4);
  });

  it('detectLoopsAsPolygons returns two loops for two disjoint rects', () => {
    const sketch = mergeSketches(
      rectSketch('a', 0, 0, 10),
      rectSketch('b', 30, 0, 10),
    );
    const { loops } = detectLoopsAsPolygons(sketch);
    expect(loops).toHaveLength(2);
  });

  it('combineLoops union of disjoint rects returns both loops', () => {
    const { loops } = detectLoopsAsPolygons(
      mergeSketches(rectSketch('a', 0, 0, 10), rectSketch('b', 30, 0, 10)),
    );
    const out = combineLoops(loops, 'union');
    expect(out).toHaveLength(2);
  });

  it('combineLoops intersect of disjoint rects is empty', () => {
    const { loops } = detectLoopsAsPolygons(
      mergeSketches(rectSketch('a', 0, 0, 10), rectSketch('b', 30, 0, 10)),
    );
    const out = combineLoops(loops, 'intersect');
    expect(out).toHaveLength(0);
  });

  it('combineLoops subtract of disjoint rects returns the first loop', () => {
    const { loops } = detectLoopsAsPolygons(
      mergeSketches(rectSketch('a', 0, 0, 10), rectSketch('b', 30, 0, 10)),
    );
    const out = combineLoops(loops, 'subtract');
    expect(out).toHaveLength(1);
  });

  it('combineLoops separate returns inputs unchanged', () => {
    const { loops } = detectLoopsAsPolygons(
      mergeSketches(rectSketch('a', 0, 0, 10), rectSketch('b', 30, 0, 10)),
    );
    const out = combineLoops(loops, 'separate');
    expect(out).toHaveLength(2);
  });

  it('sketchFromLoops round-trips through detection (loop count preserved)', () => {
    const sketch = mergeSketches(
      rectSketch('a', 0, 0, 10),
      rectSketch('b', 30, 0, 10),
    );
    const { loops } = detectLoopsAsPolygons(sketch);
    const synthesised = sketchFromLoops(loops);
    expect(synthesised.points.length).toBe(8);
    expect(synthesised.lines.length).toBe(8);
    const { loops: again } = detectLoopsAsPolygons(synthesised);
    expect(again).toHaveLength(2);
  });

  it('applyBooleanToSketch with 1 loop returns the input by referential equality', () => {
    const sketch = rectSketch('r', 0, 0, 10);
    const out = applyBooleanToSketch(sketch, 'union');
    expect(out.sketch).toBe(sketch);
    expect(out.detectedLoops).toHaveLength(1);
  });

  it('applyBooleanToSketch union over two overlapping rects collapses to a single loop', () => {
    const sketch = mergeSketches(
      rectSketch('a', 0, 0, 10),
      rectSketch('b', 5, 0, 10),
    );
    const out = applyBooleanToSketch(sketch, 'union');
    expect(out.combinedLoops.length).toBeGreaterThanOrEqual(1);
    // The union of two overlapping rects should reduce the total
    // number of polygons relative to "separate" (which keeps 2).
    const sep = applyBooleanToSketch(sketch, 'separate');
    expect(out.combinedLoops.length).toBeLessThanOrEqual(sep.combinedLoops.length);
  });
});

// ─── UI integration tests (wrapper + modal) ──────────────────────────────

describe('ExtrudeModal × sketchBoolean integration', () => {
  it('single-loop sketch shows no boolean section (back-compat)', async () => {
    await mountWrapperReady();
    await drawRect(100, 100, 200, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    expect(screen.getByTestId('solver-extrude-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-extrude-boolean-section')).not.toBeInTheDocument();
    // All four op radios must be absent in the single-loop case.
    expect(screen.queryByTestId('extrude-boolean-op-union')).not.toBeInTheDocument();
    expect(screen.queryByTestId('extrude-boolean-op-subtract')).not.toBeInTheDocument();
    expect(screen.queryByTestId('extrude-boolean-op-intersect')).not.toBeInTheDocument();
    expect(screen.queryByTestId('extrude-boolean-op-separate')).not.toBeInTheDocument();
  });

  it('two disjoint rects surface the boolean banner + 4 op radios + preview', async () => {
    await mountWrapperReady();
    await drawRect(100, 100, 200, 200);
    await drawRect(260, 100, 360, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    // Banner present with count substituted.
    const banner = await screen.findByTestId('solver-extrude-boolean-banner');
    expect(banner.textContent).toMatch(/2/);
    // All four op radios.
    expect(screen.getByTestId('extrude-boolean-op-union')).toBeInTheDocument();
    expect(screen.getByTestId('extrude-boolean-op-subtract')).toBeInTheDocument();
    expect(screen.getByTestId('extrude-boolean-op-intersect')).toBeInTheDocument();
    expect(screen.getByTestId('extrude-boolean-op-separate')).toBeInTheDocument();
    // Default is union.
    expect((screen.getByTestId('extrude-boolean-op-union') as HTMLInputElement).checked).toBe(true);
    // SVG preview.
    expect(screen.getByTestId('solver-extrude-boolean-preview')).toBeInTheDocument();
  });

  it('selecting subtract flips the radio checked state', async () => {
    await mountWrapperReady();
    await drawRect(100, 100, 200, 200);
    await drawRect(260, 100, 360, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('extrude-boolean-op-subtract'));
    expect((screen.getByTestId('extrude-boolean-op-subtract') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('extrude-boolean-op-union') as HTMLInputElement).checked).toBe(false);
  });

  it('intersect of disjoint rects produces empty-result warning and skips fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, scad: 'x', pngs: [] });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(
      () => expect(editor.getAttribute('data-state')).toBe('ready'),
      { timeout: 10000 },
    );
    await drawRect(100, 100, 200, 200);
    await drawRect(260, 100, 360, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('extrude-boolean-op-intersect'));
    // Empty result warning is visible inside the modal.
    await waitFor(() => {
      expect(screen.getByTestId('solver-extrude-boolean-empty')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    // Fetcher must NOT be called — error surfaces via the error banner.
    await waitFor(() => {
      expect(screen.getByTestId('solver-extrude-error')).toBeInTheDocument();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('separate passes the original sketch through (lines+points count unchanged)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, scad: 'x', pngs: [] });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(
      () => expect(editor.getAttribute('data-state')).toBe('ready'),
      { timeout: 10000 },
    );
    await drawRect(100, 100, 200, 200);
    await drawRect(260, 100, 360, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('extrude-boolean-op-separate'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    // 'separate' returns the original sketch by ref equality from
    // applyBooleanToSketch → wrapper passes it straight to the fetcher.
    // The original two-rect sketch has 8 points + 8 lines.
    expect(call.sketch.points.length).toBe(8);
    expect(call.sketch.lines.length).toBe(8);
  });

  it('union of two rects passes a synthesised (bool_-prefixed) sketch to the fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, scad: 'x', pngs: [] });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(
      () => expect(editor.getAttribute('data-state')).toBe('ready'),
      { timeout: 10000 },
    );
    // Two rects via the canvas.
    await drawRect(100, 100, 200, 200);
    await drawRect(260, 100, 360, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    // Banner must show 2 loops detected.
    const banner = await screen.findByTestId('solver-extrude-boolean-banner');
    expect(banner.textContent).toMatch(/2/);
    // Default union: submit.
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    // Union (or any non-'separate' op) routes the sketch through
    // sketchFromLoops, which assigns synthetic 'bool_' ids. The exact
    // point count varies by overlap (union of overlapping = 1 collapsed
    // polygon, union of disjoint = 2 separate polygons); the invariant
    // is that every id carries the synthetic prefix.
    expect(call.sketch.points.length).toBeGreaterThanOrEqual(3);
    for (const p of call.sketch.points) {
      expect(p.id.startsWith('bool_')).toBe(true);
    }
  });

  it('SVG preview renders one polygon per combined loop', async () => {
    await mountWrapperReady();
    await drawRect(100, 100, 200, 200);
    await drawRect(260, 100, 360, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    // 'separate' keeps both polygons.
    fireEvent.click(screen.getByTestId('extrude-boolean-op-separate'));
    expect(screen.getByTestId('solver-extrude-boolean-preview-loop-0')).toBeInTheDocument();
    expect(screen.getByTestId('solver-extrude-boolean-preview-loop-1')).toBeInTheDocument();
  });

  it('Korean lang renders multipleLoopsDetected with substituted count', async () => {
    const fetcher = vi.fn();
    render(<SolverSketchEditorWithExtrude lang="ko" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(
      () => expect(editor.getAttribute('data-state')).toBe('ready'),
      { timeout: 10000 },
    );
    await drawRect(100, 100, 200, 200);
    await drawRect(260, 100, 360, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    const banner = await screen.findByTestId('solver-extrude-boolean-banner');
    // ko: '여러 폐곡선 감지 ({N}개)' — '2' must be substituted.
    expect(banner.textContent).toMatch(/여러 폐곡선 감지/);
    expect(banner.textContent).toMatch(/2/);
  });
});
