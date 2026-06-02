/** @vitest-environment jsdom */
/**
 * SolverSketchEditorWithExtrude — error-path / edge-case tests.
 *
 * Companion to solverSketchEditorWithExtrude.test.tsx (happy paths).
 * Covers fetcher failures, client-side validation, loading state,
 * cancel-during-fetch cleanup, modal re-open state reset, and
 * response variants (missing pngs, missing stl, giant scad).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import SolverSketchEditorWithExtrude from '@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude';

// ── Helpers ───────────────────────────────────────────────────────────────

function clickAt(el: Element, x: number, y: number) {
  fireEvent.click(el, { clientX: x, clientY: y });
}

/**
 * Mounts the wrapper, waits for solver readiness, draws a rectangle (so the
 * Extrude button is enabled), and opens the modal. Returns nothing — caller
 * interacts via screen.getByTestId().
 */
async function mountAndOpenModal(
  fetcher: ReturnType<typeof vi.fn> = vi.fn(),
  lang: 'en' | 'ko' = 'en',
): Promise<void> {
  render(<SolverSketchEditorWithExtrude lang={lang} extrudeFetcher={fetcher as never} />);
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

// Deferred promise pattern for loading-state tests.
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SolverSketchEditorWithExtrude — error paths & edge cases', () => {
  // 1. Network-level rejection (fetch throws).
  it('shows "Error: <msg>" pill when fetcher rejects with a network error', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      const err = screen.getByTestId('solver-extrude-error');
      expect(err.textContent).toMatch(/Error: network down/);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // 2. Server validation: TOO_LARGE.
  it('renders TOO_LARGE message verbatim in the error pill', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'TOO_LARGE',
      message: 'Sketch has 5001 points (max 5000)',
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      const err = screen.getByTestId('solver-extrude-error');
      expect(err.textContent).toMatch(/Sketch has 5001 points \(max 5000\)/);
    });
  });

  // 3. Server failure: ENOENT (openscad CLI missing).
  it('renders ENOENT message verbatim in the error pill', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'ENOENT',
      message: 'openscad CLI not found',
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      const err = screen.getByTestId('solver-extrude-error');
      expect(err.textContent).toMatch(/openscad CLI not found/);
    });
  });

  // 4. ok=true with empty pngs[] — SCAD pre renders, no img elements.
  it('renders SCAD only (no broken images) when pngs[] is empty', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'cube([1,2,3]);',
      pngs: [],
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('solver-extrude-scad-preview').textContent).toContain('cube([1,2,3]);');
    });
    // No png preview elements should exist.
    expect(screen.queryByTestId('solver-extrude-png-preview-0')).not.toBeInTheDocument();
  });

  // 5. Giant SCAD source (50KB) — should render without crashing.
  it('renders giant SCAD (50KB) into the pre element without crashing', async () => {
    const giantScad = 'cube(1);\n'.repeat(5000); // ~45KB
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: giantScad,
      pngs: [],
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      const pre = screen.getByTestId('solver-extrude-scad-preview');
      // textContent will contain all the lines.
      expect(pre.textContent!.length).toBeGreaterThan(40_000);
      expect(pre.textContent).toContain('cube(1);');
    });
  });

  // 6. Client-side validation: depth = '0' is rejected without calling fetcher.
  it('rejects depth=0 client-side with "depth must be > 0" and does NOT call fetcher', async () => {
    const fetcher = vi.fn();
    await mountAndOpenModal(fetcher);

    const depth = screen.getByTestId('solver-extrude-depth-input') as HTMLInputElement;
    fireEvent.change(depth, { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      const err = screen.getByTestId('solver-extrude-error');
      expect(err.textContent).toMatch(/depth must be > 0/);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  // 7. Client-side validation: depth = 'abc' (NaN).
  it('rejects depth="abc" (NaN) client-side and does NOT call fetcher', async () => {
    const fetcher = vi.fn();
    await mountAndOpenModal(fetcher);

    const depth = screen.getByTestId('solver-extrude-depth-input') as HTMLInputElement;
    // type="number" inputs clear their value when given non-numeric text.
    // That still produces a non-finite Number() → triggers the same branch.
    fireEvent.change(depth, { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      const err = screen.getByTestId('solver-extrude-error');
      expect(err.textContent).toMatch(/depth must be > 0/);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  // 8. Huge but valid depth — wrapper passes it through; server is the bound enforcer.
  it('passes depth=999999 through to fetcher (no client-side upper-bound check)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'linear_extrude(height=999999) ...',
      pngs: [],
    });
    await mountAndOpenModal(fetcher);

    const depth = screen.getByTestId('solver-extrude-depth-input') as HTMLInputElement;
    fireEvent.change(depth, { target: { value: '999999' } });
    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    const callArg = fetcher.mock.calls[0]![0]!;
    expect(callArg.depth).toBe(999999);
  });

  // 9. Loading state: submit button disabled + "Rendering..." indicator visible.
  it('shows "Rendering..." and disables submit while fetcher is pending', async () => {
    const d = deferred<{ ok: true; scad: string; pngs: never[] }>();
    const fetcher = vi.fn().mockReturnValue(d.promise);
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    // While pending: indicator visible, submit disabled.
    await waitFor(() => {
      expect(screen.getByText(/Rendering\.\.\./)).toBeInTheDocument();
    });
    const submitBtn = screen.getByTestId('solver-extrude-submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Resolve so the test doesn't leak a pending promise.
    d.resolve({ ok: true, scad: 'cube(1);', pngs: [] });
    await waitFor(() => {
      expect((screen.getByTestId('solver-extrude-submit') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // 10. Cancel during loading — modal closes even while fetch is in-flight.
  it('cancel closes modal mid-fetch (cleanup test)', async () => {
    const d = deferred<{ ok: true; scad: string; pngs: never[] }>();
    const fetcher = vi.fn().mockReturnValue(d.promise);
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    // Wait for loading state to engage.
    await waitFor(() => {
      expect(screen.getByText(/Rendering\.\.\./)).toBeInTheDocument();
    });

    // Cancel while fetch is still pending.
    fireEvent.click(screen.getByTestId('solver-extrude-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('solver-extrude-modal')).not.toBeInTheDocument();
    });

    // Resolve the late promise — no unhandled rejection, no crash.
    // Wrap in act() because the deferred setState lands after the modal closed.
    await act(async () => {
      d.resolve({ ok: true, scad: 'cube(1);', pngs: [] });
      await Promise.resolve();
    });
    expect(screen.queryByTestId('solver-extrude-modal')).not.toBeInTheDocument();
  });

  // 11. Re-opening the modal after an error clears the previous error message.
  it('clears previous error when the modal is re-opened', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'no closed loop',
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-extrude-error').textContent).toMatch(/no closed loop/);
    });

    // Close.
    fireEvent.click(screen.getByTestId('solver-extrude-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-extrude-modal')).not.toBeInTheDocument();
    });

    // Re-open.
    fireEvent.click(screen.getByTestId('solver-extrude-button'));
    expect(screen.getByTestId('solver-extrude-modal')).toBeInTheDocument();
    // Error pill is gone (render state reset to idle).
    expect(screen.queryByTestId('solver-extrude-error')).not.toBeInTheDocument();
  });

  // 12. Missing stl — render shows SCAD + PNGs, no StlViewer host.
  //
  // NOTE: as of writing this test, SolverSketchEditorWithExtrude *never*
  // renders <StlViewer> in its JSX (the import exists but is unused). This
  // test pins the CURRENT behaviour: regardless of whether `stl` is provided
  // or not, no `data-testid="stl-viewer"` element appears. If the wrapper is
  // updated to mount StlViewer in a follow-up, this test should be split into
  // two cases (with/without stl).
  it('renders SCAD + PNGs but no StlViewer host when stl is undefined', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'cube(5);',
      pngs: [{ label: 'iso', base64: 'iVBORw0KGgo=' }],
      // stl intentionally omitted.
    });
    await mountAndOpenModal(fetcher);

    fireEvent.click(screen.getByTestId('solver-extrude-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('solver-extrude-scad-preview').textContent).toContain('cube(5);');
    });
    const img = screen.getByTestId('solver-extrude-png-preview-0') as HTMLImageElement;
    expect(img.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    // No StlViewer host element.
    expect(screen.queryByTestId('stl-viewer')).not.toBeInTheDocument();
  });
});
