/** @vitest-environment jsdom */
/**
 * SolverSketchEditor + SketchGroupPanel integration tests.
 *
 * Verifies the Phase 2.x sketchGroup wiring:
 *   - "Groups" toggle button mounts/unmounts the panel (default OFF).
 *   - Selection (>=2) enables "Group selected (N)".
 *   - Creating a group invokes the SketchGroupManager + clears selection;
 *     the row appears under the panel.
 *   - Translate from the panel re-solves: the underlying point moves.
 *   - Lock toggle propagates to the row + disables transform inputs.
 *   - Delete removes the row.
 *   - i18n: 'Groups' surfaces in the ko bundle.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

// ─── helpers ────────────────────────────────────────────────────────────

async function mountReady(lang: 'en' | 'ko' = 'en'): Promise<HTMLElement> {
  render(<SolverSketchEditor lang={lang} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
  return editor;
}

function clickAt(el: Element, x: number, y: number, init: MouseEventInit = {}): void {
  fireEvent.click(el, { clientX: x, clientY: y, ...init });
}

function getLines(): NodeListOf<SVGLineElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-l"]',
  ) as NodeListOf<SVGLineElement>;
}

function getPoints(): NodeListOf<SVGCircleElement> {
  return document.querySelectorAll(
    '[data-testid^="solver-sketch-entity-p"]',
  ) as NodeListOf<SVGCircleElement>;
}

async function drawLine(
  startX: number, startY: number, endX: number, endY: number,
): Promise<void> {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
  const canvas = screen.getByTestId('solver-sketch-canvas');
  clickAt(canvas, startX, startY);
  clickAt(canvas, endX, endY);
  const before = getLines().length - 1;
  await waitFor(() => expect(getLines().length).toBeGreaterThan(before));
}

async function selectPoint(idx: number): Promise<SVGCircleElement> {
  fireEvent.click(screen.getByTestId('solver-sketch-tool-select'));
  const pts = getPoints();
  const target = pts[idx]!;
  fireEvent.click(target, {
    clientX: Number(target.getAttribute('cx')),
    clientY: Number(target.getAttribute('cy')),
  });
  return target;
}

async function shiftClickPoint(idx: number): Promise<void> {
  const pts = getPoints();
  const target = pts[idx]!;
  fireEvent.click(target, {
    clientX: Number(target.getAttribute('cx')),
    clientY: Number(target.getAttribute('cy')),
    shiftKey: true,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────────────────

describe('SolverSketchEditor + SketchGroupPanel integration', () => {
  it('groups toggle button is present and starts unpressed (panel off)', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-sketch-groups-toggle') as HTMLButtonElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('solver-sketch-group-panel')).toBeNull();
  });

  it('clicking the toggle mounts the SketchGroupPanel', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));
    expect(screen.getByTestId('solver-sketch-group-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sketch-group-create')).toBeInTheDocument();
  });

  it('Group selected button is disabled with 0-1 selection, enabled with >=2', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));

    const btn = () => screen.getByTestId('solver-sketch-group-create') as HTMLButtonElement;
    expect(btn().disabled).toBe(true);

    await drawLine(100, 100, 200, 100);
    await selectPoint(0); // 1 point selected
    expect(btn().disabled).toBe(true);

    await shiftClickPoint(1); // add second point
    await waitFor(() => expect(btn().disabled).toBe(false));
  });

  it('creating a group adds a row + clears selection', async () => {
    // Auto-accept the default name (panel sends defaultName via prompt).
    vi.spyOn(window, 'prompt').mockImplementation((_msg, dflt) => dflt ?? 'Group 1');
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));

    await drawLine(100, 100, 200, 100);
    await selectPoint(0);
    await shiftClickPoint(1);

    fireEvent.click(screen.getByTestId('solver-sketch-group-create'));

    // A row appears.
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid^="solver-sketch-group-row-"]');
      expect(rows.length).toBe(1);
    });
    // Empty hint gone.
    expect(screen.queryByTestId('solver-sketch-group-empty')).toBeNull();
    // Selection cleared → button back to disabled.
    const btn = screen.getByTestId('solver-sketch-group-create') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('translating a group via the panel moves the underlying point', async () => {
    vi.spyOn(window, 'prompt').mockImplementation((_msg, dflt) => dflt ?? 'Group 1');
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));

    await drawLine(100, 100, 200, 100);
    await selectPoint(0);
    await shiftClickPoint(1);
    fireEvent.click(screen.getByTestId('solver-sketch-group-create'));

    const row = await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid^="solver-sketch-group-row-"]');
      expect(rows.length).toBe(1);
      return rows[0]!;
    });
    const gid = (row.getAttribute('data-testid') ?? '').replace('solver-sketch-group-row-', '');

    // Snapshot first point's cx before transform.
    const xBefore = Number(getPoints()[0]!.getAttribute('cx'));

    const dx = screen.getByTestId(`solver-sketch-group-translate-dx-${gid}`) as HTMLInputElement;
    fireEvent.change(dx, { target: { value: '40' } });
    fireEvent.click(screen.getByTestId(`solver-sketch-group-translate-apply-${gid}`));

    await waitFor(() => {
      const xAfter = Number(getPoints()[0]!.getAttribute('cx'));
      expect(xAfter).toBeCloseTo(xBefore + 40, 1);
    });
  });

  it('lock toggle marks the row locked + disables transform apply', async () => {
    vi.spyOn(window, 'prompt').mockImplementation((_msg, dflt) => dflt ?? 'Group 1');
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));

    await drawLine(100, 100, 200, 100);
    await selectPoint(0);
    await shiftClickPoint(1);
    fireEvent.click(screen.getByTestId('solver-sketch-group-create'));

    const row = await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid^="solver-sketch-group-row-"]');
      expect(rows.length).toBe(1);
      return rows[0]!;
    });
    const gid = (row.getAttribute('data-testid') ?? '').replace('solver-sketch-group-row-', '');

    fireEvent.click(screen.getByTestId(`solver-sketch-group-lock-${gid}`));
    await waitFor(() => {
      const r = screen.getByTestId(`solver-sketch-group-row-${gid}`);
      expect(r.getAttribute('data-group-locked')).toBe('true');
      const apply = screen.getByTestId(
        `solver-sketch-group-translate-apply-${gid}`,
      ) as HTMLButtonElement;
      expect(apply.disabled).toBe(true);
    });
  });

  it('delete (with confirm=true) removes the row from the panel', async () => {
    vi.spyOn(window, 'prompt').mockImplementation((_msg, dflt) => dflt ?? 'Group 1');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));

    await drawLine(100, 100, 200, 100);
    await selectPoint(0);
    await shiftClickPoint(1);
    fireEvent.click(screen.getByTestId('solver-sketch-group-create'));

    const row = await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid^="solver-sketch-group-row-"]');
      expect(rows.length).toBe(1);
      return rows[0]!;
    });
    const gid = (row.getAttribute('data-testid') ?? '').replace('solver-sketch-group-row-', '');

    fireEvent.click(screen.getByTestId(`solver-sketch-group-delete-${gid}`));
    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-testid^="solver-sketch-group-row-"]').length,
      ).toBe(0);
      expect(screen.getByTestId('solver-sketch-group-empty')).toBeInTheDocument();
    });
  });

  it('rotate via panel changes the point position (90° around computed anchor)', async () => {
    vi.spyOn(window, 'prompt').mockImplementation((_msg, dflt) => dflt ?? 'Group 1');
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));

    await drawLine(100, 100, 200, 100);
    await selectPoint(0);
    await shiftClickPoint(1);
    fireEvent.click(screen.getByTestId('solver-sketch-group-create'));

    const row = await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid^="solver-sketch-group-row-"]');
      expect(rows.length).toBe(1);
      return rows[0]!;
    });
    const gid = (row.getAttribute('data-testid') ?? '').replace('solver-sketch-group-row-', '');

    const yBefore0 = Number(getPoints()[0]!.getAttribute('cy'));
    const yBefore1 = Number(getPoints()[1]!.getAttribute('cy'));

    const deg = screen.getByTestId(`solver-sketch-group-rotate-deg-${gid}`) as HTMLInputElement;
    fireEvent.change(deg, { target: { value: '90' } });
    fireEvent.click(screen.getByTestId(`solver-sketch-group-rotate-apply-${gid}`));

    // 90° rotation around the midpoint of two horizontally-placed points
    // makes them vertically-arranged. The y values diverge — so at least
    // one of them must change from its before-state.
    await waitFor(() => {
      const yA = Number(getPoints()[0]!.getAttribute('cy'));
      const yB = Number(getPoints()[1]!.getAttribute('cy'));
      expect(Math.abs(yA - yBefore0) + Math.abs(yB - yBefore1)).toBeGreaterThan(1);
    });
  });

  it('toggling the panel off removes it from the DOM (panel does not persist)', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-sketch-groups-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('solver-sketch-group-panel')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('solver-sketch-group-panel')).toBeNull();
  });

  it('i18n (ko): "그룹" label appears on the toggle button', async () => {
    await mountReady('ko');
    const toggle = screen.getByTestId('solver-sketch-groups-toggle');
    expect(toggle.textContent).toContain('그룹');
  });

  it('create-prompt cancel (prompt returns null) aborts group creation', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-groups-toggle'));

    await drawLine(100, 100, 200, 100);
    await selectPoint(0);
    await shiftClickPoint(1);
    fireEvent.click(screen.getByTestId('solver-sketch-group-create'));

    // No row was created, empty hint persists.
    expect(
      document.querySelectorAll('[data-testid^="solver-sketch-group-row-"]').length,
    ).toBe(0);
    expect(screen.getByTestId('solver-sketch-group-empty')).toBeInTheDocument();
  });
});
