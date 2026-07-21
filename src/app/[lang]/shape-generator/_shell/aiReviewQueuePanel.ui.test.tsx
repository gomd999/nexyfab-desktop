// @vitest-environment jsdom

/**
 * aiReviewQueuePanel.ui.test.tsx — Wave A Track WA-C.
 *
 * jsdom proof of the human side of the AI review loop. The panel is
 * props-injected; runs and commits come from a REAL VersionRepo populated
 * via pdm/reviewQueue.recordAiRun (no fabricated commit graphs):
 *   - two pending AI runs listed with branch names + gate badges (pass n/m)
 *   - fail reasons surfaced on the failing run
 *   - expanding shows the diffCommits-based diff + verification report rows
 *   - approve fires the callback for a clean run
 *   - approve is DISABLED (with the no-override principle) on a failed run
 *   - change-request comment (with target feature id) reaches the callback
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shape-generator',
}));

import { AiReviewQueuePanel } from './AiReviewQueuePanel';
import { VersionRepo } from '../pdm/versionBranch';
import { recordAiRun, type AiRunRecord } from '../pdm/reviewQueue';
import type { FeatureInstance } from '../features/types';

const f = (id: string, params: Record<string, number> = {}): FeatureInstance => ({
  id, type: 'fillet', params, enabled: true,
});

/** Real repo + two recorded AI runs: r-pass (3/3 gates) and r-fail (1/2). */
function seed() {
  const repo = new VersionRepo([f('a', { radius: 3 })], 'human');
  const passRun = recordAiRun(repo, {
    runId: 'r-pass',
    briefSummary: 'add mounting hole b',
    features: [f('a', { radius: 3 }), f('b', { d: 6 })],
    report: {
      gates: [
        { id: 'geometry.watertight', pass: true },
        { id: 'geometry.volume', pass: true, value: 1279.98, expected: 1280, unit: 'mm3' },
        { id: 'dimension.measured', pass: true, value: 40, expected: 40, unit: 'mm' },
      ],
    },
    author: 'ai-driver',
  });
  const failRun = recordAiRun(repo, {
    runId: 'r-fail',
    briefSummary: 'thin-wall variant',
    features: [f('a', { radius: 1 })],
    report: {
      gates: [
        { id: 'geometry.watertight', pass: true },
        { id: 'dfm.minWall', pass: false, value: 0.4, expected: 0.8, unit: 'mm', reason: 'wall 0.4mm < min 0.8mm' },
      ],
    },
    author: 'ai-driver',
  });
  return { repo, runs: [passRun, failRun] as AiRunRecord[] };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof AiReviewQueuePanel>> = {}) {
  const { repo, runs } = seed();
  const onApprove = vi.fn();
  const onRequestChanges = vi.fn();
  render(
    <AiReviewQueuePanel
      isKo={false}
      runs={runs}
      resolveCommit={id => repo.getCommit(id)}
      onApprove={onApprove}
      onRequestChanges={onRequestChanges}
      {...overrides}
    />,
  );
  return { repo, runs, onApprove, onRequestChanges };
}

afterEach(() => cleanup());

describe('AiReviewQueuePanel — queue listing', () => {
  it('lists both pending runs with branch names and gate badges (pass n/m + fail reason)', () => {
    renderPanel();
    const rows = screen.getAllByTestId('arq-run');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('ai/r-pass');
    expect(rows[1]!.textContent).toContain('ai/r-fail');

    const badges = screen.getAllByTestId('arq-gate-badge');
    expect(badges[0]!.textContent).toContain('3/3');
    expect(badges[1]!.textContent).toContain('1/2');

    // Fail reason is visible without expanding.
    const reasons = screen.getByTestId('arq-fail-reasons');
    expect(reasons.textContent).toContain('dfm.minWall');
    expect(reasons.textContent).toContain('wall 0.4mm < min 0.8mm');
  });

  it('hides non-pending runs and shows the empty state when nothing is pending', () => {
    const { repo, runs } = seed();
    const done = runs.map((r, i) => ({
      ...r,
      status: (i === 0 ? 'approved' : 'changes_requested') as AiRunRecord['status'],
    }));
    render(
      <AiReviewQueuePanel
        isKo={false}
        runs={done}
        resolveCommit={id => repo.getCommit(id)}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
      />,
    );
    expect(screen.queryAllByTestId('arq-run')).toHaveLength(0);
    expect(screen.getByTestId('arq-empty')).toBeTruthy();
  });
});

describe('AiReviewQueuePanel — expanded review (diff + report)', () => {
  it('shows the diffCommits diff vs fork point and the verification report rows', () => {
    renderPanel();
    fireEvent.click(screen.getAllByTestId('arq-run-toggle')[0]!); // r-pass

    // Diff computed from the REAL commit graph: run added feature 'b'.
    const diff = screen.getByTestId('arq-diff');
    expect(diff.textContent).toContain('+1 −0 ~0');
    const entries = screen.getAllByTestId('arq-diff-entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain('b');

    // Verification report: one row per gate, measured values shown.
    const gateRows = screen.getAllByTestId('arq-gate-row');
    expect(gateRows).toHaveLength(3);
    expect(gateRows[1]!.textContent).toContain('geometry.volume');
    expect(gateRows[1]!.textContent).toContain('1279.98');
  });

  it('approve on a clean run fires the callback with the runId', () => {
    const { onApprove } = renderPanel();
    fireEvent.click(screen.getAllByTestId('arq-run-toggle')[0]!); // r-pass
    const btn = screen.getByTestId('arq-approve') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onApprove).toHaveBeenCalledExactlyOnceWith('r-pass');
  });

  it('approve is disabled on a failed-gate run, with the no-human-override principle shown', () => {
    const { onApprove } = renderPanel();
    fireEvent.click(screen.getAllByTestId('arq-run-toggle')[1]!); // r-fail
    const btn = screen.getByTestId('arq-approve') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onApprove).not.toHaveBeenCalled();
    const blocked = screen.getByTestId('arq-approve-blocked');
    expect(blocked.textContent).toContain('cannot enter main, even with human approval');
  });

  it('request changes sends the typed comment (with target feature id) to the callback', () => {
    const { onRequestChanges } = renderPanel();
    fireEvent.click(screen.getAllByTestId('arq-run-toggle')[1]!); // r-fail

    // Empty note → button gated.
    const btn = screen.getByTestId('arq-request-changes') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('arq-comment-feature'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('arq-comment-note'), { target: { value: 'wall must be >= 0.8mm' } });
    fireEvent.click(screen.getByTestId('arq-request-changes'));

    expect(onRequestChanges).toHaveBeenCalledExactlyOnceWith('r-fail', [
      { featureId: 'a', note: 'wall must be >= 0.8mm' },
    ]);
  });
});
