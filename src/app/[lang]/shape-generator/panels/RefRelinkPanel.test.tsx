// @vitest-environment jsdom
/**
 * RefRelinkPanel — R5 UI: renders the lost-reference list (with reasons and
 * gate numbers), one-click candidate apply, and the explicit
 * no-confident-candidate state. Pure presentation over the tested engine data.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import RefRelinkPanel, { type RefRelinkItem } from './RefRelinkPanel';
import { suggestRelinkCandidates, type LostRef } from '../features/refRelink';
import type { EdgeSig } from '../features/edgeCorrespondence';

const vert = (x: number, y: number): EdgeSig => ({ mid: [x, y, 4], dir: [0, 0, 1], length: 8 });
const BOX_VERTS: EdgeSig[] = [vert(0, 0), vert(20, 0), vert(20, 10), vert(0, 10)];

const edgeLost = (pos: [number, number, number]): LostRef => ({
  id: 'feature:feat-1#sel0',
  consumer: { type: 'feature', id: 'feat-1', label: 'Fillet' },
  kind: 'edge-selection', selectionIndex: 0, reason: 'ambiguous',
  anchor: { position: pos, direction: [0, 0, 1], length: 8 },
});

const namedLost: LostRef = {
  id: 'dimension:dim-1#e.vert.4',
  consumer: { type: 'dimension', id: 'dim-1', label: 'width dim' },
  kind: 'named', name: 'e.vert.4', reason: 'unknown',
  anchor: { position: [0, 10, 4] },
};

function itemFor(lostRef: LostRef): RefRelinkItem {
  return { lostRef, suggestion: suggestRelinkCandidates(lostRef, { edgeSigs: BOX_VERTS }, { scale: 20 }) };
}

describe('RefRelinkPanel (R5)', () => {
  it('renders nothing when there are no lost refs', () => {
    const { container } = render(<RefRelinkPanel items={[]} onApply={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists lost refs with their loss reason', () => {
    const { getByTestId } = render(
      <RefRelinkPanel lang="en" items={[itemFor(edgeLost([10, 0, 4]))]} onApply={() => {}} />,
    );
    expect(getByTestId('refrelink-panel')).toBeTruthy();
    expect(getByTestId('refrelink-item-0').textContent).toContain('Fillet');
    expect(getByTestId('refrelink-0-reason').textContent).toContain('match equally well');
  });

  it('gate-confident candidate is badged and shows score + margin numbers', () => {
    // Clear-winner scenario: score 0.972, margin 0.211 (measured in refRelink.test.ts).
    const item = itemFor(edgeLost([19, 0.5, 4]));
    expect(item.suggestion.hasConfidentCandidate).toBe(true);
    const { getByTestId, queryByTestId } = render(
      <RefRelinkPanel lang="en" items={[item]} onApply={() => {}} />,
    );
    const top = getByTestId('refrelink-0-candidate-0');
    expect(top.getAttribute('data-confident')).toBe('true');
    expect(getByTestId('refrelink-0-confident-0')).toBeTruthy();
    expect(top.textContent).toContain('score 0.972');
    expect(top.textContent).toContain('margin 0.211');
    // Confident case → no "no confident candidate" warning.
    expect(queryByTestId('refrelink-0-noconfident')).toBeNull();
  });

  it('ambiguous case shows the explicit no-confident state and no badged candidate', () => {
    // Symmetric point: 0.75 vs 0.75, margin 0 < 0.08 → below-gate.
    const item = itemFor(edgeLost([10, 0, 4]));
    expect(item.suggestion.hasConfidentCandidate).toBe(false);
    const { getByTestId, queryByTestId } = render(
      <RefRelinkPanel lang="ko" items={[item]} onApply={() => {}} />,
    );
    expect(getByTestId('refrelink-0-noconfident').textContent).toContain('확신 후보 없음');
    expect(getByTestId('refrelink-0-candidate-0').getAttribute('data-confident')).toBe('false');
    expect(queryByTestId('refrelink-0-confident-0')).toBeNull();
    // Numbers still shown so the user can decide.
    expect(getByTestId('refrelink-0-candidate-0').textContent).toContain('0.75');
  });

  it('clicking a candidate emits onApply with the lost ref and that candidate target', () => {
    const item = itemFor(edgeLost([19, 0.5, 4]));
    const onApply = vi.fn();
    const { getByTestId } = render(<RefRelinkPanel items={[item]} onApply={onApply} />);
    fireEvent.click(getByTestId('refrelink-0-candidate-0'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(item.lostRef, item.suggestion.candidates[0]!.target);
    expect(onApply.mock.calls[0]![1]).toMatchObject({ kind: 'sig', sigIndex: 1 });
  });

  it('named-channel item shows the ref name, the distance-only approximation note, and applies by name', () => {
    const suggestion = {
      lostRefId: namedLost.id,
      candidates: [
        { target: { kind: 'name' as const, name: 'e.vert.3' }, anchor: [0, 10, 4] as [number, number, number], score: null, distance: 0, confident: false },
      ],
      hasConfidentCandidate: false,
      margin: null,
      gate: { minScore: 0, minMargin: 0.08 },
      note: 'midpoint-only-ranking' as const,
    };
    const onApply = vi.fn();
    const { getByTestId } = render(
      <RefRelinkPanel lang="en" items={[{ lostRef: namedLost, suggestion }]} onApply={onApply} />,
    );
    expect(getByTestId('refrelink-item-0').textContent).toContain('e.vert.4');
    expect(getByTestId('refrelink-0-approx').textContent).toContain('distance only');
    fireEvent.click(getByTestId('refrelink-0-candidate-0'));
    expect(onApply).toHaveBeenCalledWith(namedLost, { kind: 'name', name: 'e.vert.3' });
  });

  it('empty candidate list shows the explicit no-candidates state and the re-select CTA', () => {
    const suggestion = {
      lostRefId: namedLost.id, candidates: [], hasConfidentCandidate: false,
      margin: null, gate: { minScore: 0, minMargin: 0.08 }, note: 'no-candidates' as const,
    };
    const onReselect = vi.fn();
    const { getByTestId } = render(
      <RefRelinkPanel items={[{ lostRef: namedLost, suggestion }]} onApply={() => {}} onReselect={onReselect} />,
    );
    expect(getByTestId('refrelink-0-empty')).toBeTruthy();
    fireEvent.click(getByTestId('refrelink-0-reselect'));
    expect(onReselect).toHaveBeenCalledWith(namedLost);
  });

  it('renders the relink history (audit trail)', () => {
    const { getByTestId } = render(
      <RefRelinkPanel
        items={[itemFor(edgeLost([10, 0, 4]))]}
        onApply={() => {}}
        history={[{
          at: 1, consumerType: 'dimension', consumerId: 'dim-1',
          lostRefId: 'dimension:dim-1#e.vert.4', reason: 'unknown',
          from: 'e.vert.4', to: 'e.vert.3', confident: false,
        }]}
      />,
    );
    expect(getByTestId('refrelink-history-0').textContent).toContain('e.vert.4 → e.vert.3');
  });
});
