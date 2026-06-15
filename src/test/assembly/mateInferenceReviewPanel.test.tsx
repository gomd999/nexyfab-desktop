/** @vitest-environment jsdom */
/**
 * MateInferenceReviewPanel — Phase 5.2.3 advanced review surface tests.
 *
 * Exercises the standalone table-shaped review panel for the STEP-import
 * mate inference pipeline. Distinct from `suggestedMatesPanel.test.tsx`
 * which covers the lightweight list view — this file focuses on the
 * advanced features the table view adds:
 *   - per-row confidence bar
 *   - threshold slider + bulk "accept above threshold"
 *   - column sorting (confidence / kind / partA)
 *   - kind filter checkboxes
 *   - reason column with placeholder fallback
 *
 * 6-lang i18n is spot-checked (one assertion per locale + Arabic RTL).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MateInferenceReviewPanel, {
  DEFAULT_CONFIDENCE_THRESHOLD,
  type MateInferenceReviewPanelProps,
} from '@/app/[lang]/shape-generator/assembly/MateInferenceReviewPanel';
import type {
  Mate,
  CoincidentMate,
  ConcentricMate,
  ParallelMate,
} from '@/lib/assembly/mate';

// ─── fixtures ─────────────────────────────────────────────────────────────

function makeConcentric(id: string, a = 'partA', b = 'partB'): ConcentricMate {
  return {
    id,
    kind: 'concentric',
    a: { partId: a, refId: 'axis_1', refKind: 'axis' },
    b: { partId: b, refId: 'axis_2', refKind: 'axis' },
  };
}

function makeCoincident(id: string, a = 'partA', b = 'partB'): CoincidentMate {
  return {
    id,
    kind: 'coincident',
    a: { partId: a, refId: 'face_10', refKind: 'face' },
    b: { partId: b, refId: 'face_20', refKind: 'face' },
  };
}

function makeParallel(id: string, a = 'partA', b = 'partB'): ParallelMate {
  return {
    id,
    kind: 'parallel',
    a: { partId: a, refId: 'axis_3', refKind: 'axis' },
    b: { partId: b, refId: 'axis_4', refKind: 'axis' },
  };
}

function mount(
  overrides: Partial<MateInferenceReviewPanelProps> = {},
): {
  onAccept: MateInferenceReviewPanelProps['onAccept'];
  onReject: MateInferenceReviewPanelProps['onReject'];
  onAcceptAllAboveThreshold?: MateInferenceReviewPanelProps['onAcceptAllAboveThreshold'];
} {
  const onAccept: MateInferenceReviewPanelProps['onAccept'] =
    overrides.onAccept ?? vi.fn<(id: string) => void>();
  const onReject: MateInferenceReviewPanelProps['onReject'] =
    overrides.onReject ?? vi.fn<(id: string) => void>();
  const props: MateInferenceReviewPanelProps = {
    lang: overrides.lang ?? 'en',
    suggestions: overrides.suggestions ?? [],
    onAccept,
    onReject,
    confidence: overrides.confidence,
    reasons: overrides.reasons,
    onAcceptAllAboveThreshold: overrides.onAcceptAllAboveThreshold,
    partNameById: overrides.partNameById,
  };
  render(<MateInferenceReviewPanel {...props} />);
  return {
    onAccept,
    onReject,
    onAcceptAllAboveThreshold: overrides.onAcceptAllAboveThreshold,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('MateInferenceReviewPanel', () => {
  it('empty suggestions → renders empty placeholder, no table or controls', () => {
    mount({ suggestions: [] });
    expect(
      screen.getByTestId('mate-inference-review-empty'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mate-inference-review-table')).toBeNull();
    expect(
      screen.queryByTestId('mate-inference-review-threshold-slider'),
    ).toBeNull();
    expect(
      screen.queryByTestId('mate-inference-review-accept-above-threshold'),
    ).toBeNull();
  });

  it('3 suggestions → table renders with 3 rows', () => {
    const mates: Mate[] = [
      makeConcentric('m1'),
      makeCoincident('m2'),
      makeParallel('m3'),
    ];
    mount({ suggestions: mates });
    expect(
      screen.getByTestId('mate-inference-review-table'),
    ).toBeInTheDocument();
    for (const m of mates) {
      expect(
        screen.getByTestId(`mate-inference-review-row-${m.id}`),
      ).toBeInTheDocument();
    }
    // Header count.
    expect(
      screen.getByTestId('mate-inference-review-panel').textContent,
    ).toContain('(3)');
  });

  it('confidence bar renders with width % matching the score', () => {
    const m = makeConcentric('m1');
    mount({ suggestions: [m], confidence: { m1: 0.75 } });
    const bar = screen.getByTestId(`mate-inference-review-row-${m.id}-confidence`);
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute('data-confidence')).toBe('0.75');
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
    // Cell text contains the percentage label so it reads as "75%".
    expect(bar.textContent).toContain('75%');
  });

  it('missing confidence score → em-dash placeholder, no progressbar', () => {
    const m = makeConcentric('m1');
    mount({ suggestions: [m], confidence: {} });
    const cell = screen.getByTestId(
      `mate-inference-review-row-${m.id}-confidence`,
    );
    expect(cell.textContent).toContain('—');
    expect(cell.getAttribute('role')).not.toBe('progressbar');
  });

  it('threshold slider default = 0.5', () => {
    mount({ suggestions: [makeConcentric('m1')] });
    const slider = screen.getByTestId(
      'mate-inference-review-threshold-slider',
    ) as HTMLInputElement;
    expect(slider.value).toBe(String(DEFAULT_CONFIDENCE_THRESHOLD));
    const label = screen.getByTestId(
      'mate-inference-review-threshold-value',
    );
    expect(label.textContent).toBe('0.50');
  });

  it('threshold slider change → low-confidence rows dimmed via data attribute', () => {
    const m1 = makeConcentric('m1');
    const m2 = makeCoincident('m2');
    mount({
      suggestions: [m1, m2],
      confidence: { m1: 0.9, m2: 0.2 },
    });
    const slider = screen.getByTestId(
      'mate-inference-review-threshold-slider',
    ) as HTMLInputElement;
    // Move threshold to 0.5 (default) — m2 is below.
    fireEvent.change(slider, { target: { value: '0.5' } });
    const row2 = screen.getByTestId(`mate-inference-review-row-${m2.id}`);
    expect(row2.getAttribute('data-below-threshold')).toBe('true');
    const row1 = screen.getByTestId(`mate-inference-review-row-${m1.id}`);
    expect(row1.getAttribute('data-below-threshold')).toBe('false');
  });

  it('"Accept all above threshold" (no override) → onAccept fires for qualifying ids', () => {
    const onAccept = vi.fn<(id: string) => void>();
    const m1 = makeConcentric('m1');
    const m2 = makeCoincident('m2');
    const m3 = makeParallel('m3');
    mount({
      suggestions: [m1, m2, m3],
      confidence: { m1: 0.9, m2: 0.2, m3: 0.6 },
      onAccept,
    });
    fireEvent.click(
      screen.getByTestId('mate-inference-review-accept-above-threshold'),
    );
    // default threshold = 0.5 → m1 (0.9) and m3 (0.6) qualify
    expect(onAccept).toHaveBeenCalledTimes(2);
    const calledIds = onAccept.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual(['m1', 'm3']);
  });

  it('"Accept all above threshold" with override → single callback with threshold value', () => {
    const onAccept = vi.fn<(id: string) => void>();
    const onAcceptAllAboveThreshold = vi.fn<(t: number) => void>();
    mount({
      suggestions: [makeConcentric('m1')],
      confidence: { m1: 0.9 },
      onAccept,
      onAcceptAllAboveThreshold,
    });
    fireEvent.click(
      screen.getByTestId('mate-inference-review-accept-above-threshold'),
    );
    expect(onAcceptAllAboveThreshold).toHaveBeenCalledTimes(1);
    expect(onAcceptAllAboveThreshold.mock.calls[0]![0]).toBeCloseTo(
      DEFAULT_CONFIDENCE_THRESHOLD,
    );
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('missing confidence treated as 1 (passes default threshold)', () => {
    const onAccept = vi.fn<(id: string) => void>();
    const m1 = makeConcentric('m1');
    // No confidence map at all.
    mount({ suggestions: [m1], onAccept });
    fireEvent.click(
      screen.getByTestId('mate-inference-review-accept-above-threshold'),
    );
    expect(onAccept).toHaveBeenCalledWith('m1');
  });

  it('accept button → onAccept(id) with mate id (string, not full mate)', () => {
    const onAccept = vi.fn<(id: string) => void>();
    const m = makeConcentric('m1');
    mount({ suggestions: [m], onAccept });
    fireEvent.click(
      screen.getByTestId(`mate-inference-review-row-${m.id}-accept`),
    );
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]![0]).toBe('m1');
  });

  it('reject button → onReject(id)', () => {
    const onReject = vi.fn<(id: string) => void>();
    const m = makeConcentric('m1');
    mount({ suggestions: [m], onReject });
    fireEvent.click(
      screen.getByTestId(`mate-inference-review-row-${m.id}-reject`),
    );
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject.mock.calls[0]![0]).toBe('m1');
  });

  it('sort = confidence (default) → highest score first', () => {
    const mates: Mate[] = [
      makeConcentric('low'),
      makeCoincident('high'),
      makeParallel('mid'),
    ];
    mount({
      suggestions: mates,
      confidence: { low: 0.1, high: 0.9, mid: 0.5 },
    });
    const tbody = screen
      .getByTestId('mate-inference-review-table')
      .querySelector('tbody')!;
    const rows = tbody.querySelectorAll('tr');
    expect(rows[0]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-high',
    );
    expect(rows[1]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-mid',
    );
    expect(rows[2]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-low',
    );
  });

  it('sort = kind → coincident before concentric before parallel (alphabetical)', () => {
    const mates: Mate[] = [
      makeParallel('p1'),
      makeCoincident('c1'),
      makeConcentric('n1'),
    ];
    mount({ suggestions: mates });
    fireEvent.change(screen.getByTestId('mate-inference-review-sort-select'), {
      target: { value: 'kind' },
    });
    const rows = screen
      .getByTestId('mate-inference-review-table')
      .querySelectorAll('tbody tr');
    expect(rows[0]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-c1',
    );
    expect(rows[1]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-n1',
    );
    expect(rows[2]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-p1',
    );
  });

  it('sort = partA → alphabetical by partA display name (uses partNameById)', () => {
    const mates: Mate[] = [
      makeConcentric('m1', 'pZ'),
      makeConcentric('m2', 'pA'),
      makeConcentric('m3', 'pM'),
    ];
    mount({
      suggestions: mates,
      partNameById: (id) =>
        ({ pZ: 'Zeta', pA: 'Alpha', pM: 'Mu' }[id] ?? id),
    });
    fireEvent.change(screen.getByTestId('mate-inference-review-sort-select'), {
      target: { value: 'partA' },
    });
    const rows = screen
      .getByTestId('mate-inference-review-table')
      .querySelectorAll('tbody tr');
    expect(rows[0]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-m2', // Alpha
    );
    expect(rows[1]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-m3', // Mu
    );
    expect(rows[2]!.getAttribute('data-testid')).toBe(
      'mate-inference-review-row-m1', // Zeta
    );
  });

  it('kind filter → unchecking concentric hides those rows but keeps others', () => {
    const mates: Mate[] = [
      makeConcentric('mc1'),
      makeConcentric('mc2'),
      makeCoincident('mco'),
    ];
    mount({ suggestions: mates });
    const concentricBox = screen.getByTestId(
      'mate-inference-review-kind-filter-concentric',
    );
    fireEvent.click(concentricBox);
    expect(
      screen.queryByTestId('mate-inference-review-row-mc1'),
    ).toBeNull();
    expect(
      screen.queryByTestId('mate-inference-review-row-mc2'),
    ).toBeNull();
    expect(
      screen.getByTestId('mate-inference-review-row-mco'),
    ).toBeInTheDocument();
  });

  it('kind filter checkboxes only appear for kinds present in the batch', () => {
    const mates: Mate[] = [makeConcentric('m1'), makeCoincident('m2')];
    mount({ suggestions: mates });
    // Both present → both checkboxes appear
    expect(
      screen.getByTestId('mate-inference-review-kind-filter-concentric'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mate-inference-review-kind-filter-coincident'),
    ).toBeInTheDocument();
    // Parallel is NOT in the batch → no checkbox for it.
    expect(
      screen.queryByTestId('mate-inference-review-kind-filter-parallel'),
    ).toBeNull();
  });

  it('reasons prop populates the reason column', () => {
    const m = makeConcentric('m1');
    mount({
      suggestions: [m],
      reasons: { m1: 'axes parallel within 0.5°, gap 0.03mm' },
    });
    const reasonCell = screen.getByTestId(
      `mate-inference-review-row-${m.id}-reason`,
    );
    expect(reasonCell.textContent).toContain(
      'axes parallel within 0.5°, gap 0.03mm',
    );
  });

  it('missing reason → italic "No reason provided" placeholder (en)', () => {
    const m = makeConcentric('m1');
    mount({ suggestions: [m] });
    const reasonCell = screen.getByTestId(
      `mate-inference-review-row-${m.id}-reason`,
    );
    expect(reasonCell.textContent).toContain('No reason provided');
  });

  it('part name lookup populates the Parts column', () => {
    const m = makeConcentric('m1', 'part_001', 'part_002');
    mount({
      suggestions: [m],
      partNameById: (id) =>
        ({ part_001: 'Bracket', part_002: 'Pin' }[id] ?? id),
    });
    const row = screen.getByTestId(`mate-inference-review-row-${m.id}`);
    expect(row.textContent).toContain('Bracket');
    expect(row.textContent).toContain('Pin');
  });

  it('i18n ko → header "메이트 추론 검토"', () => {
    mount({ suggestions: [makeConcentric('m1')], lang: 'ko' });
    expect(
      screen.getByTestId('mate-inference-review-panel').textContent,
    ).toContain('메이트 추론 검토');
  });

  it('i18n ja → header "合致推論レビュー"', () => {
    cleanup();
    mount({ suggestions: [makeConcentric('m1')], lang: 'ja' });
    expect(
      screen.getByTestId('mate-inference-review-panel').textContent,
    ).toContain('合致推論レビュー');
  });

  it('i18n zh → header "配合推断审阅"', () => {
    cleanup();
    mount({ suggestions: [makeConcentric('m1')], lang: 'zh' });
    expect(
      screen.getByTestId('mate-inference-review-panel').textContent,
    ).toContain('配合推断审阅');
  });

  it('i18n es → header "Revisión de inferencia de restricciones"', () => {
    cleanup();
    mount({ suggestions: [makeConcentric('m1')], lang: 'es' });
    expect(
      screen.getByTestId('mate-inference-review-panel').textContent,
    ).toContain('Revisión de inferencia de restricciones');
  });

  it('i18n ar → header in Arabic, panel dir=rtl', () => {
    cleanup();
    mount({ suggestions: [makeConcentric('m1')], lang: 'ar' });
    const panel = screen.getByTestId('mate-inference-review-panel');
    expect(panel.textContent).toContain('مراجعة استنتاج القيود');
    expect(panel.getAttribute('dir')).toBe('rtl');
  });

  it('non-Arabic lang sets dir=ltr', () => {
    mount({ suggestions: [makeConcentric('m1')], lang: 'en' });
    expect(
      screen.getByTestId('mate-inference-review-panel').getAttribute('dir'),
    ).toBe('ltr');
  });

  it('threshold = 1.0 → bulk accept fires only for fully-confident mates (or missing scores)', () => {
    const onAccept = vi.fn<(id: string) => void>();
    const mates: Mate[] = [
      makeConcentric('m1'),
      makeConcentric('m2'),
      makeConcentric('m3'),
    ];
    mount({
      suggestions: mates,
      confidence: { m1: 1.0, m2: 0.99, m3: 0.5 },
      onAccept,
    });
    const slider = screen.getByTestId(
      'mate-inference-review-threshold-slider',
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1' } });
    fireEvent.click(
      screen.getByTestId('mate-inference-review-accept-above-threshold'),
    );
    // Only m1 (1.0) qualifies at threshold 1.0
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]![0]).toBe('m1');
  });

  it('bulk accept ignores kind filter (still fires for hidden rows above threshold)', () => {
    const onAccept = vi.fn<(id: string) => void>();
    const mates: Mate[] = [
      makeConcentric('mc1'),
      makeCoincident('mco1'),
    ];
    mount({
      suggestions: mates,
      confidence: { mc1: 0.9, mco1: 0.9 },
      onAccept,
    });
    // Hide concentric rows from the table.
    fireEvent.click(
      screen.getByTestId('mate-inference-review-kind-filter-concentric'),
    );
    // Bulk accept still acts on the full suggestion set.
    fireEvent.click(
      screen.getByTestId('mate-inference-review-accept-above-threshold'),
    );
    expect(onAccept).toHaveBeenCalledTimes(2);
    const calledIds = onAccept.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual(['mc1', 'mco1']);
  });
});
