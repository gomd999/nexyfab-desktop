/** @vitest-environment jsdom */
/**
 * SolverSketchEditorWithExtrude — STL viewer mount tests.
 *
 * Pins the bug fix where the wrapper previously imported StlViewer but
 * never rendered it. The host element is the wrapper's own div (rendered
 * synchronously when render.result.stl !== undefined); the StlViewer
 * itself is dynamic-imported behind that host so we only need to check
 * the host's presence here.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditorWithExtrude from '@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude';

function clickAt(el: Element, x: number, y: number) {
  fireEvent.click(el, { clientX: x, clientY: y });
}

async function mountAndOpenModal(fetcher: ReturnType<typeof vi.fn>): Promise<void> {
  render(<SolverSketchEditorWithExtrude lang="en" extrudeFetcher={fetcher as never} />);
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
  expect(screen.getByTestId('solver-extrude-modal')).toBeInTheDocument();
}

describe('SolverSketchEditorWithExtrude — StlViewer mount', () => {
  it('renders the StlViewer host when fetcher returns stl base64', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'cube(5);',
      pngs: [],
      stl: 'AAAA', // fake base64 — wrapper doesn't validate, viewer is dynamic-loaded
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('solver-extrude-stl-viewer-host')).toBeInTheDocument();
    });
  });

  it('does NOT render the StlViewer host when fetcher omits stl', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'cube(5);',
      pngs: [{ label: 'iso', base64: 'iVBORw0KGgo=' }],
      // stl intentionally omitted.
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    // Wait for the success render so we know we're past loading state.
    await waitFor(() => {
      expect(screen.getByTestId('solver-extrude-scad-preview').textContent).toContain('cube(5);');
    });
    expect(screen.queryByTestId('solver-extrude-stl-viewer-host')).not.toBeInTheDocument();
  });
});
