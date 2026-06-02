/** @vitest-environment jsdom */
/**
 * SolverSketchEditorWithExtrude — Sweep / Loft / Pattern wiring tests.
 *
 * Phase 2.A wires three previously standalone modals (SweepModal, LoftModal,
 * PatternModal) into the wrapper alongside the existing Extrude + Revolve.
 * These tests pin:
 *   - the three new buttons exist with the right test ids,
 *   - they are gated by the same canExtrude predicate (sketch has ≥3 pts
 *     and ≥3 lines),
 *   - clicking each button opens the corresponding modal,
 *   - clicking each modal's Cancel closes it,
 *   - the sweepFetcher prop is threaded into SweepModal and invoked on submit.
 *
 * The new modals are dynamic-imported in the wrapper to keep the bundle
 * small for users who never open them, so `findByTestId` is used (await
 * the async chunk load) instead of synchronous `getByTestId`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditorWithExtrude from '@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude';

function clickAt(el: Element, x: number, y: number) {
  fireEvent.click(el, { clientX: x, clientY: y });
}

async function mountReady() {
  render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={vi.fn()} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
}

async function drawRect() {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
  const canvas = screen.getByTestId('solver-sketch-canvas');
  clickAt(canvas, 100, 100);
  clickAt(canvas, 200, 200);
}

describe('SolverSketchEditorWithExtrude — Sweep / Loft / Pattern wiring', () => {
  it('sweep button is enabled after a rect is drawn and click opens SweepModal', async () => {
    await mountReady();
    // Empty sketch → disabled.
    expect((screen.getByTestId('solver-sweep-button') as HTMLButtonElement).disabled).toBe(true);

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-sweep-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-sweep-button'));
    expect(await screen.findByTestId('solver-sweep-modal')).toBeInTheDocument();
  });

  it('loft button is enabled after a rect is drawn and click opens LoftModal', async () => {
    await mountReady();
    expect((screen.getByTestId('solver-loft-button') as HTMLButtonElement).disabled).toBe(true);

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-loft-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-loft-button'));
    expect(await screen.findByTestId('solver-loft-modal')).toBeInTheDocument();
  });

  it('pattern button is enabled after a rect is drawn and click opens PatternModal', async () => {
    await mountReady();
    expect((screen.getByTestId('solver-pattern-button') as HTMLButtonElement).disabled).toBe(true);

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-pattern-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-pattern-button'));
    expect(await screen.findByTestId('solver-pattern-modal')).toBeInTheDocument();
  });

  it('clicking each modal\'s Cancel closes it', async () => {
    await mountReady();
    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-sweep-button') as HTMLButtonElement).disabled).toBe(false);
    });

    // Sweep open → cancel → closed.
    fireEvent.click(screen.getByTestId('solver-sweep-button'));
    await screen.findByTestId('solver-sweep-modal');
    fireEvent.click(screen.getByTestId('solver-sweep-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-sweep-modal')).not.toBeInTheDocument();
    });

    // Loft open → cancel → closed.
    fireEvent.click(screen.getByTestId('solver-loft-button'));
    await screen.findByTestId('solver-loft-modal');
    fireEvent.click(screen.getByTestId('solver-loft-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-loft-modal')).not.toBeInTheDocument();
    });

    // Pattern open → cancel → closed.
    fireEvent.click(screen.getByTestId('solver-pattern-button'));
    await screen.findByTestId('solver-pattern-modal');
    fireEvent.click(screen.getByTestId('solver-pattern-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-pattern-modal')).not.toBeInTheDocument();
    });
  });

  it('sweepFetcher prop is threaded into SweepModal and called on submit', async () => {
    const sweepFetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'sweep_extrude(...);',
      pngs: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        sweepFetcher={sweepFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-sweep-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-sweep-button'));
    await screen.findByTestId('solver-sweep-modal');
    fireEvent.click(screen.getByTestId('solver-sweep-submit'));

    await waitFor(() => {
      expect(sweepFetcher).toHaveBeenCalledTimes(1);
    });
    const call = sweepFetcher.mock.calls[0]![0]!;
    // Sketch should be threaded through with our rectangle (≥4 pts / ≥4 lines).
    expect(call.sketch.points.length).toBeGreaterThanOrEqual(4);
    expect(call.sketch.lines.length).toBeGreaterThanOrEqual(4);
    // Default path has 2 points and mode='add'.
    expect(Array.isArray(call.path)).toBe(true);
    expect(call.path.length).toBeGreaterThanOrEqual(2);
    expect(call.mode).toBe('add');
  });

  it('all 4 (revolve+sweep+loft+pattern) operation buttons are disabled when sketch is empty', async () => {
    await mountReady();
    // Don't draw anything — sketch stays empty (canExtrude=false → all gated).
    expect((screen.getByTestId('solver-revolve-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-sweep-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-loft-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-pattern-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shell button is enabled after a rect is drawn and click opens ShellModal', async () => {
    await mountReady();
    expect((screen.getByTestId('solver-shell-button') as HTMLButtonElement).disabled).toBe(true);

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-shell-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-shell-button'));
    expect(await screen.findByTestId('solver-shell-modal')).toBeInTheDocument();
  });

  it('hole button is enabled after a rect is drawn and click opens HoleWizardModal', async () => {
    await mountReady();
    expect((screen.getByTestId('solver-hole-button') as HTMLButtonElement).disabled).toBe(true);

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-hole-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-hole-button'));
    expect(await screen.findByTestId('solver-hole-modal')).toBeInTheDocument();
  });

  it('cancel closes the Shell and Hole modals', async () => {
    await mountReady();
    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-shell-button') as HTMLButtonElement).disabled).toBe(false);
    });

    // Shell open → cancel → closed.
    fireEvent.click(screen.getByTestId('solver-shell-button'));
    await screen.findByTestId('solver-shell-modal');
    fireEvent.click(screen.getByTestId('solver-shell-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-shell-modal')).not.toBeInTheDocument();
    });

    // Hole open → cancel → closed.
    fireEvent.click(screen.getByTestId('solver-hole-button'));
    await screen.findByTestId('solver-hole-modal');
    fireEvent.click(screen.getByTestId('solver-hole-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-hole-modal')).not.toBeInTheDocument();
    });
  });

  it('shellFetcher prop is threaded into ShellModal and called on submit', async () => {
    const shellFetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'shell(...);',
      pngs: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        shellFetcher={shellFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-shell-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-shell-button'));
    await screen.findByTestId('solver-shell-modal');
    fireEvent.click(screen.getByTestId('solver-shell-submit'));

    await waitFor(() => {
      expect(shellFetcher).toHaveBeenCalledTimes(1);
    });
    const call = shellFetcher.mock.calls[0]![0]!;
    expect(call.sketch.points.length).toBeGreaterThanOrEqual(4);
    expect(call.sketch.lines.length).toBeGreaterThanOrEqual(4);
    // Defaults: depth=20, thickness=2.
    expect(call.depth).toBe(20);
    expect(call.thickness).toBe(2);
  });

  it('holeFetcher prop is threaded into HoleWizardModal and called on submit', async () => {
    const holeFetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'hole(...);',
      pngs: [],
      holeCount: 1,
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        holeFetcher={holeFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-hole-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-hole-button'));
    await screen.findByTestId('solver-hole-modal');
    fireEvent.click(screen.getByTestId('solver-hole-submit'));

    await waitFor(() => {
      expect(holeFetcher).toHaveBeenCalledTimes(1);
    });
    const call = holeFetcher.mock.calls[0]![0]!;
    expect(call.sketch.points.length).toBeGreaterThanOrEqual(4);
    expect(Array.isArray(call.holes)).toBe(true);
    expect(call.holes.length).toBeGreaterThanOrEqual(1);
  });

  it('all 9 operation buttons are disabled when sketch is empty', async () => {
    await mountReady();
    expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-revolve-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-sweep-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-loft-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-pattern-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-shell-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-hole-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-fillet-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('solver-chamfer-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('fillet button is enabled after a rect is drawn and click opens FilletModal', async () => {
    await mountReady();
    expect((screen.getByTestId('solver-fillet-button') as HTMLButtonElement).disabled).toBe(true);

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-fillet-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-fillet-button'));
    expect(await screen.findByTestId('solver-fillet-modal')).toBeInTheDocument();
  });

  it('chamfer button is enabled after a rect is drawn and click opens ChamferModal', async () => {
    await mountReady();
    expect((screen.getByTestId('solver-chamfer-button') as HTMLButtonElement).disabled).toBe(true);

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-chamfer-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-chamfer-button'));
    expect(await screen.findByTestId('solver-chamfer-modal')).toBeInTheDocument();
  });

  it('cancel closes the Fillet and Chamfer modals', async () => {
    await mountReady();
    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-fillet-button') as HTMLButtonElement).disabled).toBe(false);
    });

    // Fillet open → cancel → closed.
    fireEvent.click(screen.getByTestId('solver-fillet-button'));
    await screen.findByTestId('solver-fillet-modal');
    fireEvent.click(screen.getByTestId('solver-fillet-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-fillet-modal')).not.toBeInTheDocument();
    });

    // Chamfer open → cancel → closed.
    fireEvent.click(screen.getByTestId('solver-chamfer-button'));
    await screen.findByTestId('solver-chamfer-modal');
    fireEvent.click(screen.getByTestId('solver-chamfer-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-chamfer-modal')).not.toBeInTheDocument();
    });
  });

  it('filletFetcher prop is threaded into FilletModal and called on submit', async () => {
    const filletFetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'fillet(...);',
      pngs: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        filletFetcher={filletFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-fillet-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-fillet-button'));
    await screen.findByTestId('solver-fillet-modal');
    fireEvent.click(screen.getByTestId('solver-fillet-submit'));

    await waitFor(() => {
      expect(filletFetcher).toHaveBeenCalledTimes(1);
    });
    const call = filletFetcher.mock.calls[0]![0]!;
    expect(call.sketch.points.length).toBeGreaterThanOrEqual(4);
    expect(call.sketch.lines.length).toBeGreaterThanOrEqual(4);
  });

  it('chamferFetcher prop is threaded into ChamferModal and called on submit', async () => {
    const chamferFetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'chamfer(...);',
      pngs: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        chamferFetcher={chamferFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-chamfer-button') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-chamfer-button'));
    await screen.findByTestId('solver-chamfer-modal');
    fireEvent.click(screen.getByTestId('solver-chamfer-submit'));

    await waitFor(() => {
      expect(chamferFetcher).toHaveBeenCalledTimes(1);
    });
    const call = chamferFetcher.mock.calls[0]![0]!;
    expect(call.sketch.points.length).toBeGreaterThanOrEqual(4);
    expect(call.sketch.lines.length).toBeGreaterThanOrEqual(4);
  });
});
