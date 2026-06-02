/** @vitest-environment jsdom */
/**
 * SketchConstraintOverlay — Phase 1.B sketch UX visualization tests.
 *
 * Validates that the SVG overlay correctly renders:
 *   - distance constraint as dim-line + arrowheads + label
 *   - angle constraint as arc + degree label
 *   - geometric constraints (horizontal/vertical/parallel/perpendicular/...)
 *     as small badge characters
 *   - selection highlight (blue)
 *   - click → onSelect, delete affordance → onDelete
 *   - label positioning (midpoint + perpendicular offset)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SketchConstraintOverlay, {
  type DisplayConstraint,
} from '@/app/[lang]/shape-generator/sketch/SketchConstraintOverlay';

// ─── helpers ──────────────────────────────────────────────────────────────

interface MountOpts {
  constraints?: ReadonlyArray<DisplayConstraint>;
  selectedConstraintId?: string;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  onValueChange?: (id: string, value: number) => void;
  dimensionOffset?: number;
  angleArcRadius?: number;
}

function mount(opts: MountOpts = {}): {
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  onValueChange?: (id: string, value: number) => void;
} {
  const onSelect = opts.onSelect ?? vi.fn();
  const onDelete = opts.onDelete ?? vi.fn();
  const onValueChange = opts.onValueChange;
  render(
    // The overlay returns a <g>; wrap it in a real <svg> so jsdom is happy.
    <svg data-testid="host-svg" width={400} height={400}>
      <SketchConstraintOverlay
        constraints={opts.constraints ?? []}
        selectedConstraintId={opts.selectedConstraintId}
        onSelect={onSelect}
        onDelete={onDelete}
        onValueChange={onValueChange}
        dimensionOffset={opts.dimensionOffset}
        angleArcRadius={opts.angleArcRadius}
      />
    </svg>,
  );
  return { onSelect, onDelete, onValueChange };
}

const dist = (
  id: string,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  value: number,
): DisplayConstraint => ({ kind: 'distance', id, p1, p2, value });

const angle = (
  id: string,
  line1Pts: [{ x: number; y: number }, { x: number; y: number }],
  line2Pts: [{ x: number; y: number }, { x: number; y: number }],
  value: number,
): DisplayConstraint => ({ kind: 'angle', id, line1Pts, line2Pts, value });

const badge = (
  id: string,
  kind:
    | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular'
    | 'coincident' | 'tangent' | 'equal_length' | 'equal_radius' | 'fix',
  entities: Array<{ x: number; y: number }>,
): DisplayConstraint => ({ kind, id, entities });

// ─── tests ────────────────────────────────────────────────────────────────

describe('SketchConstraintOverlay', () => {
  it('renders empty group when constraints is empty', () => {
    mount({ constraints: [] });
    const root = screen.getByTestId('solver-constraint-overlay');
    expect(root).toBeInTheDocument();
    expect(root.getAttribute('data-count')).toBe('0');
    // No constraint subgroups present.
    expect(root.children.length).toBe(0);
  });

  it('renders 1 distance constraint with dim-line + arrows + label', () => {
    mount({
      constraints: [dist('d1', { x: 100, y: 100 }, { x: 200, y: 100 }, 100)],
    });
    expect(screen.getByTestId('solver-constraint-overlay-d1')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-d1-arrow-a')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-d1-arrow-b')).toBeInTheDocument();
    const label = screen.getByTestId('solver-constraint-overlay-d1-label');
    expect(label).toBeInTheDocument();
    expect(label.textContent).toBe('100');
  });

  it('renders distance label decimal when not whole', () => {
    mount({
      constraints: [dist('d2', { x: 0, y: 0 }, { x: 12.5, y: 0 }, 12.5)],
    });
    expect(screen.getByTestId('solver-constraint-overlay-d2-label').textContent).toBe('12.5');
  });

  it('positions distance label near segment midpoint + perpendicular offset', () => {
    // Horizontal segment from (0,0) → (100,0). Midpoint = (50,0).
    // Perp CCW of (1,0) → (0,1), so label is below in SVG coords
    // (y increases downward). With offset=20 + label nudge 6 → y ≈ 26.
    mount({
      constraints: [dist('d3', { x: 0, y: 0 }, { x: 100, y: 0 }, 100)],
      dimensionOffset: 20,
    });
    const label = screen.getByTestId('solver-constraint-overlay-d3-label');
    const x = parseFloat(label.getAttribute('x') ?? '');
    const y = parseFloat(label.getAttribute('y') ?? '');
    expect(x).toBeCloseTo(50, 0);
    // Allow some slack on the perpendicular offset (offset + label-nudge).
    expect(y).toBeGreaterThanOrEqual(20);
    expect(y).toBeLessThanOrEqual(40);
  });

  it('renders 1 angle constraint with arc + degree label', () => {
    // Horizontal line + vertical line meeting at origin = 90°.
    mount({
      constraints: [
        angle(
          'a1',
          [{ x: 0, y: 0 }, { x: 100, y: 0 }],
          [{ x: 0, y: 0 }, { x: 0, y: 100 }],
          Math.PI / 2,
        ),
      ],
    });
    expect(screen.getByTestId('solver-constraint-overlay-a1')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-a1-arc')).toBeInTheDocument();
    const label = screen.getByTestId('solver-constraint-overlay-a1-label');
    expect(label.textContent).toBe('90°');
  });

  it('renders angle label with 1 decimal when not whole', () => {
    mount({
      constraints: [
        angle(
          'a2',
          [{ x: 0, y: 0 }, { x: 100, y: 0 }],
          [{ x: 0, y: 0 }, { x: 100, y: 100 }],
          (45.5 * Math.PI) / 180,
        ),
      ],
    });
    expect(screen.getByTestId('solver-constraint-overlay-a2-label').textContent).toBe('45.5°');
  });

  it('renders horizontal badge with "H"', () => {
    mount({
      constraints: [
        badge('h1', 'horizontal', [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
      ],
    });
    const b = screen.getByTestId('solver-constraint-overlay-h1-badge');
    expect(b.textContent).toBe('H');
  });

  it('renders vertical badge with "V"', () => {
    mount({
      constraints: [
        badge('v1', 'vertical', [{ x: 0, y: 0 }, { x: 0, y: 100 }]),
      ],
    });
    expect(screen.getByTestId('solver-constraint-overlay-v1-badge').textContent).toBe('V');
  });

  it('renders parallel badge with parallel glyph', () => {
    mount({
      constraints: [
        badge('p1', 'parallel', [{ x: 0, y: 0 }, { x: 50, y: 0 }]),
      ],
    });
    expect(screen.getByTestId('solver-constraint-overlay-p1-badge').textContent).toBe('∥');
  });

  it('renders perpendicular badge with perp glyph', () => {
    mount({
      constraints: [
        badge('pp1', 'perpendicular', [{ x: 0, y: 0 }, { x: 50, y: 0 }]),
      ],
    });
    expect(screen.getByTestId('solver-constraint-overlay-pp1-badge').textContent).toBe('⟂');
  });

  it('renders coincident badge with dot glyph', () => {
    mount({
      constraints: [badge('co1', 'coincident', [{ x: 10, y: 20 }])],
    });
    expect(screen.getByTestId('solver-constraint-overlay-co1-badge').textContent).toBe('●');
  });

  it('renders multiple constraints together', () => {
    mount({
      constraints: [
        dist('d1', { x: 0, y: 0 }, { x: 100, y: 0 }, 100),
        badge('h1', 'horizontal', [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
        angle('a1', [{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 100 }], Math.PI / 2),
      ],
    });
    expect(screen.getByTestId('solver-constraint-overlay').getAttribute('data-count')).toBe('3');
    expect(screen.getByTestId('solver-constraint-overlay-d1')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-h1')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-a1')).toBeInTheDocument();
  });

  it('selected constraint renders in blue (selection highlight)', () => {
    mount({
      constraints: [dist('d1', { x: 0, y: 0 }, { x: 100, y: 0 }, 100)],
      selectedConstraintId: 'd1',
    });
    const g = screen.getByTestId('solver-constraint-overlay-d1');
    expect(g.getAttribute('data-selected')).toBe('true');
    // Selection color is propagated to the dim-line stroke. Find the dashed
    // dim-line as the line element inside this constraint group whose stroke
    // dasharray is set.
    const lines = g.querySelectorAll('line');
    let dimLine: SVGLineElement | null = null;
    lines.forEach((ln) => {
      if (ln.getAttribute('stroke-dasharray')) dimLine = ln as SVGLineElement;
    });
    expect(dimLine).not.toBeNull();
    expect((dimLine as unknown as SVGLineElement).getAttribute('stroke')).toBe('#2563eb');
  });

  it('non-selected constraint renders in grey (base color)', () => {
    mount({
      constraints: [dist('d1', { x: 0, y: 0 }, { x: 100, y: 0 }, 100)],
    });
    const g = screen.getByTestId('solver-constraint-overlay-d1');
    expect(g.getAttribute('data-selected')).toBe('false');
    const lines = g.querySelectorAll('line');
    let dimLine: SVGLineElement | null = null;
    lines.forEach((ln) => {
      if (ln.getAttribute('stroke-dasharray')) dimLine = ln as SVGLineElement;
    });
    expect((dimLine as unknown as SVGLineElement).getAttribute('stroke')).toBe('#6b7280');
  });

  it('clicking a constraint fires onSelect with its id', () => {
    const onSelect = vi.fn();
    mount({
      constraints: [dist('d1', { x: 0, y: 0 }, { x: 100, y: 0 }, 100)],
      onSelect,
    });
    fireEvent.click(screen.getByTestId('solver-constraint-overlay-d1'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('d1');
  });

  it('delete affordance only appears when constraint is selected', () => {
    mount({
      constraints: [dist('d1', { x: 0, y: 0 }, { x: 100, y: 0 }, 100)],
    });
    expect(screen.queryByTestId('solver-constraint-overlay-d1-delete')).toBeNull();
  });

  it('selected + delete click fires onDelete and stops propagation (onSelect not re-fired)', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    mount({
      constraints: [dist('d1', { x: 0, y: 0 }, { x: 100, y: 0 }, 100)],
      selectedConstraintId: 'd1',
      onSelect,
      onDelete,
    });
    const del = screen.getByTestId('solver-constraint-overlay-d1-delete');
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('d1');
    // onSelect should NOT have fired from the bubbled click (we stopPropagation).
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('degenerate distance (p1 == p2) still renders label without crashing', () => {
    mount({
      constraints: [dist('d-zero', { x: 50, y: 50 }, { x: 50, y: 50 }, 0)],
    });
    expect(screen.getByTestId('solver-constraint-overlay-d-zero')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-d-zero-label').textContent).toBe('0');
  });

  it('angle with parallel lines (no intersection) still emits label', () => {
    // Two horizontal lines that never meet — falls back to midpoint anchor.
    mount({
      constraints: [
        angle(
          'a-par',
          [{ x: 0, y: 0 }, { x: 100, y: 0 }],
          [{ x: 0, y: 50 }, { x: 100, y: 50 }],
          0,
        ),
      ],
    });
    // Label is always emitted; arc emission may be skipped only when
    // direction degenerates, which doesn't happen here (parallel lines
    // still have a valid "farther endpoint" direction from the midpoint
    // anchor). The label must exist.
    expect(screen.getByTestId('solver-constraint-overlay-a-par-label')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-a-par-label').textContent).toBe('0°');
  });

  it('per-constraint data-constraint-kind attribute is set correctly', () => {
    mount({
      constraints: [
        dist('d1', { x: 0, y: 0 }, { x: 100, y: 0 }, 100),
        badge('h1', 'horizontal', [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
        angle('a1', [{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 100 }], Math.PI / 2),
        badge('eq1', 'equal_radius', [{ x: 50, y: 50 }]),
      ],
    });
    expect(screen.getByTestId('solver-constraint-overlay-d1').getAttribute('data-constraint-kind')).toBe('distance');
    expect(screen.getByTestId('solver-constraint-overlay-h1').getAttribute('data-constraint-kind')).toBe('horizontal');
    expect(screen.getByTestId('solver-constraint-overlay-a1').getAttribute('data-constraint-kind')).toBe('angle');
    expect(screen.getByTestId('solver-constraint-overlay-eq1').getAttribute('data-constraint-kind')).toBe('equal_radius');
  });

  // ─── Phase 1.B inline edit ─────────────────────────────────────────────

  describe('inline value edit (double-click)', () => {
    it('distance: double-clicking the label swaps to a number input', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [dist('d-edit', { x: 0, y: 0 }, { x: 100, y: 0 }, 50)],
        onValueChange,
      });
      // Pre: label visible, no input yet.
      expect(screen.getByTestId('solver-constraint-overlay-d-edit-label')).toBeInTheDocument();
      expect(screen.queryByTestId('solver-constraint-overlay-d-edit-edit-input')).toBeNull();
      // Trigger edit.
      const label = screen.getByTestId('solver-constraint-overlay-d-edit-label');
      fireEvent.doubleClick(label);
      // Post: input present, seeded with current value.
      const input = screen.getByTestId('solver-constraint-overlay-d-edit-edit-input') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('50');
      expect(input.type).toBe('number');
      // onValueChange not fired yet (no commit).
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('distance: entering a new value + Enter fires onValueChange and exits edit', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [dist('d-enter', { x: 0, y: 0 }, { x: 100, y: 0 }, 50)],
        onValueChange,
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-d-enter-label'));
      const input = screen.getByTestId('solver-constraint-overlay-d-enter-edit-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '75' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith('d-enter', 75);
      // Input gone, label back.
      expect(screen.queryByTestId('solver-constraint-overlay-d-enter-edit-input')).toBeNull();
    });

    it('distance: Esc cancels the edit without firing onValueChange', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [dist('d-esc', { x: 0, y: 0 }, { x: 100, y: 0 }, 50)],
        onValueChange,
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-d-esc-label'));
      const input = screen.getByTestId('solver-constraint-overlay-d-esc-edit-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '999' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId('solver-constraint-overlay-d-esc-edit-input')).toBeNull();
    });

    it('angle: double-clicking the label swaps to a number input seeded in degrees', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [
          angle(
            'a-edit',
            [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            [{ x: 0, y: 0 }, { x: 0, y: 100 }],
            Math.PI / 2,
          ),
        ],
        onValueChange,
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-a-edit-label'));
      const input = screen.getByTestId('solver-constraint-overlay-a-edit-edit-input') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      // 90° (π/2 rad) → input shows "90".
      expect(Number(input.value)).toBeCloseTo(90, 5);
    });

    it('angle: entering degrees + Enter fires onValueChange with degree value', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [
          angle(
            'a-commit',
            [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            [{ x: 0, y: 0 }, { x: 0, y: 100 }],
            Math.PI / 2,
          ),
        ],
        onValueChange,
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-a-commit-label'));
      const input = screen.getByTestId('solver-constraint-overlay-a-commit-edit-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '45' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith('a-commit', 45);
    });

    it('horizontal: double-clicking the badge does NOT swap to an input (no editable value)', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [badge('h-edit', 'horizontal', [{ x: 0, y: 0 }, { x: 100, y: 0 }])],
        onValueChange,
      });
      const badgeEl = screen.getByTestId('solver-constraint-overlay-h-edit-badge');
      fireEvent.doubleClick(badgeEl);
      expect(screen.queryByTestId('solver-constraint-overlay-h-edit-edit-input')).toBeNull();
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('vertical: double-click on badge is a no-op', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [badge('v-edit', 'vertical', [{ x: 0, y: 0 }, { x: 0, y: 100 }])],
        onValueChange,
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-v-edit-badge'));
      expect(screen.queryByTestId('solver-constraint-overlay-v-edit-edit-input')).toBeNull();
    });

    it('inline edit is disabled when onValueChange is not provided', () => {
      mount({
        // No onValueChange — back-compat path.
        constraints: [dist('d-noop', { x: 0, y: 0 }, { x: 100, y: 0 }, 50)],
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-d-noop-label'));
      // No input swapped in.
      expect(screen.queryByTestId('solver-constraint-overlay-d-noop-edit-input')).toBeNull();
    });

    it('Enter with NaN input cancels (does not call onValueChange)', () => {
      const onValueChange = vi.fn();
      mount({
        constraints: [dist('d-nan', { x: 0, y: 0 }, { x: 100, y: 0 }, 50)],
        onValueChange,
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-d-nan-label'));
      const input = screen.getByTestId('solver-constraint-overlay-d-nan-edit-input') as HTMLInputElement;
      // Browser <input type=number> coerces "abc" → empty string. Set the
      // underlying value via the native HTMLInputElement setter so jsdom
      // doesn't strip it on a "change" event.
      Object.defineProperty(input, 'value', { writable: true, value: 'not-a-number' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('double-click on label does not bubble into the group onSelect handler', () => {
      const onSelect = vi.fn();
      const onValueChange = vi.fn();
      mount({
        constraints: [dist('d-bubble', { x: 0, y: 0 }, { x: 100, y: 0 }, 50)],
        onSelect,
        onValueChange,
      });
      fireEvent.doubleClick(screen.getByTestId('solver-constraint-overlay-d-bubble-label'));
      // onSelect listens to single-clicks; double-click stopPropagation
      // ensures we don't trigger constraint selection while opening the editor.
      expect(onSelect).not.toHaveBeenCalled();
      // Input is mounted.
      expect(screen.getByTestId('solver-constraint-overlay-d-bubble-edit-input')).toBeInTheDocument();
    });
  });

  it('vertical distance: arrows still emit and label is to the side of the segment', () => {
    // Vertical segment from (0,0) → (0,100). Midpoint = (0,50).
    // dir = (0,1), perpCCW = (-1, 0). Offset 20 → label sits at x≈-26.
    mount({
      constraints: [dist('d-v', { x: 0, y: 0 }, { x: 0, y: 100 }, 100)],
      dimensionOffset: 20,
    });
    expect(screen.getByTestId('solver-constraint-overlay-d-v-arrow-a')).toBeInTheDocument();
    expect(screen.getByTestId('solver-constraint-overlay-d-v-arrow-b')).toBeInTheDocument();
    const label = screen.getByTestId('solver-constraint-overlay-d-v-label');
    const x = parseFloat(label.getAttribute('x') ?? '');
    const y = parseFloat(label.getAttribute('y') ?? '');
    // x should be NEGATIVE (perpendicular CCW from +Y is -X).
    expect(x).toBeLessThan(0);
    expect(y).toBeCloseTo(50, 0);
  });
});
