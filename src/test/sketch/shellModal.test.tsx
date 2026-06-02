/** @vitest-environment jsdom */
/**
 * ShellModal — standalone modal tests (Phase 2.4 shell).
 *
 * ShellModal is a standalone component that takes the sketch state as a
 * prop and parameters (depth / thickness / open-face flags). These tests
 * render it directly and mock the shellFetcher; they do NOT spin up
 * SolverSketchEditor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ShellModal from '@/app/[lang]/shape-generator/sketch/ShellModal';
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

describe('ShellModal', () => {
  it('renders the modal with depth + thickness inputs + open-face checkboxes + buttons', () => {
    render(
      <ShellModal
        lang="en"
        sketch={rectSketch()}
        onClose={vi.fn()}
        shellFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-shell-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-shell-depth-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-shell-thickness-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-shell-open-top-checkbox')).toBeInTheDocument();
    expect(screen.getByTestId('solver-shell-open-bottom-checkbox')).toBeInTheDocument();
    expect(screen.getByTestId('solver-shell-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-shell-cancel')).toBeInTheDocument();
  });

  it('shows the Phase 1 rect-only warning', () => {
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={vi.fn()} />,
    );
    const warn = screen.getByTestId('solver-shell-phase1-warning');
    expect(warn.textContent).toMatch(/Phase 1/i);
    expect(warn.textContent).toMatch(/rectangle/i);
  });

  it('default values: depth=20, thickness=2, openTop=true, openBottom=false', () => {
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-shell-depth-input') as HTMLInputElement).value).toBe('20');
    expect(
      (screen.getByTestId('solver-shell-thickness-input') as HTMLInputElement).value,
    ).toBe('2');
    expect(
      (screen.getByTestId('solver-shell-open-top-checkbox') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('solver-shell-open-bottom-checkbox') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={onClose} shellFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-shell-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={onClose} shellFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-shell-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('updates depth and thickness from user input', () => {
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={vi.fn()} />,
    );
    const depth = screen.getByTestId('solver-shell-depth-input') as HTMLInputElement;
    const thickness = screen.getByTestId('solver-shell-thickness-input') as HTMLInputElement;
    fireEvent.change(depth, { target: { value: '30' } });
    fireEvent.change(thickness, { target: { value: '1.5' } });
    expect(depth.value).toBe('30');
    expect(thickness.value).toBe('1.5');
  });

  it('toggles open-top and open-bottom checkboxes', () => {
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={vi.fn()} />,
    );
    const top = screen.getByTestId('solver-shell-open-top-checkbox') as HTMLInputElement;
    const bot = screen.getByTestId('solver-shell-open-bottom-checkbox') as HTMLInputElement;
    fireEvent.click(top); // default true → false
    fireEvent.click(bot); // default false → true
    expect(top.checked).toBe(false);
    expect(bot.checked).toBe(true);
  });

  it('submit fires shellFetcher with depth + thickness + flags + sketch', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'difference() { ... }',
      pngs: [],
    });
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-shell-depth-input'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByTestId('solver-shell-thickness-input'), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByTestId('solver-shell-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.depth).toBe(25);
    expect(call.thickness).toBe(1.5);
    expect(call.openTop).toBe(true);
    expect(call.openBottom).toBe(false);
    expect(call.includeStl).toBe(true);
    expect(call.sketch.points.length).toBe(4);
  });

  it('client-side check fires for non-positive thickness before fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-shell-thickness-input'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-shell-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-shell-error');
      expect(err.textContent).toMatch(/thickness/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side check fires when thickness ≥ depth/3 before fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-shell-depth-input'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('solver-shell-thickness-input'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('solver-shell-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-shell-error');
      expect(err.textContent).toMatch(/depth\/3/);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('success response renders SCAD preview + PNG previews', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'difference() { translate([0,0,0]) cube([10,5,20]); ... }',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-shell-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-shell-scad-preview');
      expect(pre.textContent).toContain('difference()');
    });
    const img0 = screen.getByTestId('solver-shell-png-preview-0') as HTMLImageElement;
    expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    const img1 = screen.getByTestId('solver-shell-png-preview-1') as HTMLImageElement;
    expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('error response renders the error message (e.g. non-rect Phase 1 error)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'Shell Phase 1: profile must be a rectangle with 4 corners',
    });
    render(
      <ShellModal lang="en" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-shell-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-shell-error');
      expect(err.textContent).toMatch(/rectangle/);
    });
  });

  it('Korean lang: shows 쉘 (submit) and 두께 (thickness label)', () => {
    render(
      <ShellModal lang="ko" sketch={rectSketch()} onClose={vi.fn()} shellFetcher={vi.fn()} />,
    );
    const submit = screen.getByTestId('solver-shell-submit');
    expect(submit.textContent).toMatch(/쉘/);
    expect(screen.getByText(/두께/)).toBeInTheDocument();
  });
});
