/** @vitest-environment jsdom */
/**
 * FilletModal — standalone modal tests (Phase 2.2 fillet).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import FilletModal from '@/app/[lang]/shape-generator/sketch/FilletModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function rectSketch(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 5 },
      { id: 'p4', x: 0, y: 5 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('FilletModal', () => {
  it('renders the modal with depth + radius inputs + edge radios + buttons', () => {
    render(
      <FilletModal
        lang="en"
        sketch={rectSketch()}
        onClose={vi.fn()}
        filletFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-fillet-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-depth-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-radius-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-edges-radio-all')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-edges-radio-top')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-edges-radio-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-edges-radio-vertical')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-fillet-cancel')).toBeInTheDocument();
  });

  it('shows the Phase 1 rect-only warning', () => {
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={vi.fn()} />,
    );
    const warn = screen.getByTestId('solver-fillet-phase1-warning');
    expect(warn.textContent).toMatch(/Phase 1/i);
    expect(warn.textContent).toMatch(/rectangle/i);
  });

  it('default values: depth=20, radius=2, edges=all', () => {
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-fillet-depth-input') as HTMLInputElement).value).toBe(
      '20',
    );
    expect((screen.getByTestId('solver-fillet-radius-input') as HTMLInputElement).value).toBe(
      '2',
    );
    expect(
      (screen.getByTestId('solver-fillet-edges-radio-all') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={onClose} filletFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-fillet-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={onClose} filletFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-fillet-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('updates depth and radius from user input', () => {
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={vi.fn()} />,
    );
    const depth = screen.getByTestId('solver-fillet-depth-input') as HTMLInputElement;
    const radius = screen.getByTestId('solver-fillet-radius-input') as HTMLInputElement;
    fireEvent.change(depth, { target: { value: '30' } });
    fireEvent.change(radius, { target: { value: '1.5' } });
    expect(depth.value).toBe('30');
    expect(radius.value).toBe('1.5');
  });

  it('changes edge selection via radio buttons', () => {
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={vi.fn()} />,
    );
    const vertical = screen.getByTestId('solver-fillet-edges-radio-vertical') as HTMLInputElement;
    fireEvent.click(vertical);
    expect(vertical.checked).toBe(true);
    expect(
      (screen.getByTestId('solver-fillet-edges-radio-all') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('submit fires filletFetcher with depth + radius + edgeSelection + sketch', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'minkowski() { ... }',
      pngs: [],
    });
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-fillet-depth-input'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByTestId('solver-fillet-radius-input'), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByTestId('solver-fillet-edges-radio-top'));
    fireEvent.click(screen.getByTestId('solver-fillet-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.depth).toBe(25);
    expect(call.radius).toBe(1.5);
    expect(call.edgeSelection).toBe('top');
    expect(call.includeStl).toBe(true);
    expect(call.sketch.points.length).toBe(4);
  });

  it('client-side check fires for non-positive radius before fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-fillet-radius-input'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-fillet-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-fillet-error');
      expect(err.textContent).toMatch(/radius/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side check fires when radius ≥ depth/3 for top/bottom/all edges', async () => {
    const fetcher = vi.fn();
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-fillet-depth-input'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('solver-fillet-radius-input'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('solver-fillet-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-fillet-error');
      expect(err.textContent).toMatch(/depth\/3/);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('depth/3 gate is bypassed for vertical-only edges', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'minkowski() { ... }',
      pngs: [],
    });
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-fillet-depth-input'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('solver-fillet-radius-input'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('solver-fillet-edges-radio-vertical'));
    fireEvent.click(screen.getByTestId('solver-fillet-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it('success response renders SCAD preview + PNG previews', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'minkowski() { cube([8,3,18]); sphere(r=1, $fn=32); }',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-fillet-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-fillet-scad-preview');
      expect(pre.textContent).toContain('minkowski()');
    });
    const img0 = screen.getByTestId('solver-fillet-png-preview-0') as HTMLImageElement;
    expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    const img1 = screen.getByTestId('solver-fillet-png-preview-1') as HTMLImageElement;
    expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('error response renders the error message (e.g. non-rect Phase 1 error)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'Fillet Phase 1: profile must be a rectangle with 4 corners',
    });
    render(
      <FilletModal lang="en" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-fillet-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-fillet-error');
      expect(err.textContent).toMatch(/rectangle/);
    });
  });

  it('Korean lang: shows 필렛 (submit) and 반경 (radius label)', () => {
    render(
      <FilletModal lang="ko" sketch={rectSketch()} onClose={vi.fn()} filletFetcher={vi.fn()} />,
    );
    const submit = screen.getByTestId('solver-fillet-submit');
    expect(submit.textContent).toMatch(/필렛/);
    expect(screen.getByText(/반경/)).toBeInTheDocument();
  });
});
