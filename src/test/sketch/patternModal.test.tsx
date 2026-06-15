/** @vitest-environment jsdom */
/**
 * PatternModal — standalone modal tests (Phase 2.4 linear + circular).
 *
 * PatternModal is a standalone component that takes the sketch state as a
 * prop. These tests render it directly and mock the patternFetcher; they
 * do NOT spin up SolverSketchEditor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import PatternModal from '@/app/[lang]/shape-generator/sketch/PatternModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function rectSketch(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 10 },
      { id: 'p4', x: 0, y: 10 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('PatternModal — structure', () => {
  it('renders the modal with tabs + shared fields + linear inputs by default', () => {
    render(
      <PatternModal
        lang="en"
        sketch={rectSketch()}
        onClose={vi.fn()}
        patternFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-pattern-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-tab-linear')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-tab-circular')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-depth-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-count-input')).toBeInTheDocument();
    // Linear-only fields show first.
    expect(screen.getByTestId('solver-pattern-direction-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-direction-y-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-direction-z-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-spacing-input')).toBeInTheDocument();
    // Circular-only fields are not in DOM yet.
    expect(screen.queryByTestId('solver-pattern-axis-origin-x-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('solver-pattern-total-angle-input')).not.toBeInTheDocument();
    // Buttons present.
    expect(screen.getByTestId('solver-pattern-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-cancel')).toBeInTheDocument();
  });

  it('clicking the circular tab swaps inputs', () => {
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    expect(screen.getByTestId('solver-pattern-axis-origin-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-axis-direction-z-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-pattern-total-angle-input')).toBeInTheDocument();
    // Linear-only inputs are gone.
    expect(screen.queryByTestId('solver-pattern-direction-x-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('solver-pattern-spacing-input')).not.toBeInTheDocument();
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={onClose} patternFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={onClose} patternFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-modal'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('PatternModal — tab preservation', () => {
  it('depth + count are preserved across tab switches', () => {
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    const depth = screen.getByTestId('solver-pattern-depth-input') as HTMLInputElement;
    const count = screen.getByTestId('solver-pattern-count-input') as HTMLInputElement;
    fireEvent.change(depth, { target: { value: '7' } });
    fireEvent.change(count, { target: { value: '8' } });
    // Switch to circular and back.
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    fireEvent.click(screen.getByTestId('solver-pattern-tab-linear'));
    expect((screen.getByTestId('solver-pattern-depth-input') as HTMLInputElement).value).toBe('7');
    expect((screen.getByTestId('solver-pattern-count-input') as HTMLInputElement).value).toBe('8');
  });

  it('linear direction inputs are preserved after switching to circular and back', () => {
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId('solver-pattern-direction-x-input'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    fireEvent.click(screen.getByTestId('solver-pattern-tab-linear'));
    expect(
      (screen.getByTestId('solver-pattern-direction-x-input') as HTMLInputElement).value,
    ).toBe('5');
  });

  it('circular axis inputs are preserved after switching to linear and back', () => {
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    fireEvent.change(screen.getByTestId('solver-pattern-axis-origin-x-input'), {
      target: { value: '42' },
    });
    fireEvent.change(screen.getByTestId('solver-pattern-total-angle-input'), {
      target: { value: '180' },
    });
    fireEvent.click(screen.getByTestId('solver-pattern-tab-linear'));
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    expect(
      (screen.getByTestId('solver-pattern-axis-origin-x-input') as HTMLInputElement).value,
    ).toBe('42');
    expect(
      (screen.getByTestId('solver-pattern-total-angle-input') as HTMLInputElement).value,
    ).toBe('180');
  });
});

describe('PatternModal — submit (linear)', () => {
  it('fires the fetcher with kind=linear and the right params', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'module nexyfab_pattern_child(){}\nfor (i = [0:3]) translate(...) nexyfab_pattern_child();',
      pngs: [],
    });
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-pattern-depth-input'), { target: { value: '6' } });
    fireEvent.change(screen.getByTestId('solver-pattern-count-input'), { target: { value: '5' } });
    fireEvent.change(screen.getByTestId('solver-pattern-direction-x-input'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByTestId('solver-pattern-direction-y-input'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId('solver-pattern-spacing-input'), {
      target: { value: '12' },
    });

    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.kind).toBe('linear');
    expect(call.child.depth).toBe(6);
    expect(call.count).toBe(5);
    expect(call.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(call.spacing).toBe(12);
    expect(call.includeStl).toBe(true);
    expect(call.sketch.points.length).toBe(4);
  });

  it('renders SCAD preview on success', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'module nexyfab_pattern_child() { cube([1,1,1]); }\nfor (i = [0:2]) translate([5*i,0,0]) nexyfab_pattern_child();',
      pngs: [],
    });
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-pattern-scad-preview');
      expect(pre.textContent).toContain('nexyfab_pattern_child');
    });
  });

  it('renders error response message', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'No closed loop found',
    });
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-pattern-error');
      expect(err.textContent).toMatch(/No closed loop/);
    });
  });

  it('client-side zero-length direction check fires before the fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-pattern-direction-x-input'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByTestId('solver-pattern-direction-y-input'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByTestId('solver-pattern-direction-z-input'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-pattern-error');
      expect(err.textContent).toMatch(/zero-length/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side non-positive spacing check fires before the fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-pattern-spacing-input'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-pattern-error');
      expect(err.textContent).toMatch(/spacing/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('PatternModal — submit (circular)', () => {
  it('fires the fetcher with kind=circular and the right params', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'module nexyfab_pattern_child(){}\nfor (i=[0:5]) rotate(...) nexyfab_pattern_child();',
      pngs: [],
    });
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    fireEvent.change(screen.getByTestId('solver-pattern-depth-input'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('solver-pattern-count-input'), { target: { value: '6' } });
    fireEvent.change(screen.getByTestId('solver-pattern-axis-origin-x-input'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByTestId('solver-pattern-axis-direction-z-input'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId('solver-pattern-total-angle-input'), {
      target: { value: '180' },
    });

    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.kind).toBe('circular');
    expect(call.child.depth).toBe(4);
    expect(call.count).toBe(6);
    expect(call.axisOrigin).toEqual({ x: 100, y: 0, z: 0 });
    expect(call.axisDirection).toEqual({ x: 0, y: 0, z: 1 });
    expect(call.totalAngleDegrees).toBe(180);
  });

  it('client-side count < 2 check fires before fetcher (circular)', async () => {
    const fetcher = vi.fn();
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    fireEvent.change(screen.getByTestId('solver-pattern-count-input'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-pattern-error');
      expect(err.textContent).toMatch(/≥ 2|>= 2|at least 2/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side zero-length axis direction check fires before fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    fireEvent.change(screen.getByTestId('solver-pattern-axis-direction-z-input'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-pattern-error');
      expect(err.textContent).toMatch(/zero-length/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side total angle out of (0, 360] fires before fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-tab-circular'));
    fireEvent.change(screen.getByTestId('solver-pattern-total-angle-input'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-pattern-error');
      expect(err.textContent).toMatch(/angle/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('PatternModal — previews', () => {
  it('renders PNG previews from base64 data', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'module nexyfab_pattern_child(){}',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <PatternModal lang="en" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-pattern-submit'));
    await waitFor(() => {
      const img0 = screen.getByTestId('solver-pattern-png-preview-0') as HTMLImageElement;
      expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
      const img1 = screen.getByTestId('solver-pattern-png-preview-1') as HTMLImageElement;
      expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    });
  });
});

describe('PatternModal — i18n', () => {
  it('Korean lang: shows 패턴 in submit + tab labels', () => {
    render(
      <PatternModal lang="ko" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    expect(screen.getByTestId('solver-pattern-submit').textContent).toMatch(/패턴/);
    expect(screen.getByTestId('solver-pattern-tab-linear').textContent).toMatch(/선형/);
    expect(screen.getByTestId('solver-pattern-tab-circular').textContent).toMatch(/원형/);
  });

  it('Japanese lang: shows パターン in submit label', () => {
    render(
      <PatternModal lang="ja" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    expect(screen.getByTestId('solver-pattern-submit').textContent).toMatch(/パターン/);
  });

  it('Chinese lang: shows 阵列 in submit label', () => {
    render(
      <PatternModal lang="zh" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    expect(screen.getByTestId('solver-pattern-submit').textContent).toMatch(/阵列/);
  });

  it('Arabic lang: renders without crashing + has a non-empty submit label', () => {
    render(
      <PatternModal lang="ar" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    const submit = screen.getByTestId('solver-pattern-submit');
    expect(submit.textContent?.length).toBeGreaterThan(0);
  });

  it('Spanish lang: renders with Spanish labels', () => {
    render(
      <PatternModal lang="es" sketch={rectSketch()} onClose={vi.fn()} patternFetcher={vi.fn()} />,
    );
    expect(screen.getByTestId('solver-pattern-tab-linear').textContent).toMatch(/Lineal/);
  });
});
