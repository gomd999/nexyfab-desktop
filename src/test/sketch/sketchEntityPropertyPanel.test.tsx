/** @vitest-environment jsdom */
/**
 * SketchEntityPropertyPanel — Phase 1.B sketch UX standalone tests.
 *
 * Covers the 4 entity kinds (point / line / circle / arc), debounced
 * onChange, isFixed toggle, multi-select placeholder, delete button
 * visibility, validation (NaN / negative radius), and 6-lang i18n.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import SketchEntityPropertyPanel, {
  type EntityData,
  type SketchEntityRef,
  type EditorLang,
  type EntityField,
  type EntityFieldValue,
  PROPERTY_DEBOUNCE_MS,
} from '@/app/[lang]/shape-generator/sketch/SketchEntityPropertyPanel';

// ─── helpers ─────────────────────────────────────────────────────────────

const refPoint = (id: string): SketchEntityRef => ({ kind: 'point', id });
const refLine = (id: string): SketchEntityRef => ({ kind: 'line', id });
const refCircle = (id: string): SketchEntityRef => ({ kind: 'circle', id });
const refArc = (id: string): SketchEntityRef => ({ kind: 'arc', id });

const pointEntity = (id: string, overrides: Partial<EntityData> = {}): EntityData => ({
  kind: 'point', id, x: 1, y: 2, isFixed: false, ...overrides,
} as EntityData);

const lineEntity = (id: string): EntityData => ({
  kind: 'line', id, x1: 0, y1: 0, x2: 10, y2: 0, length: 10, angle: 0,
});

const circleEntity = (id: string): EntityData => ({
  kind: 'circle', id, cx: 5, cy: 5, radius: 3,
});

const arcEntity = (id: string): EntityData => ({
  kind: 'arc', id, cx: 0, cy: 0, radius: 5,
  startAngle: 0, endAngle: Math.PI / 2,
});

interface MountOpts {
  lang?: EditorLang;
  selection?: ReadonlyArray<SketchEntityRef>;
  entityData?: ReadonlyArray<EntityData>;
  onChange?: (id: string, field: EntityField, value: EntityFieldValue) => void;
  onDelete?: (id: string) => void;
  debounceMs?: number;
}

function mount(opts: MountOpts = {}) {
  const onChange = opts.onChange ?? vi.fn();
  const props = {
    lang: opts.lang ?? 'en' as EditorLang,
    selection: opts.selection ?? [],
    entityData: opts.entityData ?? [],
    onChange,
    onDelete: opts.onDelete,
    debounceMs: opts.debounceMs,
  };
  const utils = render(<SketchEntityPropertyPanel {...props} />);
  return { onChange, ...utils };
}

// jsdom is required by the env directive above. Each test cleans up via the
// vitest afterEach hook from @testing-library/react v15+, but we call
// cleanup() explicitly to be safe across renders.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─── tests ───────────────────────────────────────────────────────────────

describe('SketchEntityPropertyPanel', () => {
  it('empty selection shows hint message', () => {
    mount();
    expect(screen.getByTestId('solver-entity-property-empty')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-empty').textContent).toMatch(/Select an entity/);
  });

  it('point selection shows x, y and isFixed fields', () => {
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1')],
    });
    expect(screen.getByTestId('solver-entity-property-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-y-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-isFixed-checkbox')).toBeInTheDocument();
    // No multi/empty hints when single entity is shown.
    expect(screen.queryByTestId('solver-entity-property-empty')).toBeNull();
    expect(screen.queryByTestId('solver-entity-property-multi')).toBeNull();
  });

  it('point x change fires onChange with new numeric value after debounce', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1', { x: 1, y: 2 })],
      onChange,
    });
    const input = screen.getByTestId('solver-entity-property-x-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '7.5' } });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 10); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('p1', 'x', 7.5);
  });

  it('line selection shows x1/y1/x2/y2 inputs and read-only length / angle readouts', () => {
    mount({
      selection: [refLine('L1')],
      entityData: [lineEntity('L1')],
    });
    expect(screen.getByTestId('solver-entity-property-x1-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-y1-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-x2-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-y2-input')).toBeInTheDocument();
    const lengthReadout = screen.getByTestId('solver-entity-property-length-readout');
    const angleReadout = screen.getByTestId('solver-entity-property-angle-readout');
    expect(lengthReadout.textContent).toBe('10');
    // 0 rad → 0°
    expect(angleReadout.textContent).toContain('0');
    // Length / angle are spans, not inputs (read-only).
    expect(lengthReadout.tagName).toBe('SPAN');
  });

  it('line x1 change fires onChange after debounce', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refLine('L1')],
      entityData: [lineEntity('L1')],
      onChange,
    });
    fireEvent.change(screen.getByTestId('solver-entity-property-x1-input'), {
      target: { value: '3' },
    });
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 5); });
    expect(onChange).toHaveBeenCalledWith('L1', 'x1', 3);
  });

  it('circle selection shows cx, cy, radius inputs', () => {
    mount({
      selection: [refCircle('C1')],
      entityData: [circleEntity('C1')],
    });
    expect(screen.getByTestId('solver-entity-property-cx-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-cy-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-radius-input')).toBeInTheDocument();
  });

  it('arc selection shows cx, cy, radius, startAngle, endAngle (degrees)', () => {
    mount({
      selection: [refArc('A1')],
      entityData: [arcEntity('A1')],
    });
    expect(screen.getByTestId('solver-entity-property-cx-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-cy-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-entity-property-radius-input')).toBeInTheDocument();
    const start = screen.getByTestId('solver-entity-property-startAngle-input') as HTMLInputElement;
    const end = screen.getByTestId('solver-entity-property-endAngle-input') as HTMLInputElement;
    expect(start).toBeInTheDocument();
    expect(end).toBeInTheDocument();
    // startAngle 0 rad → 0°, endAngle π/2 → 90°
    expect(start.value).toBe('0');
    expect(end.value).toBe('90');
  });

  it('arc startAngle edit converts degrees → radians on onChange', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refArc('A1')],
      entityData: [arcEntity('A1')],
      onChange,
    });
    fireEvent.change(screen.getByTestId('solver-entity-property-startAngle-input'), {
      target: { value: '180' },
    });
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 5); });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [id, field, value] = onChange.mock.calls[0]!;
    expect(id).toBe('A1');
    expect(field).toBe('startAngle');
    expect(value as number).toBeCloseTo(Math.PI, 6);
  });

  it('multi-select (2+ entities) shows the multi placeholder message only', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2')],
      entityData: [pointEntity('p1'), pointEntity('p2')],
    });
    const multi = screen.getByTestId('solver-entity-property-multi');
    expect(multi).toBeInTheDocument();
    expect(multi.textContent).toMatch(/Multiple selection.*2/);
    // No per-field inputs in multi mode.
    expect(screen.queryByTestId('solver-entity-property-x-input')).toBeNull();
    expect(screen.queryByTestId('solver-entity-delete-button')).toBeNull();
  });

  it('delete button fires onDelete with entity id when clicked', () => {
    const onDelete = vi.fn();
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1')],
      onDelete,
    });
    const del = screen.getByTestId('solver-entity-delete-button');
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('delete button is hidden when onDelete is not provided', () => {
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1')],
    });
    expect(screen.queryByTestId('solver-entity-delete-button')).toBeNull();
  });

  it('invalid value (NaN) sets aria-invalid and suppresses onChange', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1')],
      onChange,
    });
    const input = screen.getByTestId('solver-entity-property-x-input') as HTMLInputElement;
    // Empty string is treated as invalid by the field.
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 50); });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('negative radius is rejected (invalid border, no onChange)', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refCircle('C1')],
      entityData: [circleEntity('C1')],
      onChange,
    });
    const input = screen.getByTestId('solver-entity-property-radius-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-2' } });
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 50); });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('zero radius is also rejected (must be > 0)', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refCircle('C1')],
      entityData: [circleEntity('C1')],
      onChange,
    });
    fireEvent.change(screen.getByTestId('solver-entity-property-radius-input'), {
      target: { value: '0' },
    });
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 50); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('debounce collapses rapid edits to a single onChange with the final value', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1')],
      onChange,
    });
    const input = screen.getByTestId('solver-entity-property-x-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(input, { target: { value: '2' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(input, { target: { value: '3' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(input, { target: { value: '42' } });
    // None should have fired yet (each edit < 300ms apart).
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 10); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('p1', 'x', 42);
  });

  it('isFixed checkbox toggle fires onChange immediately (no debounce) with boolean', () => {
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1', { isFixed: false })],
      onChange,
    });
    const cb = screen.getByTestId('solver-entity-property-isFixed-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('p1', 'isFixed', true);
  });

  it('isFixed checkbox toggle off fires onChange(false)', () => {
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1')],
      entityData: [pointEntity('p1', { isFixed: true })],
      onChange,
    });
    const cb = screen.getByTestId('solver-entity-property-isFixed-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith('p1', 'isFixed', false);
  });

  it('empty selection renders hint in Korean (i18n: ko)', () => {
    mount({ lang: 'ko' });
    const empty = screen.getByTestId('solver-entity-property-empty');
    expect(empty.textContent).toMatch(/엔티티를 선택/);
  });

  it('empty selection renders hint in English (i18n: en)', () => {
    mount({ lang: 'en' });
    expect(screen.getByTestId('solver-entity-property-empty').textContent)
      .toMatch(/Select an entity/);
  });

  it('empty selection renders hint in Japanese (i18n: ja)', () => {
    mount({ lang: 'ja' });
    expect(screen.getByTestId('solver-entity-property-empty').textContent)
      .toMatch(/エンティティを選択/);
  });

  it('empty selection renders hint in Chinese (i18n: zh)', () => {
    mount({ lang: 'zh' });
    expect(screen.getByTestId('solver-entity-property-empty').textContent)
      .toMatch(/选择一个实体/);
  });

  it('empty selection renders hint in Spanish (i18n: es)', () => {
    mount({ lang: 'es' });
    expect(screen.getByTestId('solver-entity-property-empty').textContent)
      .toMatch(/Seleccione una entidad/);
  });

  it('empty selection renders hint in Arabic (i18n: ar)', () => {
    mount({ lang: 'ar' });
    expect(screen.getByTestId('solver-entity-property-empty').textContent)
      .toMatch(/اختر كيانًا/);
  });

  it('selection of an entity not in entityData falls back to empty hint', () => {
    mount({
      selection: [refPoint('ghost')],
      entityData: [],
    });
    expect(screen.getByTestId('solver-entity-property-empty')).toBeInTheDocument();
  });
});

// ─── Phase 2 bulk edit tests ─────────────────────────────────────────────

describe('SketchEntityPropertyPanel — Phase 2 bulk edit', () => {
  it('3 points with identical x/y → bulk x/y inputs show the single value', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2'), refPoint('p3')],
      entityData: [
        pointEntity('p1', { x: 5, y: 7 }),
        pointEntity('p2', { x: 5, y: 7 }),
        pointEntity('p3', { x: 5, y: 7 }),
      ],
    });
    const x = screen.getByTestId('solver-entity-bulk-x') as HTMLInputElement;
    const y = screen.getByTestId('solver-entity-bulk-y') as HTMLInputElement;
    expect(x.value).toBe('5');
    expect(y.value).toBe('7');
    // Per-entity single-edit testids must NOT appear in bulk mode.
    expect(screen.queryByTestId('solver-entity-property-x-input')).toBeNull();
  });

  it('3 points with differing x → bulk x shows empty value + Multiple placeholder', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2'), refPoint('p3')],
      entityData: [
        pointEntity('p1', { x: 1, y: 7 }),
        pointEntity('p2', { x: 2, y: 7 }),
        pointEntity('p3', { x: 3, y: 7 }),
      ],
    });
    const x = screen.getByTestId('solver-entity-bulk-x') as HTMLInputElement;
    const y = screen.getByTestId('solver-entity-bulk-y') as HTMLInputElement;
    expect(x.value).toBe('');
    expect(x.placeholder).toMatch(/Multiple/);
    // y is still common so it stays populated.
    expect(y.value).toBe('7');
  });

  it('editing bulk x fires onChange once per selected point with the same value', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1'), refPoint('p2'), refPoint('p3')],
      entityData: [
        pointEntity('p1', { x: 0 }),
        pointEntity('p2', { x: 0 }),
        pointEntity('p3', { x: 0 }),
      ],
      onChange,
    });
    const x = screen.getByTestId('solver-entity-bulk-x') as HTMLInputElement;
    fireEvent.change(x, { target: { value: '9' } });
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 5); });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenCalledWith('p1', 'x', 9);
    expect(onChange).toHaveBeenCalledWith('p2', 'x', 9);
    expect(onChange).toHaveBeenCalledWith('p3', 'x', 9);
  });

  it('editing bulk x when values are mixed still propagates to all selected', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1'), refPoint('p2')],
      entityData: [
        pointEntity('p1', { x: 1 }),
        pointEntity('p2', { x: 99 }),
      ],
      onChange,
    });
    fireEvent.change(screen.getByTestId('solver-entity-bulk-x'), {
      target: { value: '4' },
    });
    await act(async () => { vi.advanceTimersByTime(PROPERTY_DEBOUNCE_MS + 5); });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith('p1', 'x', 4);
    expect(onChange).toHaveBeenCalledWith('p2', 'x', 4);
  });

  it('isFixed mixed (some true, some false) → checkbox is indeterminate and unchecked', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2'), refPoint('p3')],
      entityData: [
        pointEntity('p1', { isFixed: true }),
        pointEntity('p2', { isFixed: false }),
        pointEntity('p3', { isFixed: true }),
      ],
    });
    const cb = screen.getByTestId('solver-entity-bulk-isFixed') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    expect(cb.indeterminate).toBe(true);
  });

  it('isFixed all true → checkbox is checked and not indeterminate', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2')],
      entityData: [
        pointEntity('p1', { isFixed: true }),
        pointEntity('p2', { isFixed: true }),
      ],
    });
    const cb = screen.getByTestId('solver-entity-bulk-isFixed') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    expect(cb.indeterminate).toBe(false);
  });

  it('isFixed all false → checkbox is unchecked and not indeterminate', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2')],
      entityData: [
        pointEntity('p1', { isFixed: false }),
        pointEntity('p2', { isFixed: false }),
      ],
    });
    const cb = screen.getByTestId('solver-entity-bulk-isFixed') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    expect(cb.indeterminate).toBe(false);
  });

  it('clicking isFixed checkbox in mixed state normalises every point to true', () => {
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1'), refPoint('p2'), refPoint('p3')],
      entityData: [
        pointEntity('p1', { isFixed: true }),
        pointEntity('p2', { isFixed: false }),
        pointEntity('p3', { isFixed: true }),
      ],
      onChange,
    });
    fireEvent.click(screen.getByTestId('solver-entity-bulk-isFixed'));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenCalledWith('p1', 'isFixed', true);
    expect(onChange).toHaveBeenCalledWith('p2', 'isFixed', true);
    expect(onChange).toHaveBeenCalledWith('p3', 'isFixed', true);
  });

  it('clicking isFixed when all-true toggles to false for all points', () => {
    const onChange = vi.fn();
    mount({
      selection: [refPoint('p1'), refPoint('p2')],
      entityData: [
        pointEntity('p1', { isFixed: true }),
        pointEntity('p2', { isFixed: true }),
      ],
      onChange,
    });
    fireEvent.click(screen.getByTestId('solver-entity-bulk-isFixed'));
    expect(onChange).toHaveBeenCalledWith('p1', 'isFixed', false);
    expect(onChange).toHaveBeenCalledWith('p2', 'isFixed', false);
  });

  it('mixed kind selection (point + line) shows the mixed-selection message', () => {
    mount({
      selection: [refPoint('p1'), refLine('L1')],
      entityData: [pointEntity('p1'), lineEntity('L1')],
    });
    const mixed = screen.getByTestId('solver-entity-property-mixed');
    expect(mixed).toBeInTheDocument();
    expect(mixed.textContent).toMatch(/Mixed selection/);
    // No bulk inputs in mixed mode.
    expect(screen.queryByTestId('solver-entity-bulk-x')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-isFixed')).toBeNull();
  });

  it('3 lines bulk selection shows no editable common fields (Phase 2 limit)', () => {
    mount({
      selection: [refLine('L1'), refLine('L2'), refLine('L3')],
      entityData: [lineEntity('L1'), lineEntity('L2'), lineEntity('L3')],
    });
    // Phase 2 deliberately exposes no bulk fields for lines / circles / arcs.
    expect(screen.queryByTestId('solver-entity-bulk-x')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-y')).toBeNull();
    expect(screen.queryByTestId('solver-entity-bulk-isFixed')).toBeNull();
    // Per-entity (single-edit) inputs also must not leak through.
    expect(screen.queryByTestId('solver-entity-property-x1-input')).toBeNull();
    expect(screen.queryByTestId('solver-entity-property-length-readout')).toBeNull();
    // Wrapper testid is still present.
    expect(screen.getByTestId('solver-entity-property-multi')).toBeInTheDocument();
  });

  it('bulk delete button fires onDelete for each selected id after confirm', () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      mount({
        selection: [refPoint('p1'), refPoint('p2'), refPoint('p3')],
        entityData: [pointEntity('p1'), pointEntity('p2'), pointEntity('p3')],
        onDelete,
      });
      fireEvent.click(screen.getByTestId('solver-entity-bulk-delete'));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledTimes(3);
      expect(onDelete).toHaveBeenCalledWith('p1');
      expect(onDelete).toHaveBeenCalledWith('p2');
      expect(onDelete).toHaveBeenCalledWith('p3');
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('bulk delete cancelled (confirm returns false) does not fire onDelete', () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      mount({
        selection: [refPoint('p1'), refPoint('p2')],
        entityData: [pointEntity('p1'), pointEntity('p2')],
        onDelete,
      });
      fireEvent.click(screen.getByTestId('solver-entity-bulk-delete'));
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('bulk delete button is hidden when onDelete is not provided', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2')],
      entityData: [pointEntity('p1'), pointEntity('p2')],
    });
    expect(screen.queryByTestId('solver-entity-bulk-delete')).toBeNull();
  });

  it('mixed kind selection still exposes bulk delete (multi-delete is kind-agnostic)', () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      mount({
        selection: [refPoint('p1'), refLine('L1')],
        entityData: [pointEntity('p1'), lineEntity('L1')],
        onDelete,
      });
      fireEvent.click(screen.getByTestId('solver-entity-bulk-delete'));
      expect(onDelete).toHaveBeenCalledTimes(2);
      expect(onDelete).toHaveBeenCalledWith('p1');
      expect(onDelete).toHaveBeenCalledWith('L1');
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('mixed selection message is localised (ko)', () => {
    mount({
      lang: 'ko',
      selection: [refPoint('p1'), refLine('L1')],
      entityData: [pointEntity('p1'), lineEntity('L1')],
    });
    expect(screen.getByTestId('solver-entity-property-mixed').textContent)
      .toMatch(/혼합 선택/);
  });

  it('floating-point near-equality treats values within ~1e-9 as the same', () => {
    mount({
      selection: [refPoint('p1'), refPoint('p2')],
      entityData: [
        pointEntity('p1', { x: 1.0 }),
        // Differs by ~1e-12 — solver round-off, should still display "same".
        pointEntity('p2', { x: 1.0 + 1e-12 }),
      ],
    });
    const x = screen.getByTestId('solver-entity-bulk-x') as HTMLInputElement;
    expect(x.value).toBe('1');
    expect(x.placeholder).toBe('');
  });
});
