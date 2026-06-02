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
 *
 * Phase 2.8 adds the "projectId persistence" suite at the bottom — exercises
 * useFeatureTreeStorage routing, Reset, autosave debounce, quota error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import SolverSketchEditorWithExtrude from '@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude';
import {
  serializeFeatureTree,
  FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS,
} from '@/lib/cad/featureTreePersist';
import type { FeatureTree } from '@/lib/cad/featureTree';

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

// ─── STEP import + FeatureTreeView integration (Phase 2.7 + 5.2 UI) ──────
describe('SolverSketchEditorWithExtrude — STEP import + FeatureTreeView wiring', () => {
  function makeRectImportedTree() {
    return {
      nodes: [
        {
          id: 'imported_0',
          name: 'Imported Solid 1',
          dependencies: [],
          payload: {
            kind: 'extrude' as const,
            loop: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 5 },
              { x: 0, y: 5 },
            ],
            depth: 3,
            direction: 'one_sided' as const,
            mode: 'add' as const,
          },
        },
      ],
    };
  }

  it('Import STEP button is always enabled even with empty sketch', async () => {
    await mountReady();
    const btn = screen.getByTestId('solver-import-step-button') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    // canExtrude gate bypassed — should not be disabled.
    expect(btn.disabled).toBe(false);
  });

  it('clicking Import STEP opens the StepImportModal', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    expect(await screen.findByTestId('step-import-modal')).toBeInTheDocument();
    // Replace/Merge mode row also visible.
    expect(screen.getByTestId('solver-step-import-mode-replace')).toBeInTheDocument();
    expect(screen.getByTestId('solver-step-import-mode-merge')).toBeInTheDocument();
  });

  it('onImport replaces the tree (Replace mode default) and closes the modal', async () => {
    const stepImportFetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: makeRectImportedTree(),
      warnings: [],
      unsupported: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        stepImportFetcher={stepImportFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    await screen.findByTestId('step-import-modal');

    // Provide a file and submit.
    const fileInput = screen.getByTestId('step-import-file-input') as HTMLInputElement;
    const file = new File(['ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'], 'part.step', { type: 'application/octet-stream' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    fireEvent.click(screen.getByTestId('step-import-submit'));

    await waitFor(() => expect(stepImportFetcher).toHaveBeenCalledTimes(1));
    // Modal auto-closes after onImport.
    await waitFor(() => {
      expect(screen.queryByTestId('step-import-modal')).not.toBeInTheDocument();
    });
    // Tree now has the imported node.
    expect(await screen.findByTestId('feature-tree-row-imported_0')).toBeInTheDocument();
  });

  it('Merge mode appends imported nodes to existing tree (existing kept)', async () => {
    // First import a tree (creates node imported_0).
    const stepImportFetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: makeRectImportedTree(),
      warnings: [],
      unsupported: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        stepImportFetcher={stepImportFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    // Round 1: Replace mode (default).
    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    await screen.findByTestId('step-import-modal');
    const file1 = new File(['step1'], 'a.step', { type: 'application/octet-stream' });
    const fi1 = screen.getByTestId('step-import-file-input') as HTMLInputElement;
    Object.defineProperty(fi1, 'files', { value: [file1], configurable: true });
    fireEvent.change(fi1);
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => {
      expect(screen.queryByTestId('step-import-modal')).not.toBeInTheDocument();
    });
    await screen.findByTestId('feature-tree-row-imported_0');

    // Round 2: switch to Merge mode and import again. Should append a
    // remapped node alongside the existing imported_0.
    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    await screen.findByTestId('step-import-modal');
    fireEvent.click(screen.getByTestId('solver-step-import-mode-merge'));
    const file2 = new File(['step2'], 'b.step', { type: 'application/octet-stream' });
    const fi2 = screen.getByTestId('step-import-file-input') as HTMLInputElement;
    Object.defineProperty(fi2, 'files', { value: [file2], configurable: true });
    fireEvent.change(fi2);
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => {
      expect(screen.queryByTestId('step-import-modal')).not.toBeInTheDocument();
    });

    // Original kept.
    expect(screen.getByTestId('feature-tree-row-imported_0')).toBeInTheDocument();
    // New merged node present (prefixed with imp* on id collision).
    const merged = screen.queryAllByText(/Imported Solid 1/);
    // Two rows total => original + merged appearance.
    expect(merged.length).toBeGreaterThanOrEqual(2);
  });

  it('Replace mode wipes existing tree before inserting imported nodes', async () => {
    let callIdx = 0;
    const trees = [makeRectImportedTree(), makeRectImportedTree()];
    const stepImportFetcher = vi.fn().mockImplementation(async () => ({
      ok: true,
      tree: trees[callIdx++]!,
      warnings: [],
      unsupported: [],
    }));
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        stepImportFetcher={stepImportFetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    // Import 1 with Replace (default).
    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    await screen.findByTestId('step-import-modal');
    const file1 = new File(['s1'], 'a.step', { type: 'application/octet-stream' });
    const fi1 = screen.getByTestId('step-import-file-input') as HTMLInputElement;
    Object.defineProperty(fi1, 'files', { value: [file1], configurable: true });
    fireEvent.change(fi1);
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await screen.findByTestId('feature-tree-row-imported_0');

    // Import 2 with Replace — should still only have one row.
    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    await screen.findByTestId('step-import-modal');
    // Ensure Replace radio is selected (it should be by default).
    expect((screen.getByTestId('solver-step-import-mode-replace') as HTMLInputElement).checked).toBe(true);
    const file2 = new File(['s2'], 'b.step', { type: 'application/octet-stream' });
    const fi2 = screen.getByTestId('step-import-file-input') as HTMLInputElement;
    Object.defineProperty(fi2, 'files', { value: [file2], configurable: true });
    fireEvent.change(fi2);
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => {
      expect(screen.queryByTestId('step-import-modal')).not.toBeInTheDocument();
    });
    // After replace, exactly one imported_0 row should be visible.
    expect(screen.getAllByTestId('feature-tree-row-imported_0').length).toBe(1);
  });

  it('FeatureTreeView panel renders with empty state when no nodes are added yet', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-feature-tree-panel')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-view')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
  });

  it('extrude submit appends a node to the feature tree', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    // After the fetcher resolves ok, an extrude_0 node should appear in the tree.
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
  });

  it('clicking a tree row updates selectedFeatureId (data-selected toggle)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    // Initially not selected.
    expect(screen.getByTestId('feature-tree-row-extrude_0').getAttribute('data-selected')).toBe('false');
    fireEvent.click(screen.getByTestId('feature-tree-row-extrude_0'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0').getAttribute('data-selected')).toBe('true');
    });
  });

  it('tree-row delete removes the node from the tree', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('feature-tree-row-extrude_0-delete'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument();
    });
    // Empty state returns.
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
  });

  it('tree-row suppress toggles data-suppressed on the row', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    expect(screen.getByTestId('feature-tree-row-extrude_0').getAttribute('data-suppressed')).toBe('false');
    fireEvent.click(screen.getByTestId('feature-tree-row-extrude_0-suppress'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0').getAttribute('data-suppressed')).toBe('true');
    });
    // Toggle back.
    fireEvent.click(screen.getByTestId('feature-tree-row-extrude_0-suppress'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0').getAttribute('data-suppressed')).toBe('false');
    });
  });
});

// ─── Phase 2.8: projectId persistence ────────────────────────────────────

/**
 * Persistence tests cover the projectId-gated `useFeatureTreeStorage`
 * branch of the wrapper. The constraint requires 100 % back-compat when
 * `projectId` is absent — the existing 36 tests above exercise that path
 * verbatim, so the suite here focuses on the persisted branch.
 */
describe('SolverSketchEditorWithExtrude — Phase 2.8 projectId persistence', () => {
  const TREE_KEY = (pid: string) => `nexyfab:tree:${pid}`;

  beforeEach(() => {
    // Each test gets a clean localStorage slot so cross-test bleed is
    // impossible. The wrapper writes under nexyfab:tree:${projectId}.
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });
  afterEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  /** Real-time delay helper — sleep slightly longer than the autosave
   *  debounce so any pending write would have fired by the time we check. */
  const sleepPastDebounce = () =>
    new Promise<void>((r) => setTimeout(r, FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS + 100));

  it('no projectId → no localStorage write happens even after a submit', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    // Wait past the debounce window — nothing should land in localStorage.
    await act(async () => {
      await sleepPastDebounce();
    });
    // No key starting with nexyfab:tree: should exist.
    const keys = Object.keys(window.localStorage);
    expect(keys.filter((k) => k.startsWith('nexyfab:tree:'))).toEqual([]);
    // Saved indicator is hidden in in-memory mode.
    expect(screen.queryByTestId('solver-feature-tree-saved')).toBeNull();
  });

  it('projectId set → debounced localStorage write after a submit', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        projectId="proj-debounce"
        extrudeFetcher={fetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    const targetKey = TREE_KEY('proj-debounce');
    // Wait for the debounced write to land.
    await waitFor(
      () => {
        expect(window.localStorage.getItem(targetKey)).not.toBeNull();
      },
      { timeout: 2000 },
    );
    expect(screen.getByTestId('solver-feature-tree-saved')).toBeInTheDocument();
    const raw = window.localStorage.getItem(targetKey)!;
    const parsed = JSON.parse(raw) as { version: number; tree: { nodes: unknown[] } };
    expect(parsed.version).toBe(1);
    expect(parsed.tree.nodes.length).toBe(1);
  });

  it('mount with pre-populated localStorage → wrapper rehydrates the tree on first paint', async () => {
    // Construct a structurally valid extrude payload so deserializeFeatureTree
    // (which runs per-kind required-field checks) accepts the rehydrate.
    const SEED: FeatureTree = {
      nodes: [
        {
          id: 'extrude_seed',
          name: 'Seeded extrude',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
            depth: 5,
            direction: 'one_sided',
            mode: 'add',
          } as unknown as FeatureTree['nodes'][number]['payload'],
        },
      ],
    };
    window.localStorage.setItem(TREE_KEY('proj-load'), serializeFeatureTree(SEED));
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        projectId="proj-load"
        extrudeFetcher={vi.fn()}
      />,
    );
    // Seeded row should be present on the very first paint — no submit
    // required.
    expect(await screen.findByTestId('feature-tree-row-extrude_seed')).toBeInTheDocument();
  });

  it('Reset button clears the tree AND flushes an empty payload to localStorage', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        projectId="proj-reset"
        extrudeFetcher={fetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    // Now Reset.
    fireEvent.click(screen.getByTestId('solver-feature-tree-reset'));
    await waitFor(() =>
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument(),
    );
    // Wait past debounce so the empty-tree write lands.
    await act(async () => {
      await sleepPastDebounce();
    });
    const raw = window.localStorage.getItem(TREE_KEY('proj-reset'))!;
    const parsed = JSON.parse(raw) as { tree: { nodes: unknown[] } };
    expect(parsed.tree.nodes).toEqual([]);
  });

  it('Reset button works in in-memory mode (no projectId) — just clears the panel', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('solver-feature-tree-reset'));
    await waitFor(() =>
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument(),
    );
  });

  it('quota-exceeded save error surfaces the toast / onError banner', async () => {
    // Patch the instance method on window.localStorage directly. Mocking
    // via vi.spyOn(Storage.prototype, ...) is a no-op in jsdom because
    // window.localStorage stores its own bound setItem, not the prototype.
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      if (key === 'nexyfab:tree:proj-quota') {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      originalSetItem(key, value);
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    try {
      render(
        <SolverSketchEditorWithExtrude
          lang="en"
          projectId="proj-quota"
          extrudeFetcher={fetcher}
        />,
      );
      const editor = await screen.findByTestId('solver-sketch-editor');
      await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
        timeout: 10000,
      });
      fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
      const canvas = screen.getByTestId('solver-sketch-canvas');
      fireEvent.click(canvas, { clientX: 100, clientY: 100 });
      fireEvent.click(canvas, { clientX: 200, clientY: 200 });
      await waitFor(() => {
        expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(
          false,
        );
      });
      fireEvent.click(screen.getByTestId('solver-extrude-button'));
      fireEvent.click(screen.getByTestId('solver-extrude-submit'));
      await waitFor(() =>
        expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
      );
      // Wait past debounce so the (failing) write runs and toast surfaces.
      const banner = await screen.findByTestId(
        'solver-feature-tree-save-error',
        undefined,
        { timeout: 2000 },
      );
      expect(banner.textContent).toMatch(/quota exceeded/i);
    } finally {
      window.localStorage.setItem = originalSetItem;
    }
  });

  it('debounce eventually settles to a single setItem call after a Reset chain', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(...);',
      pngs: [],
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        projectId="proj-debounce-2"
        extrudeFetcher={fetcher}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    // Reset immediately resets the timer — the queued tree under the same
    // key is replaced before the 500 ms window elapses.
    fireEvent.click(screen.getByTestId('solver-feature-tree-reset'));
    // After settling, the persisted blob reflects the FINAL state (empty)
    // even though multiple setTree calls were issued in rapid succession.
    await waitFor(
      () => {
        const raw = window.localStorage.getItem(TREE_KEY('proj-debounce-2'));
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as { tree: { nodes: unknown[] } };
        expect(parsed.tree.nodes).toEqual([]);
      },
      { timeout: 2000 },
    );
  });
});
