/** @vitest-environment jsdom */
/**
 * ChamferModal — standalone modal tests (Phase 2.2 chamfer).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ChamferModal from '@/app/[lang]/shape-generator/sketch/ChamferModal';
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

describe('ChamferModal', () => {
  it('renders the modal with depth + distance inputs + edge radios + buttons', () => {
    render(
      <ChamferModal
        lang="en"
        sketch={rectSketch()}
        onClose={vi.fn()}
        chamferFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-chamfer-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-depth-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-distance-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-edges-radio-all')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-edges-radio-top')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-edges-radio-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-edges-radio-vertical')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-chamfer-cancel')).toBeInTheDocument();
  });

  it('shows the Phase 1 rect-only warning', () => {
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={vi.fn()} />,
    );
    const warn = screen.getByTestId('solver-chamfer-phase1-warning');
    expect(warn.textContent).toMatch(/Phase 1/i);
    expect(warn.textContent).toMatch(/rectangle/i);
  });

  it('default values: depth=20, distance=2, edges=all', () => {
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-chamfer-depth-input') as HTMLInputElement).value).toBe(
      '20',
    );
    expect(
      (screen.getByTestId('solver-chamfer-distance-input') as HTMLInputElement).value,
    ).toBe('2');
    expect(
      (screen.getByTestId('solver-chamfer-edges-radio-all') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={onClose} chamferFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-chamfer-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={onClose} chamferFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-chamfer-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('updates depth and distance from user input', () => {
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={vi.fn()} />,
    );
    const depth = screen.getByTestId('solver-chamfer-depth-input') as HTMLInputElement;
    const distance = screen.getByTestId('solver-chamfer-distance-input') as HTMLInputElement;
    fireEvent.change(depth, { target: { value: '30' } });
    fireEvent.change(distance, { target: { value: '1.5' } });
    expect(depth.value).toBe('30');
    expect(distance.value).toBe('1.5');
  });

  it('changes edge selection via radio buttons', () => {
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={vi.fn()} />,
    );
    const bottom = screen.getByTestId('solver-chamfer-edges-radio-bottom') as HTMLInputElement;
    fireEvent.click(bottom);
    expect(bottom.checked).toBe(true);
    expect(
      (screen.getByTestId('solver-chamfer-edges-radio-all') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('submit fires chamferFetcher with depth + distance + edgeSelection + sketch', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'minkowski() { ... }',
      pngs: [],
    });
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-chamfer-depth-input'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByTestId('solver-chamfer-distance-input'), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByTestId('solver-chamfer-edges-radio-vertical'));
    fireEvent.click(screen.getByTestId('solver-chamfer-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.depth).toBe(25);
    expect(call.distance).toBe(1.5);
    expect(call.edgeSelection).toBe('vertical');
    expect(call.includeStl).toBe(true);
    expect(call.sketch.points.length).toBe(4);
  });

  it('client-side check fires for non-positive distance before fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-chamfer-distance-input'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-chamfer-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-chamfer-error');
      expect(err.textContent).toMatch(/distance/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side check fires when distance ≥ depth/3 for top/bottom/all edges', async () => {
    const fetcher = vi.fn();
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-chamfer-depth-input'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('solver-chamfer-distance-input'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('solver-chamfer-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-chamfer-error');
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
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-chamfer-depth-input'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('solver-chamfer-distance-input'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('solver-chamfer-edges-radio-vertical'));
    fireEvent.click(screen.getByTestId('solver-chamfer-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it('success response renders SCAD preview + PNG previews', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'minkowski() { cube([8,3,18]); polyhedron(...); }',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-chamfer-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-chamfer-scad-preview');
      expect(pre.textContent).toContain('minkowski()');
    });
    const img0 = screen.getByTestId('solver-chamfer-png-preview-0') as HTMLImageElement;
    expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    const img1 = screen.getByTestId('solver-chamfer-png-preview-1') as HTMLImageElement;
    expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('error response renders the error message (e.g. non-rect Phase 1 error)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'Chamfer Phase 1: profile must be a rectangle with 4 corners',
    });
    render(
      <ChamferModal lang="en" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-chamfer-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-chamfer-error');
      expect(err.textContent).toMatch(/rectangle/);
    });
  });

  it('Korean lang: shows 챔퍼 (submit) and 거리 (distance label)', () => {
    render(
      <ChamferModal lang="ko" sketch={rectSketch()} onClose={vi.fn()} chamferFetcher={vi.fn()} />,
    );
    const submit = screen.getByTestId('solver-chamfer-submit');
    expect(submit.textContent).toMatch(/챔퍼/);
    expect(screen.getByText(/거리/)).toBeInTheDocument();
  });
});
