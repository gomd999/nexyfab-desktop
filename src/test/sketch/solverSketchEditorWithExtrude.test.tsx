/** @vitest-environment jsdom */
/**
 * SolverSketchEditorWithExtrude — wrapper extrude button + modal tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditorWithExtrude from '@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude';

async function mountReady() {
  render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={vi.fn()} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
}

function clickAt(el: Element, x: number, y: number) {
  fireEvent.click(el, { clientX: x, clientY: y });
}

describe('SolverSketchEditorWithExtrude', () => {
  it('renders the Extrude button below the editor (disabled when sketch is empty)', async () => {
    await mountReady();
    const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    // Empty sketch → disabled.
    expect(btn.disabled).toBe(true);
  });

  it('enables Extrude button after a rect is drawn', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);

    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('clicking Extrude opens the modal with depth input', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    expect(screen.getByTestId('solver-extrude-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-extrude-depth-input')).toBeInTheDocument();
  });

  it('submit calls extrudeFetcher with sketch state + options', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(height=7) polygon(...);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });

    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    const depth = screen.getByTestId('solver-extrude-depth-input') as HTMLInputElement;
    fireEvent.change(depth, { target: { value: '7' } });

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.depth).toBe(7);
    expect(call.sketch.points.length).toBeGreaterThanOrEqual(4);
    expect(call.sketch.lines.length).toBeGreaterThanOrEqual(4);
    expect(call.direction).toBe('one_sided');
    expect(call.mode).toBe('add');
  });

  it('shows SCAD preview on success response', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(height=12)\n  polygon([[0,0],[10,0],[10,5],[0,5]]);',
      pngs: [],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-extrude-scad-preview');
      expect(pre.textContent).toContain('linear_extrude(height=12)');
    });
  });

  it('shows error message on failure response', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'no closed loop',
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-extrude-error');
      expect(err.textContent).toMatch(/no closed loop/);
    });
  });

  it('renders PNG previews from base64 data', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'cube(10);',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      const img0 = screen.getByTestId('solver-extrude-png-preview-0') as HTMLImageElement;
      const img1 = screen.getByTestId('solver-extrude-png-preview-1') as HTMLImageElement;
      expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
      expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  it('Korean lang: shows 돌출 on the button', async () => {
    render(<SolverSketchEditorWithExtrude lang="ko" extrudeFetcher={vi.fn()} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    expect(screen.getByText(/돌출/)).toBeInTheDocument();
  });

  it('cancel closes the modal without firing fetcher', async () => {
    const fetcher = vi.fn();
    render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher} />);
    const editor = await screen.findByTestId('solver-sketch-editor');
    await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
    fireEvent.click(screen.getByTestId('solver-sketch-tool-rect'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);
    await waitFor(() => {
      const btn = screen.getByTestId('solver-extrude-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    fireEvent.click(screen.getByTestId('solver-extrude-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-extrude-modal')).not.toBeInTheDocument();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
