/** @vitest-environment jsdom */
/**
 * SuggestedMatesPanel — Phase 5.2.3 review UI tests.
 *
 * Exercises the standalone "Suggested Mates" panel that surfaces the
 * inferred mates emitted by `inferMatesFromPlacements` for STEP-import
 * review. The panel itself is pure-props: tests that need a row to
 * "disappear" after accept/reject wrap it in a tiny stateful harness so
 * the parent owns the suggestion list (matches production wiring).
 *
 * Scope of this file:
 *   - rendering (empty / single / mixed / kind icons)
 *   - accept / reject single + state-driven row removal
 *   - accept all / reject all (default fan-out + optional override)
 *   - partNameById lookup + fallback to partId
 *   - 6-lang i18n + Accept All / Reject All visibility flags
 */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SuggestedMatesPanel, {
  MATE_KIND_ICONS,
  type SuggestedMatesPanelProps,
  type PanelLang,
} from '@/app/[lang]/shape-generator/assembly/SuggestedMatesPanel';
import type {
  Mate,
  CoincidentMate,
  ConcentricMate,
  ParallelMate,
} from '@/lib/assembly/mate';

// ─── fixtures ────────────────────────────────────────────────────────────

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

// ─── render helpers ───────────────────────────────────────────────────────

function mount(overrides: Partial<SuggestedMatesPanelProps> = {}): {
  onAccept: SuggestedMatesPanelProps['onAccept'];
  onReject: SuggestedMatesPanelProps['onReject'];
  onAcceptAll?: SuggestedMatesPanelProps['onAcceptAll'];
  onRejectAll?: SuggestedMatesPanelProps['onRejectAll'];
} {
  const onAccept: SuggestedMatesPanelProps['onAccept'] =
    overrides.onAccept ?? vi.fn<(m: Mate) => void>();
  const onReject: SuggestedMatesPanelProps['onReject'] =
    overrides.onReject ?? vi.fn<(id: string) => void>();
  const props: SuggestedMatesPanelProps = {
    lang: overrides.lang ?? 'en',
    suggestions: overrides.suggestions ?? [],
    onAccept,
    onReject,
    onAcceptAll: overrides.onAcceptAll,
    onRejectAll: overrides.onRejectAll,
    partNameById: overrides.partNameById,
  };
  render(<SuggestedMatesPanel {...props} />);
  return {
    onAccept,
    onReject,
    onAcceptAll: overrides.onAcceptAll,
    onRejectAll: overrides.onRejectAll,
  };
}

/**
 * Stateful harness: the production wrapper owns the suggestion list and
 * removes entries as the user accepts / rejects them. Mirror that here so
 * tests that assert "row disappears" exercise the same data-flow.
 */
function StatefulHarness({
  initial,
  lang = 'en',
  partNameById,
  onAcceptSpy,
  onRejectSpy,
}: {
  initial: ReadonlyArray<Mate>;
  lang?: PanelLang;
  partNameById?: SuggestedMatesPanelProps['partNameById'];
  onAcceptSpy?: (m: Mate) => void;
  onRejectSpy?: (id: string) => void;
}): React.ReactElement {
  const [list, setList] = useState<ReadonlyArray<Mate>>(initial);
  return (
    <SuggestedMatesPanel
      lang={lang}
      suggestions={list}
      partNameById={partNameById}
      onAccept={(m) => {
        onAcceptSpy?.(m);
        setList((cur) => cur.filter((x) => x.id !== m.id));
      }}
      onReject={(id) => {
        onRejectSpy?.(id);
        setList((cur) => cur.filter((x) => x.id !== id));
      }}
    />
  );
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('SuggestedMatesPanel', () => {
  it('empty suggestions → renders "No mate suggestions found" message and hides Accept/Reject All', () => {
    mount({ suggestions: [] });
    expect(screen.getByTestId('solver-suggested-empty')).toBeInTheDocument();
    expect(screen.getByTestId('solver-suggested-empty').textContent).toContain(
      'No mate suggestions found',
    );
    expect(screen.queryByTestId('solver-suggested-accept-all')).toBeNull();
    expect(screen.queryByTestId('solver-suggested-reject-all')).toBeNull();
  });

  it('1 concentric mate → exactly one row rendered, header shows count (1)', () => {
    const m = makeConcentric('inferred_concentric_1');
    mount({ suggestions: [m] });
    expect(
      screen.getByTestId(`solver-suggested-mate-${m.id}`),
    ).toBeInTheDocument();
    // Empty message must NOT appear when there are suggestions.
    expect(screen.queryByTestId('solver-suggested-empty')).toBeNull();
    // Header reflects count.
    const panel = screen.getByTestId('solver-suggested-panel');
    expect(panel.textContent).toContain('(1)');
  });

  it('Accept click → onAccept(mate) called with full mate object', () => {
    const onAccept = vi.fn<(m: Mate) => void>();
    const m = makeConcentric('inferred_concentric_1');
    mount({ suggestions: [m], onAccept });
    fireEvent.click(
      screen.getByTestId(`solver-suggested-mate-${m.id}-accept`),
    );
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]![0]).toEqual(m);
  });

  it('Accept click + parent state update → row disappears', () => {
    const m = makeConcentric('inferred_concentric_1');
    render(<StatefulHarness initial={[m]} />);
    expect(
      screen.getByTestId(`solver-suggested-mate-${m.id}`),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId(`solver-suggested-mate-${m.id}-accept`),
    );
    expect(
      screen.queryByTestId(`solver-suggested-mate-${m.id}`),
    ).toBeNull();
    // Now empty.
    expect(screen.getByTestId('solver-suggested-empty')).toBeInTheDocument();
  });

  it('Reject click → onReject(id) called with the mate id (not the object)', () => {
    const onReject = vi.fn<(id: string) => void>();
    const m = makeConcentric('inferred_concentric_1');
    mount({ suggestions: [m], onReject });
    fireEvent.click(
      screen.getByTestId(`solver-suggested-mate-${m.id}-reject`),
    );
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject.mock.calls[0]![0]).toBe(m.id);
  });

  it('Reject click + parent state update → row disappears', () => {
    const m = makeConcentric('inferred_concentric_1');
    render(<StatefulHarness initial={[m]} />);
    fireEvent.click(
      screen.getByTestId(`solver-suggested-mate-${m.id}-reject`),
    );
    expect(
      screen.queryByTestId(`solver-suggested-mate-${m.id}`),
    ).toBeNull();
  });

  it('Accept All (no override) → onAccept fires once per mate, in render order', () => {
    const onAccept = vi.fn<(m: Mate) => void>();
    const mates: Mate[] = [
      makeConcentric('m1'),
      makeCoincident('m2'),
      makeParallel('m3'),
    ];
    mount({ suggestions: mates, onAccept });
    fireEvent.click(screen.getByTestId('solver-suggested-accept-all'));
    expect(onAccept).toHaveBeenCalledTimes(3);
    expect(onAccept.mock.calls.map((c) => (c[0] as Mate).id)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('Reject All (no override) → onReject fires once per mate id', () => {
    const onReject = vi.fn<(id: string) => void>();
    const mates: Mate[] = [
      makeConcentric('m1'),
      makeCoincident('m2'),
    ];
    mount({ suggestions: mates, onReject });
    fireEvent.click(screen.getByTestId('solver-suggested-reject-all'));
    expect(onReject).toHaveBeenCalledTimes(2);
    expect(onReject.mock.calls.map((c) => c[0])).toEqual(['m1', 'm2']);
  });

  it('onAcceptAll override → single callback fires, no per-mate dispatch', () => {
    const onAccept = vi.fn<(m: Mate) => void>();
    const onAcceptAll = vi.fn<() => void>();
    const mates: Mate[] = [makeConcentric('m1'), makeCoincident('m2')];
    mount({ suggestions: mates, onAccept, onAcceptAll });
    fireEvent.click(screen.getByTestId('solver-suggested-accept-all'));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('onRejectAll override → single callback fires, no per-mate dispatch', () => {
    const onReject = vi.fn<(id: string) => void>();
    const onRejectAll = vi.fn<() => void>();
    const mates: Mate[] = [makeConcentric('m1'), makeCoincident('m2')];
    mount({ suggestions: mates, onReject, onRejectAll });
    fireEvent.click(screen.getByTestId('solver-suggested-reject-all'));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('5 mixed suggestions (coincident + concentric + parallel) → 5 rows + correct count', () => {
    const mates: Mate[] = [
      makeConcentric('inferred_concentric_1'),
      makeCoincident('inferred_coincident_1'),
      makeParallel('inferred_parallel_1'),
      makeConcentric('inferred_concentric_2', 'p1', 'p2'),
      makeCoincident('inferred_coincident_2', 'p2', 'p3'),
    ];
    mount({ suggestions: mates });
    for (const m of mates) {
      expect(
        screen.getByTestId(`solver-suggested-mate-${m.id}`),
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId('solver-suggested-panel').textContent).toContain(
      '(5)',
    );
  });

  it('partNameById lookup → part display names used in row ref text', () => {
    const m = makeConcentric('m1', 'part_001', 'part_002');
    const partNameById = (id: string): string =>
      ({ part_001: 'Bracket', part_002: 'Pin' }[id] ?? id);
    mount({ suggestions: [m], partNameById });
    const row = screen.getByTestId(`solver-suggested-mate-${m.id}`);
    expect(row.textContent).toContain('Bracket:axis_1');
    expect(row.textContent).toContain('Pin:axis_2');
    // Raw partId must NOT leak when a name resolves.
    expect(row.textContent).not.toContain('part_001:axis_1');
  });

  it('partNameById absent → partId used verbatim as the name', () => {
    const m = makeConcentric('m1', 'partA', 'partB');
    mount({ suggestions: [m] });
    const row = screen.getByTestId(`solver-suggested-mate-${m.id}`);
    expect(row.textContent).toContain('partA:axis_1');
    expect(row.textContent).toContain('partB:axis_2');
  });

  it('partNameById returns empty string → fall back to partId (no blank cells)', () => {
    const m = makeConcentric('m1', 'partA', 'partB');
    const partNameById = (id: string): string =>
      id === 'partA' ? '' : 'NamedB';
    mount({ suggestions: [m], partNameById });
    const row = screen.getByTestId(`solver-suggested-mate-${m.id}`);
    // partA fell back to raw id.
    expect(row.textContent).toContain('partA:axis_1');
    expect(row.textContent).toContain('NamedB:axis_2');
  });

  it('kind icons match the public MATE_KIND_ICONS registry for coincident/concentric/parallel', () => {
    const mates: Mate[] = [
      makeCoincident('mc'),
      makeConcentric('mn'),
      makeParallel('mp'),
    ];
    mount({ suggestions: mates });
    expect(
      screen.getByTestId('solver-suggested-mate-mc').textContent,
    ).toContain(MATE_KIND_ICONS.coincident);
    expect(
      screen.getByTestId('solver-suggested-mate-mn').textContent,
    ).toContain(MATE_KIND_ICONS.concentric);
    expect(
      screen.getByTestId('solver-suggested-mate-mp').textContent,
    ).toContain(MATE_KIND_ICONS.parallel);
  });

  it('i18n ko → header "추천 메이트", concentric label "동심"', () => {
    const m = makeConcentric('m1');
    mount({ suggestions: [m], lang: 'ko' });
    const panel = screen.getByTestId('solver-suggested-panel');
    expect(panel.textContent).toContain('추천 메이트');
    expect(screen.getByTestId(`solver-suggested-mate-${m.id}`).textContent)
      .toContain('동심');
  });

  it('i18n en → header "Suggested Mates", concentric label "Concentric"', () => {
    cleanup();
    const m = makeConcentric('m1');
    mount({ suggestions: [m], lang: 'en' });
    const panel = screen.getByTestId('solver-suggested-panel');
    expect(panel.textContent).toContain('Suggested Mates');
    expect(screen.getByTestId(`solver-suggested-mate-${m.id}`).textContent)
      .toContain('Concentric');
  });

  it('i18n ja → header "推奨合致", coincident label "一致"', () => {
    cleanup();
    const m = makeCoincident('m1');
    mount({ suggestions: [m], lang: 'ja' });
    const panel = screen.getByTestId('solver-suggested-panel');
    expect(panel.textContent).toContain('推奨合致');
    expect(screen.getByTestId(`solver-suggested-mate-${m.id}`).textContent)
      .toContain('一致');
  });

  it('i18n zh → header "建议配合", parallel label "平行"', () => {
    cleanup();
    const m = makeParallel('m1');
    mount({ suggestions: [m], lang: 'zh' });
    const panel = screen.getByTestId('solver-suggested-panel');
    expect(panel.textContent).toContain('建议配合');
    expect(screen.getByTestId(`solver-suggested-mate-${m.id}`).textContent)
      .toContain('平行');
  });

  it('i18n es → header "Restricciones sugeridas", concentric label "Concéntrico"', () => {
    cleanup();
    const m = makeConcentric('m1');
    mount({ suggestions: [m], lang: 'es' });
    const panel = screen.getByTestId('solver-suggested-panel');
    expect(panel.textContent).toContain('Restricciones sugeridas');
    expect(screen.getByTestId(`solver-suggested-mate-${m.id}`).textContent)
      .toContain('Concéntrico');
  });

  it('i18n ar → header "القيود المقترحة", concentric label "متمركز", panel dir=rtl', () => {
    cleanup();
    const m = makeConcentric('m1');
    mount({ suggestions: [m], lang: 'ar' });
    const panel = screen.getByTestId('solver-suggested-panel');
    expect(panel.textContent).toContain('القيود المقترحة');
    expect(screen.getByTestId(`solver-suggested-mate-${m.id}`).textContent)
      .toContain('متمركز');
    expect(panel.getAttribute('dir')).toBe('rtl');
  });

  it('non-Arabic lang sets dir=ltr', () => {
    mount({ suggestions: [makeConcentric('m1')], lang: 'en' });
    expect(screen.getByTestId('solver-suggested-panel').getAttribute('dir'))
      .toBe('ltr');
  });

  it('Accept All / Reject All hidden in empty state regardless of callback presence', () => {
    mount({
      suggestions: [],
      onAcceptAll: vi.fn(),
      onRejectAll: vi.fn(),
    });
    expect(screen.queryByTestId('solver-suggested-accept-all')).toBeNull();
    expect(screen.queryByTestId('solver-suggested-reject-all')).toBeNull();
  });

  it('stateful harness: accept-then-reject sequence shrinks list correctly', () => {
    const onAcceptSpy = vi.fn<(m: Mate) => void>();
    const onRejectSpy = vi.fn<(id: string) => void>();
    const mates: Mate[] = [
      makeConcentric('a'),
      makeCoincident('b'),
      makeParallel('c'),
    ];
    render(
      <StatefulHarness
        initial={mates}
        onAcceptSpy={onAcceptSpy}
        onRejectSpy={onRejectSpy}
      />,
    );
    // Accept first.
    fireEvent.click(screen.getByTestId('solver-suggested-mate-a-accept'));
    expect(screen.queryByTestId('solver-suggested-mate-a')).toBeNull();
    expect(screen.getByTestId('solver-suggested-panel').textContent).toContain(
      '(2)',
    );
    // Reject second.
    fireEvent.click(screen.getByTestId('solver-suggested-mate-b-reject'));
    expect(screen.queryByTestId('solver-suggested-mate-b')).toBeNull();
    expect(screen.getByTestId('solver-suggested-panel').textContent).toContain(
      '(1)',
    );
    // Last remains visible.
    expect(
      screen.getByTestId('solver-suggested-mate-c'),
    ).toBeInTheDocument();
    expect(onAcceptSpy).toHaveBeenCalledTimes(1);
    expect(onRejectSpy).toHaveBeenCalledTimes(1);
  });

  it('row arrow separator renders between part refs ("→")', () => {
    const m = makeCoincident('m1');
    mount({ suggestions: [m] });
    expect(screen.getByTestId(`solver-suggested-mate-${m.id}`).textContent)
      .toContain('→');
  });
});
