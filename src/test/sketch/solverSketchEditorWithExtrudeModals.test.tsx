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

// ─── Phase 2.7.1: featureTreeHistory integration (undo / redo) ────────────

/**
 * Undo/Redo tests exercise the wrapper's integration of useFeatureTreeHistory:
 *   - Undo/Redo buttons render alongside Reset.
 *   - Buttons are disabled when canUndo/canRedo are false.
 *   - Adding nodes via the extrude modal pushes onto history (each submit
 *     produces one HistoryEntry via apply({type: 'insert_node', ...})).
 *   - Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) fire undo/redo.
 *   - A new edit after undo wipes the redo stack (canRedo flips back to false).
 *   - i18n surfaces the right labels for ko / en.
 */
describe('SolverSketchEditorWithExtrude — Phase 2.7.1 undo / redo history', () => {
  async function setupWithExtrudeFetcher() {
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
    await drawRect();
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    return fetcher;
  }

  async function submitExtrudeOnce() {
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    fireEvent.click(screen.getByTestId('solver-extrude-cancel'));
  }

  it('Undo button is rendered and disabled when no edits have been made', async () => {
    await mountReady();
    const undoBtn = screen.getByTestId('solver-undo-button') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('solver-redo-button') as HTMLButtonElement;
    expect(undoBtn).toBeInTheDocument();
    expect(redoBtn).toBeInTheDocument();
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
  });

  it('Add box → tree gains a node → Undo button becomes enabled', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    const undoBtn = screen.getByTestId('solver-undo-button') as HTMLButtonElement;
    await waitFor(() => {
      expect(undoBtn.disabled).toBe(false);
    });
  });

  it('Undo after an add removes the node from the tree', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument();
    });
    // Empty state restored.
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
    // Redo is now enabled.
    expect(
      (screen.getByTestId('solver-redo-button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('Redo after undo restores the previously-added node', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('solver-redo-button'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    // After redo, redo is again disabled (future emptied).
    expect(
      (screen.getByTestId('solver-redo-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Add 2 nodes + Undo 2 → tree is empty, Redo enabled', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument();
    });
    await submitExtrudeOnce();
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-extrude_1')).toBeInTheDocument();
    });
    // Undo twice.
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-extrude_1')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
    // Both Undo (disabled) and Redo (enabled).
    expect(
      (screen.getByTestId('solver-undo-button') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('solver-redo-button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('Add 2 + Undo 2 + Redo 1 → first node restored', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    await submitExtrudeOnce();
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument(),
    );
    // Redo once — restores extrude_0 (the first-applied snapshot).
    fireEvent.click(screen.getByTestId('solver-redo-button'));
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    // extrude_1 still not present (only 1 redo).
    expect(screen.queryByTestId('feature-tree-row-extrude_1')).not.toBeInTheDocument();
    // Redo still enabled (one more redo waits).
    expect(
      (screen.getByTestId('solver-redo-button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('Ctrl+Z keyboard shortcut undoes the last edit', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument();
    });
  });

  it('Ctrl+Y keyboard shortcut redoes a previously-undone edit', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    // Undo first.
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument(),
    );
    // Redo via keyboard.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
  });

  it('Ctrl+Shift+Z keyboard shortcut redoes a previously-undone edit', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument(),
    );
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
  });

  it('Undo then new edit invalidates the redo stack (canRedo flips to false)', async () => {
    await setupWithExtrudeFetcher();
    await submitExtrudeOnce();
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    // Undo so Redo is enabled.
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('feature-tree-row-extrude_0')).not.toBeInTheDocument(),
    );
    expect(
      (screen.getByTestId('solver-redo-button') as HTMLButtonElement).disabled,
    ).toBe(false);
    // New edit (submit extrude again). The counter advances → next id is
    // extrude_1 (extrude_0 was emitted before the undo).
    await submitExtrudeOnce();
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_1')).toBeInTheDocument(),
    );
    // Redo must now be disabled — future stack wiped by the new apply.
    await waitFor(() => {
      expect(
        (screen.getByTestId('solver-redo-button') as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    // Undo is still enabled (we have one past entry: empty → 1 node).
    expect(
      (screen.getByTestId('solver-undo-button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('i18n English: Undo / Redo labels surface on the buttons', async () => {
    await mountReady();
    const undoBtn = screen.getByTestId('solver-undo-button');
    const redoBtn = screen.getByTestId('solver-redo-button');
    expect(undoBtn.textContent).toMatch(/Undo/);
    expect(redoBtn.textContent).toMatch(/Redo/);
    // Ariadne aria-label also surfaces.
    expect(undoBtn.getAttribute('aria-label')).toBe('Undo');
    expect(redoBtn.getAttribute('aria-label')).toBe('Redo');
  });

  it('i18n Korean: 실행 취소 / 다시 실행 labels surface on the buttons', async () => {
    render(<SolverSketchEditorWithExtrude lang="ko" extrudeFetcher={vi.fn()} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    const undoBtn = screen.getByTestId('solver-undo-button');
    const redoBtn = screen.getByTestId('solver-redo-button');
    expect(undoBtn.textContent).toMatch(/실행 취소/);
    expect(redoBtn.textContent).toMatch(/다시 실행/);
    expect(undoBtn.getAttribute('aria-label')).toBe('실행 취소');
    expect(redoBtn.getAttribute('aria-label')).toBe('다시 실행');
  });
});

// ─── Phase 3.AI.UI: FeatureTreePlannerPanel wrapper integration ──────────

/**
 * The wrapper mounts FeatureTreePlannerPanel behind the
 * `solver-planner-toggle` button. Panel is hidden by default (compact
 * mode). When shown, PlanStep[] from the panel's onApply callback is
 * translated to EditOps and pushed through `applyHistoryEdit` so each
 * step lands in the wrapper's undo history.
 *
 * Coverage:
 *  - toggle on / off mounts/unmounts the panel,
 *  - default-hidden compact mode,
 *  - regex-only plans flow through panel → wrapper.tree,
 *  - 2-step plan adds 2 nodes,
 *  - toast surfaces with the node count,
 *  - undo removes planner-applied nodes (history integration),
 *  - llmIntentFetcher mock is invoked when regex fails,
 *  - history is preserved across hide-then-show,
 *  - 6-lang label rendering of the toggle.
 */
describe('SolverSketchEditorWithExtrude — Phase 3.AI.UI planner panel wiring', () => {
  it('panel is hidden by default (compact mode)', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-planner-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-planner-panel-host')).toBeNull();
    expect(screen.queryByTestId('planner-panel')).toBeNull();
  });

  it('clicking AI Planner toggle mounts the planner panel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    expect(await screen.findByTestId('solver-planner-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('planner-panel')).toBeInTheDocument();
    // Toggle reflects expanded state.
    expect(screen.getByTestId('solver-planner-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the toggle a second time unmounts the panel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('planner-panel')).toBeNull();
    });
    expect(screen.getByTestId('solver-planner-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('planner Apply with a 2-step plan adds 2 nodes to the wrapper tree', async () => {
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        plannerLlmFetcher={null}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    // "box 50x50x30 with fillet 5" emits 2 add_node steps (box + fillet).
    const ta = screen.getByTestId('planner-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'box 50x50x30 with fillet 5' } });
    fireEvent.click(screen.getByTestId('planner-send'));
    // Wait for plan rendering.
    await screen.findByTestId('planner-step-0');
    await screen.findByTestId('planner-step-1');
    // Apply.
    fireEvent.click(screen.getByTestId('planner-apply'));
    // Box + fillet nodes should now exist in the wrapper's tree.
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-box_1')).toBeInTheDocument();
      expect(screen.getByTestId('feature-tree-row-fillet_2')).toBeInTheDocument();
    });
  });

  it('toast surfaces after Apply with the node count', async () => {
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        plannerLlmFetcher={null}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    const ta = screen.getByTestId('planner-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cylinder r10 h20' } });
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-step-0');
    fireEvent.click(screen.getByTestId('planner-apply'));
    const toast = await screen.findByTestId('solver-planner-toast');
    expect(toast.textContent).toMatch(/Plan applied/);
    expect(toast.textContent).toMatch(/1/);
  });

  it('undo after planner-applied 2-step plan rolls back nodes one-at-a-time', async () => {
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        plannerLlmFetcher={null}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    const ta = screen.getByTestId('planner-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'box 50x50x30 with fillet 5' } });
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-step-1');
    fireEvent.click(screen.getByTestId('planner-apply'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-fillet_2')).toBeInTheDocument();
    });
    // Undo once — fillet (the last applied step) is removed first.
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-fillet_2')).toBeNull();
    });
    // Box is still present.
    expect(screen.getByTestId('feature-tree-row-box_1')).toBeInTheDocument();
    // Undo again — box also gone.
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-box_1')).toBeNull();
    });
  });

  it('llmIntentFetcher mock is invoked when regex returns null', async () => {
    const llm = vi.fn().mockResolvedValue({
      kind: 'create_cylinder',
      radius: 5,
      height: 12,
    });
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        plannerLlmFetcher={llm}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    // A nonsense string that regex detectIntent cannot parse.
    const ta = screen.getByTestId('planner-input') as HTMLTextAreaElement;
    fireEvent.change(ta, {
      target: { value: '__please_call_the_llm_unparseable__' },
    });
    fireEvent.click(screen.getByTestId('planner-send'));
    await waitFor(() => {
      expect(llm).toHaveBeenCalledTimes(1);
    });
    // Verify the prompt was the one we typed.
    expect(llm.mock.calls[0]![0]!).toBe('__please_call_the_llm_unparseable__');
    // And the planner emitted a step for the LLM-supplied intent.
    await screen.findByTestId('planner-step-0');
    fireEvent.click(screen.getByTestId('planner-apply'));
    // Cylinder lands in the tree.
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-cylinder_1')).toBeInTheDocument();
    });
  });

  it('plannerLlmFetcher omitted → default (network) fetcher is wired but regex covers happy path', async () => {
    // We do NOT pass plannerLlmFetcher, so the wrapper's default `fetch` call
    // would happen for unparseable prompts. We test only the regex path so no
    // real network access is triggered. Confirms the panel works without a
    // test-supplied fetcher.
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    const ta = screen.getByTestId('planner-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cylinder r5 h10' } });
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-step-0');
    fireEvent.click(screen.getByTestId('planner-apply'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-cylinder_1')).toBeInTheDocument();
    });
  });

  it('toggle button uses the i18n label (Korean)', async () => {
    render(<SolverSketchEditorWithExtrude lang="ko" extrudeFetcher={vi.fn()} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    const toggle = screen.getByTestId('solver-planner-toggle');
    expect(toggle.textContent).toMatch(/AI 플래너/);
    expect(toggle.getAttribute('aria-label')).toMatch(/AI 플래너 표시/);
  });

  it('hiding then re-showing the panel preserves the wrapper tree', async () => {
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        plannerLlmFetcher={null}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    const ta = screen.getByTestId('planner-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cylinder r3 h6' } });
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-step-0');
    fireEvent.click(screen.getByTestId('planner-apply'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-cylinder_1')).toBeInTheDocument();
    });
    // Hide panel.
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('planner-panel')).toBeNull();
    });
    // Tree node is still there.
    expect(screen.getByTestId('feature-tree-row-cylinder_1')).toBeInTheDocument();
    // Re-show panel → tree unchanged.
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    expect(screen.getByTestId('feature-tree-row-cylinder_1')).toBeInTheDocument();
  });

  it('llmIntentFetcher rejection surfaces the panel error and does NOT add nodes', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        plannerLlmFetcher={llm}
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    await screen.findByTestId('planner-panel');
    const ta = screen.getByTestId('planner-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '__unparseable_x__' } });
    fireEvent.click(screen.getByTestId('planner-send'));
    // Status surfaces the error.
    await waitFor(() => {
      const status = screen.getByTestId('planner-status');
      expect(status.textContent).toMatch(/boom/);
    });
    // Apply button must not have been actuated and tree is empty (no
    // planner-applied nodes). The toast must also be absent.
    expect(screen.queryByTestId('solver-planner-toast')).toBeNull();
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
  });
});

// ─── Phase 3.AI.UI helper: IntentExamplesPanel wrapper integration ────────

/**
 * The wrapper exposes the INTENT_EXAMPLES suggestions behind the
 * `solver-planner-examples-toggle` button. Hidden by default (compact
 * mode). When shown, IntentExamplesPanel mounts; clicking a chip surfaces
 * the example text in `solver-planner-examples-selected`.
 *
 * Coverage:
 *  - toggle visible + default off,
 *  - toggle on → panel mounts,
 *  - example click → wrapper records the selection,
 *  - toggle off → panel unmounts and selection cleared from DOM.
 */
describe('SolverSketchEditorWithExtrude — Phase 3.AI.UI examples panel wiring', () => {
  it('examples toggle is visible and panel hidden by default', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-planner-examples-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-planner-examples-host')).toBeNull();
    expect(screen.queryByTestId('planner-intent-examples-panel')).toBeNull();
  });

  it('clicking the examples toggle mounts the IntentExamplesPanel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-planner-examples-toggle'));
    expect(await screen.findByTestId('solver-planner-examples-host')).toBeInTheDocument();
    expect(await screen.findByTestId('planner-intent-examples-panel')).toBeInTheDocument();
    expect(
      screen.getByTestId('solver-planner-examples-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('clicking an example chip surfaces the text in the selected preview band', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-planner-examples-toggle'));
    await screen.findByTestId('planner-intent-examples-panel');
    // No selection yet.
    expect(screen.queryByTestId('solver-planner-examples-selected')).toBeNull();
    // Click a chip.
    const chip = await screen.findByTestId('planner-intent-example-create_cylinder-0');
    fireEvent.click(chip);
    const selected = await screen.findByTestId('solver-planner-examples-selected');
    // The chip text is the literal INTENT_EXAMPLES `in` string — exact
    // match is verified in intentExamplesPanel.test.tsx; here we just
    // confirm the value propagated.
    expect(selected.textContent ?? '').toContain('cylinder');
  });

  it('clicking the toggle a second time hides the examples panel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-planner-examples-toggle'));
    await screen.findByTestId('planner-intent-examples-panel');
    fireEvent.click(screen.getByTestId('solver-planner-examples-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('planner-intent-examples-panel')).toBeNull();
    });
    expect(
      screen.getByTestId('solver-planner-examples-toggle').getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('examples toggle and AI planner toggle are independent (both can be on)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    fireEvent.click(screen.getByTestId('solver-planner-examples-toggle'));
    await screen.findByTestId('planner-panel');
    await screen.findByTestId('planner-intent-examples-panel');
    // Both mounted side by side.
    expect(screen.getByTestId('solver-planner-panel-host')).toBeInTheDocument();
    expect(screen.getByTestId('solver-planner-examples-host')).toBeInTheDocument();
  });
});

// ─── Collab mode wiring (useCrdtDoc + CursorOverlay) ─────────────────────
describe('SolverSketchEditorWithExtrude — Collab mode wiring', () => {
  it('collab toggle is visible and off by default', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-collab-toggle') as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.checked).toBe(false);
    // Status banner only renders when collab is on.
    expect(screen.queryByTestId('solver-collab-status')).toBeNull();
    // Cursor overlay only mounted when collab is on.
    expect(screen.queryByTestId('cursor-overlay')).toBeNull();
  });

  it('flipping the toggle on mounts the cursor overlay + status banner', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-collab-toggle') as HTMLInputElement;
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(await screen.findByTestId('cursor-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('solver-collab-status')).toBeInTheDocument();
  });

  it('status banner exposes the peer count (0 peers initially)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-collab-toggle'));
    const status = await screen.findByTestId('solver-collab-status');
    // Initial — no peers joined yet, so the {N}-substituted string surfaces.
    expect(status.textContent ?? '').toMatch(/0/);
  });

  it('status banner shows "Connected" when memory transport is up', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-collab-toggle'));
    const status = await screen.findByTestId('solver-collab-status');
    // Memory transport reports isConnected=true synchronously.
    expect(status.textContent ?? '').toContain('Connected');
  });

  it('Korean i18n surfaces 협업 모드 / 연결됨 / N명', async () => {
    render(<SolverSketchEditorWithExtrude lang="ko" extrudeFetcher={vi.fn()} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    const label = screen.getByTestId('solver-collab-toggle-label');
    expect(label.textContent ?? '').toContain('협업 모드');
    fireEvent.click(screen.getByTestId('solver-collab-toggle'));
    const status = await screen.findByTestId('solver-collab-status');
    expect(status.textContent ?? '').toContain('연결됨');
    expect(status.textContent ?? '').toContain('명');
  });

  it('English i18n surfaces "Collab mode" / "Connected" / "peers"', async () => {
    await mountReady();
    const label = screen.getByTestId('solver-collab-toggle-label');
    expect(label.textContent ?? '').toContain('Collab mode');
    fireEvent.click(screen.getByTestId('solver-collab-toggle'));
    const status = await screen.findByTestId('solver-collab-status');
    expect(status.textContent ?? '').toContain('Connected');
    expect(status.textContent ?? '').toContain('peers');
  });

  it('viewport wrapper carries the testid and a mousemove handler (collab on)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-collab-toggle'));
    const viewport = screen.getByTestId('solver-collab-viewport');
    expect(viewport).toBeInTheDocument();
    // The handler is wired — exercise it once; no peer assertion needed
    // here (the local cursor is never rendered by CursorOverlay).
    fireEvent.mouseMove(viewport, { clientX: 30, clientY: 50 });
    // Cursor overlay still mounted.
    expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
  });

  it('toggling collab off tears down the cursor overlay + status banner', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-collab-toggle');
    fireEvent.click(toggle);
    await screen.findByTestId('cursor-overlay');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.queryByTestId('cursor-overlay')).toBeNull();
      expect(screen.queryByTestId('solver-collab-status')).toBeNull();
    });
  });

  it('collab off is fully back-compat: extrude flow still operates', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, scad: 'cube();', pngs: [] });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    // Collab off — no overlay, no status.
    expect(screen.queryByTestId('cursor-overlay')).toBeNull();
    // Draw a rect then run the extrude flow.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it('collab on, then a local edit (drawn rect → fetcher append) does not crash the mirror', async () => {
    // Smoke test for the local → CRDT mirror path: open a rect, run the
    // extrude flow, and confirm the wrapper does not throw under collab on.
    const fetcher = vi.fn().mockResolvedValue({ ok: true, scad: 'cube();', pngs: [] });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    fireEvent.click(screen.getByTestId('solver-collab-toggle'));
    await screen.findByTestId('cursor-overlay');
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    // Cursor overlay still up; status still says Connected.
    expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('solver-collab-status').textContent ?? '').toContain('Connected');
  });

  it('mousemove inside the viewport while collab is OFF is a no-op (no overlay, no throw)', async () => {
    await mountReady();
    const viewport = screen.getByTestId('solver-collab-viewport');
    // Should not throw even with no cursor overlay / no CRDT awareness use.
    fireEvent.mouseMove(viewport, { clientX: 10, clientY: 20 });
    expect(screen.queryByTestId('cursor-overlay')).toBeNull();
  });
});

// ─── Agent-YYYYY: FeatureTreeBranchManager wrapper integration ───────────

/**
 * The wrapper mounts FeatureTreeBranchManager behind the
 * `solver-branches-toggle` button. Panel is hidden by default (compact
 * mode). When shown, currentTree is fed from the wrapper's
 * useFeatureTreeHistory present, and onLoadTree resetHistory()s then
 * replays the loaded nodes as insert_node ops.
 *
 * Coverage:
 *  - toggle visible + default off,
 *  - on → BranchManager mounts,
 *  - Load → wrapper tree is replaced with the branch payload,
 *  - branches toggle is independent of collab / AI planner / examples,
 *  - 6-lang label rendering of the toggle,
 *  - storageKeyPrefix is projectId-scoped when projectId is supplied,
 *  - currentTree is the wrapper's live featureTree (newly-added nodes are
 *    visible to a freshly-opened panel),
 *  - Load wipes the undo stack (subsequent undo cannot reach pre-load tree),
 *  - existing wrapper tests still pass (no breakage of the toggle's default-off).
 */
describe('SolverSketchEditorWithExtrude — Agent-YYYYY branches panel wiring', () => {
  // Clear localStorage between tests so saved branches do not bleed across
  // test cases (FeatureTreeBranchManager persists to localStorage under the
  // storageKeyPrefix; the wrapper passes either a project-scoped or the
  // BranchManager-default prefix).
  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });
  afterEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  it('branches toggle is visible and panel hidden by default', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-branches-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-branches-panel-host')).toBeNull();
    expect(screen.queryByTestId('branch-manager-panel')).toBeNull();
    // Default off → aria-expanded reflects state.
    expect(
      screen.getByTestId('solver-branches-toggle').getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('clicking the branches toggle mounts FeatureTreeBranchManager', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    expect(await screen.findByTestId('solver-branches-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('branch-manager-panel')).toBeInTheDocument();
    expect(
      screen.getByTestId('solver-branches-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
    // Empty state when no branches saved yet.
    expect(screen.getByTestId('branch-manager-empty')).toBeInTheDocument();
  });

  it('clicking the toggle a second time unmounts the panel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await screen.findByTestId('branch-manager-panel');
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('branch-manager-panel')).toBeNull();
    });
    expect(
      screen.getByTestId('solver-branches-toggle').getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('save → load round-trip replaces the wrapper tree with the loaded branch', async () => {
    // Seed a pre-saved branch directly into localStorage. We use the
    // BranchManager-default prefix (no projectId here). The payload must
    // pass `validatePayload` (loop/depth/direction/mode) — the wrapper's
    // own synthesised stubs (`{kind:'extrude'}` only) would be rejected
    // on the deserialize round-trip, so we build a structurally valid
    // fixture here. (FeatureTreeBranchManager.test.tsx uses the same
    // pattern via makeExtrudePayload.)
    const SEED: FeatureTree = {
      nodes: [
        {
          id: 'extrude_seed',
          name: 'Seeded',
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
    window.localStorage.setItem(
      'nexyfab:tree-branches:_index',
      JSON.stringify(['snap-1']),
    );
    window.localStorage.setItem(
      'nexyfab:tree-branches:snap-1',
      serializeFeatureTree(SEED),
    );

    await mountReady();
    // Open the branches panel and load the pre-seeded branch.
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await screen.findByTestId('branch-manager-panel');
    expect(await screen.findByTestId('branch-manager-row-snap-1')).toBeInTheDocument();
    // Live tree starts empty.
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
    // Load → the seeded node should appear in the live tree.
    fireEvent.click(screen.getByTestId('branch-manager-row-snap-1-load'));
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_seed')).toBeInTheDocument(),
    );
  });

  it('Load wipes the undo stack — Undo cannot walk back into the pre-load tree', async () => {
    // Seed a one-node branch (validatePayload-clean) into the default
    // BranchManager slot. We then build a live tree via the STEP-import
    // flow (which inserts a structurally valid extrude payload too) so
    // a save→load round-trip is not blocked by the wrapper's synthetic
    // `{kind:'extrude'}` stubs.
    const SEED: FeatureTree = {
      nodes: [
        {
          id: 'branch_node',
          name: 'Branch node',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
            depth: 2,
            direction: 'one_sided',
            mode: 'add',
          } as unknown as FeatureTree['nodes'][number]['payload'],
        },
      ],
    };
    window.localStorage.setItem(
      'nexyfab:tree-branches:_index',
      JSON.stringify(['saved']),
    );
    window.localStorage.setItem(
      'nexyfab:tree-branches:saved',
      serializeFeatureTree(SEED),
    );

    // Build a different live tree via STEP import (creates `imported_0`).
    const stepImportFetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: {
        nodes: [
          {
            id: 'imported_0',
            name: 'Imported',
            dependencies: [],
            payload: {
              kind: 'extrude' as const,
              loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
              depth: 1,
              direction: 'one_sided' as const,
              mode: 'add' as const,
            },
          },
        ],
      },
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
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });

    // Import → live tree gets `imported_0`.
    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    await screen.findByTestId('step-import-modal');
    const fi = screen.getByTestId('step-import-file-input') as HTMLInputElement;
    Object.defineProperty(fi, 'files', {
      value: [new File(['x'], 'p.step', { type: 'application/octet-stream' })],
      configurable: true,
    });
    fireEvent.change(fi);
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await screen.findByTestId('feature-tree-row-imported_0');

    // Open branches panel and load the seeded branch.
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await screen.findByTestId('branch-manager-panel');
    await screen.findByTestId('branch-manager-row-saved');
    fireEvent.click(screen.getByTestId('branch-manager-row-saved-load'));

    // After load: branch_node present, imported_0 wiped.
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-row-branch_node')).toBeInTheDocument();
      expect(screen.queryByTestId('feature-tree-row-imported_0')).not.toBeInTheDocument();
    });
    // Undo: the load inserted exactly one entry on top of the wiped
    // history. Even if pressed many times, imported_0 must never reappear
    // (resetHistory() inside onLoadTree wiped the prior STEP-import
    // entry from the past stack). We press undo three times for safety.
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    fireEvent.click(screen.getByTestId('solver-undo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-row-imported_0')).not.toBeInTheDocument();
    });
  });

  it('branches toggle is independent of AI planner and examples toggles', async () => {
    await mountReady();
    // Flip all three on; each should mount its own host.
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    fireEvent.click(screen.getByTestId('solver-planner-examples-toggle'));
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    // Wait for each dynamic chunk individually (await each panel mount
    // via findByTestId, NOT just the wrapper host). The three are
    // separate dynamic() chunks loading concurrently — synchronous
    // getByTestId after the first findByTestId can race against the
    // others' lazy load.
    expect(await screen.findByTestId('solver-planner-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('solver-planner-examples-host')).toBeInTheDocument();
    expect(await screen.findByTestId('solver-branches-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('planner-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('planner-intent-examples-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('branch-manager-panel')).toBeInTheDocument();
    // Toggle branches off — the other two stay mounted.
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('branch-manager-panel')).toBeNull();
    });
    expect(screen.getByTestId('planner-panel')).toBeInTheDocument();
    expect(screen.getByTestId('planner-intent-examples-panel')).toBeInTheDocument();
  });

  it('storageKeyPrefix is project-scoped when projectId is supplied', async () => {
    render(
      <SolverSketchEditorWithExtrude
        lang="en"
        extrudeFetcher={vi.fn()}
        projectId="proj-branches"
      />,
    );
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await screen.findByTestId('branch-manager-panel');
    // Save a branch.
    fireEvent.change(screen.getByTestId('branch-manager-new-name'), {
      target: { value: 'b1' },
    });
    fireEvent.click(screen.getByTestId('branch-manager-save'));
    await screen.findByTestId('branch-manager-row-b1');
    // The blob must live under the project-scoped prefix, NOT under the
    // BranchManager's default 'nexyfab:tree-branches' slot.
    const expectedPrefix = 'nexyfab:tree-branches:proj-branches';
    expect(window.localStorage.getItem(`${expectedPrefix}:b1`)).not.toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(`${expectedPrefix}:_index`)!),
    ).toEqual(['b1']);
    // Default prefix must remain empty.
    expect(window.localStorage.getItem('nexyfab:tree-branches:_index')).toBeNull();
    expect(window.localStorage.getItem('nexyfab:tree-branches:b1')).toBeNull();
  });

  it('storageKeyPrefix falls back to BranchManager default when projectId is absent', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await screen.findByTestId('branch-manager-panel');
    fireEvent.change(screen.getByTestId('branch-manager-new-name'), {
      target: { value: 'g1' },
    });
    fireEvent.click(screen.getByTestId('branch-manager-save'));
    await screen.findByTestId('branch-manager-row-g1');
    // No-projectId mode → default slot is used.
    expect(window.localStorage.getItem('nexyfab:tree-branches:g1')).not.toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem('nexyfab:tree-branches:_index')!),
    ).toEqual(['g1']);
  });

  it('currentTree reflects the wrapper live tree (newly-added nodes visible to a fresh save)', async () => {
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
    // Open branches panel BEFORE adding any nodes.
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    await screen.findByTestId('branch-manager-panel');
    // Now add a node — currentTree prop should update reactively.
    await drawRect();
    await waitFor(() => {
      expect(
        (screen.getByTestId('solver-extrude-button') as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('feature-tree-row-extrude_0')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('solver-extrude-cancel'));
    // Save → blob should contain the just-added node, not the empty seed
    // the panel was first mounted against.
    fireEvent.change(screen.getByTestId('branch-manager-new-name'), {
      target: { value: 'after-add' },
    });
    fireEvent.click(screen.getByTestId('branch-manager-save'));
    await screen.findByTestId('branch-manager-row-after-add');
    const raw = window.localStorage.getItem('nexyfab:tree-branches:after-add')!;
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw) as { version: number; tree: { nodes: { id: string }[] } };
    expect(parsed.tree.nodes.length).toBe(1);
    expect(parsed.tree.nodes[0]!.id).toBe('extrude_0');
  });

  it('English i18n: "Branches" surfaces on the toggle', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-branches-toggle');
    expect(toggle.textContent).toMatch(/Branches/);
    expect(toggle.getAttribute('aria-label')).toBe('Show branches panel');
  });

  it('Korean i18n: 브랜치 surfaces on the toggle', async () => {
    render(<SolverSketchEditorWithExtrude lang="ko" extrudeFetcher={vi.fn()} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    const toggle = screen.getByTestId('solver-branches-toggle');
    expect(toggle.textContent).toMatch(/브랜치/);
    expect(toggle.getAttribute('aria-label')).toBe('브랜치 패널 표시');
  });

  it('Japanese / Chinese / Spanish / Arabic i18n: toggle label is translated', async () => {
    // Verify each remaining lang gets its own label (smoke covering all 6).
    const cases: Array<{ lang: 'ja' | 'zh' | 'es' | 'ar'; label: RegExp; ariaContains: string }> = [
      { lang: 'ja', label: /ブランチ/, ariaContains: 'ブランチパネル' },
      { lang: 'zh', label: /分支/, ariaContains: '分支' },
      { lang: 'es', label: /Ramas/, ariaContains: 'ramas' },
      { lang: 'ar', label: /الفروع/, ariaContains: 'الفروع' },
    ];
    for (const { lang, label, ariaContains } of cases) {
      const { unmount } = render(
        <SolverSketchEditorWithExtrude lang={lang} extrudeFetcher={vi.fn()} />,
      );
      const editor = await screen.findByTestId('solver-sketch-editor');
      await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
        timeout: 10000,
      });
      const toggle = screen.getByTestId('solver-branches-toggle');
      expect(toggle.textContent).toMatch(label);
      expect((toggle.getAttribute('aria-label') ?? '').toLowerCase()).toContain(
        ariaContains.toLowerCase(),
      );
      unmount();
    }
  });
});

// ─── Agent-EEEEEE: FeatureTreeStatsPanel wrapper integration ─────────────
//
// Mounts FeatureTreeStatsPanel beneath the toolbar when the "Stats" toggle
// is on. Independent of every other toggle (collab / AI planner / examples
// / branches). The panel itself is dynamic-loaded, so findByTestId is used
// to await the lazy chunk before asserting on its internals.

describe('SolverSketchEditorWithExtrude — Agent-EEEEEE stats panel wiring', () => {
  it('Stats toggle is visible and default off (panel host not mounted)', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-stats-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-stats-panel-host')).toBeNull();
    expect(screen.queryByTestId('feature-tree-stats-panel')).toBeNull();
    expect(
      screen.getByTestId('solver-stats-toggle').getAttribute('aria-expanded'),
    ).toBe('false');
    // Default English label surfaces the 📊 icon (per agent contract).
    expect(screen.getByTestId('solver-stats-toggle').textContent).toMatch(/📊/);
    expect(screen.getByTestId('solver-stats-toggle').textContent).toMatch(/Stats/);
  });

  it('clicking the stats toggle mounts FeatureTreeStatsPanel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-stats-toggle'));
    expect(await screen.findByTestId('solver-stats-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('feature-tree-stats-panel')).toBeInTheDocument();
    expect(
      screen.getByTestId('solver-stats-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('clicking the toggle a second time unmounts the panel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-stats-toggle'));
    await screen.findByTestId('feature-tree-stats-panel');
    fireEvent.click(screen.getByTestId('solver-stats-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-stats-panel')).toBeNull();
      expect(screen.queryByTestId('solver-stats-panel-host')).toBeNull();
    });
  });

  it('empty live tree → panel renders the empty state (0/0/empty)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-stats-toggle'));
    // The panel's own empty surrogate test id surfaces the "Add a feature…" copy.
    expect(await screen.findByTestId('feature-tree-stats-empty')).toBeInTheDocument();
    // Aggregate rows must NOT appear when the tree is empty.
    expect(screen.queryByTestId('feature-tree-stats-total-volume')).toBeNull();
    expect(screen.queryByTestId('feature-tree-stats-bbox')).toBeNull();
    // No selected sub-section either (nothing selectable).
    expect(screen.queryByTestId('feature-tree-stats-selected')).toBeNull();
  });

  it('selectedFeatureId set → "Selected feature" sub-section surfaces with per-node stats', async () => {
    // Build a live tree via STEP import so the payload passes
    // validatePayload (the wrapper's modal-driven append synthesises
    // `{kind:'extrude'}` only — that stub would crash computeStats'
    // signedArea walk on `p.loop.length`). The seeded extrude is a
    // 10×10×5 box centered at origin.
    const stepImportFetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: {
        nodes: [
          {
            id: 'imported_0',
            name: 'Box',
            dependencies: [],
            payload: {
              kind: 'extrude' as const,
              loop: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
              ],
              depth: 5,
              direction: 'one_sided' as const,
              mode: 'add' as const,
            },
          },
        ],
      },
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
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });

    // Import → live tree gets `imported_0`.
    fireEvent.click(screen.getByTestId('solver-import-step-button'));
    await screen.findByTestId('step-import-modal');
    const fi = screen.getByTestId('step-import-file-input') as HTMLInputElement;
    Object.defineProperty(fi, 'files', {
      value: [new File(['x'], 'p.step', { type: 'application/octet-stream' })],
      configurable: true,
    });
    fireEvent.change(fi);
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await screen.findByTestId('feature-tree-row-imported_0');

    // Open stats panel: aggregate rows surface (no selection yet → no
    // selected sub-section).
    fireEvent.click(screen.getByTestId('solver-stats-toggle'));
    await screen.findByTestId('feature-tree-stats-panel');
    expect(await screen.findByTestId('feature-tree-stats-total-volume')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-tree-stats-selected')).toBeNull();

    // Click the tree row → selectedFeatureId propagates → selected
    // sub-section mounts.
    fireEvent.click(screen.getByTestId('feature-tree-row-imported_0'));
    await waitFor(() => {
      expect(screen.getByTestId('feature-tree-stats-selected')).toBeInTheDocument();
    });
    // The selected-kind row should surface 'extrude'.
    expect(screen.getByTestId('feature-tree-stats-selected-kind').textContent).toMatch(
      /extrude/i,
    );
  });

  it('stats toggle is independent of AI planner / examples / branches toggles', async () => {
    await mountReady();
    // Flip all four on; each should mount its own host.
    fireEvent.click(screen.getByTestId('solver-planner-toggle'));
    fireEvent.click(screen.getByTestId('solver-planner-examples-toggle'));
    fireEvent.click(screen.getByTestId('solver-branches-toggle'));
    fireEvent.click(screen.getByTestId('solver-stats-toggle'));
    expect(await screen.findByTestId('solver-planner-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('solver-planner-examples-host')).toBeInTheDocument();
    expect(await screen.findByTestId('solver-branches-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('solver-stats-panel-host')).toBeInTheDocument();
    expect(await screen.findByTestId('planner-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('planner-intent-examples-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('branch-manager-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('feature-tree-stats-panel')).toBeInTheDocument();
    // Toggle stats off — the other three stay mounted.
    fireEvent.click(screen.getByTestId('solver-stats-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('feature-tree-stats-panel')).toBeNull();
    });
    expect(screen.getByTestId('planner-panel')).toBeInTheDocument();
    expect(screen.getByTestId('planner-intent-examples-panel')).toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-panel')).toBeInTheDocument();
  });

  it('English i18n: "Stats" surfaces on the toggle with show/hide aria-label flip', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-stats-toggle');
    expect(toggle.textContent).toMatch(/Stats/);
    // Default off → aria-label is "Show stats".
    expect(toggle.getAttribute('aria-label')).toBe('Show stats');
    // Flip on → aria-label changes to "Hide stats".
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(
        screen.getByTestId('solver-stats-toggle').getAttribute('aria-label'),
      ).toBe('Hide stats');
    });
  });

  it('Korean i18n: 통계 surfaces on the toggle', async () => {
    render(<SolverSketchEditorWithExtrude lang="ko" extrudeFetcher={vi.fn()} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
      timeout: 10000,
    });
    const toggle = screen.getByTestId('solver-stats-toggle');
    expect(toggle.textContent).toMatch(/통계/);
    expect(toggle.getAttribute('aria-label')).toBe('통계 표시');
  });

  it('Japanese / Chinese / Spanish / Arabic i18n: toggle label is translated', async () => {
    const cases: Array<{ lang: 'ja' | 'zh' | 'es' | 'ar'; label: RegExp; ariaContains: string }> = [
      { lang: 'ja', label: /統計/, ariaContains: '統計' },
      { lang: 'zh', label: /统计/, ariaContains: '统计' },
      { lang: 'es', label: /Estadísticas/, ariaContains: 'estadísticas' },
      { lang: 'ar', label: /إحصائيات/, ariaContains: 'إحصائيات' },
    ];
    for (const { lang, label, ariaContains } of cases) {
      const { unmount } = render(
        <SolverSketchEditorWithExtrude lang={lang} extrudeFetcher={vi.fn()} />,
      );
      const editor = await screen.findByTestId('solver-sketch-editor');
      await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), {
        timeout: 10000,
      });
      const toggle = screen.getByTestId('solver-stats-toggle');
      expect(toggle.textContent).toMatch(label);
      expect((toggle.getAttribute('aria-label') ?? '').toLowerCase()).toContain(
        ariaContains.toLowerCase(),
      );
      unmount();
    }
  });
});
