// @vitest-environment jsdom

/**
 * aiReviewQueuePanel.autonomy.test.tsx — WA-E autonomy 방출 배선.
 *
 * (1) 리뷰 열람/접기 → onReviewOpen/onReviewClose 가 실 액션에서만 방출되고,
 *     승인 시 review-ended 가 approve 콜백 **이전**에 발생(계측기가 종결
 *     'approved' 뒤 이벤트를 거부하지 않도록).
 * (2) 그 훅을 실제 autonomySessionStore 에 배선하면, 오직 UI 액션만으로
 *     대시보드(AutonomyDashboardConnected)가 빈 상태→수치로 바뀐다.
 *     가짜 이벤트 주입 없음 — 전부 fireEvent 경유.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/shape-generator' }));

import { AiReviewQueuePanel } from './AiReviewQueuePanel';
import { AutonomyDashboardConnected } from './AutonomyDashboardConnected';
import { useAutonomySessionStore } from './autonomySessionStore';
import { VersionRepo } from '../pdm/versionBranch';
import { recordAiRun, type AiRunRecord } from '../pdm/reviewQueue';
import type { FeatureInstance } from '../features/types';

const f = (id: string, params: Record<string, number> = {}): FeatureInstance => ({
  id, type: 'fillet', params, enabled: true,
});

/** Real repo + one clean (3/3 gates) AI run. */
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
  return { repo, runs: [passRun] as AiRunRecord[] };
}

beforeEach(() => {
  useAutonomySessionStore.getState().reset();
  useAutonomySessionStore.getState().setClock(() => 1000); // 결정론
});
afterEach(() => cleanup());

describe('AiReviewQueuePanel — autonomy 콜백 순서(스파이)', () => {
  it('열람=onReviewOpen, 승인 시 onReviewClose 가 onApprove 보다 먼저', () => {
    const { repo, runs } = seed();
    const order: string[] = [];
    render(
      <AiReviewQueuePanel
        isKo={false}
        runs={runs}
        resolveCommit={(id) => repo.getCommit(id)}
        onApprove={() => order.push('approve')}
        onRequestChanges={() => order.push('changes')}
        onReviewOpen={(id) => order.push(`open:${id}`)}
        onReviewClose={(id) => order.push(`close:${id}`)}
      />,
    );

    fireEvent.click(screen.getByTestId('arq-run-toggle')); // expand
    expect(order).toEqual(['open:r-pass']);

    fireEvent.click(screen.getByTestId('arq-approve'));
    // close(review-ended) MUST precede approve(terminal).
    expect(order).toEqual(['open:r-pass', 'close:r-pass', 'approve']);
  });

  it('열람 후 접기 → open 다음 close (실 액션에서만)', () => {
    const { repo, runs } = seed();
    const order: string[] = [];
    render(
      <AiReviewQueuePanel
        isKo={false}
        runs={runs}
        resolveCommit={(id) => repo.getCommit(id)}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
        onReviewOpen={(id) => order.push(`open:${id}`)}
        onReviewClose={(id) => order.push(`close:${id}`)}
      />,
    );
    const toggle = screen.getByTestId('arq-run-toggle');
    fireEvent.click(toggle); // open
    fireEvent.click(toggle); // collapse
    expect(order).toEqual(['open:r-pass', 'close:r-pass']);
  });
});

describe('AiReviewQueuePanel → store → dashboard (액션 경유만)', () => {
  it('빈 대시보드 → UI 열람+승인 후 zero-touch 수치 표시', async () => {
    const { repo, runs } = seed();
    const st = useAutonomySessionStore.getState();

    render(
      <>
        <AiReviewQueuePanel
          isKo={false}
          runs={runs}
          resolveCommit={(id) => repo.getCommit(id)}
          onApprove={(id) => st.approved(id)}
          onRequestChanges={(id, c) => st.changesRequested(id, c.length)}
          onReviewOpen={(id) => st.reviewStarted(id)}
          onReviewClose={(id) => st.reviewEnded(id)}
        />
        <AutonomyDashboardConnected />
      </>,
    );

    // 액션 전: 대시보드는 "측정 없음".
    expect(screen.getByTestId('autonomy-empty')).toBeTruthy();

    fireEvent.click(screen.getByTestId('arq-run-toggle')); // review 시작
    fireEvent.click(screen.getByTestId('arq-approve'));     // review 종료 → 승인

    // 액션 후: 대시보드가 실 이벤트를 계측해 zero-touch 100%(1/1) 표시.
    await waitFor(() => expect(screen.getByTestId('autonomy-dashboard')).toBeTruthy());
    expect(screen.getByTestId('autonomy-zerotouch').textContent).toContain('100.0%');
    expect(screen.getByTestId('autonomy-zerotouch').textContent).toContain('(1/1)');
    expect(screen.getByTestId('autonomy-run-badge').textContent).toContain('zero-touch');
    // 표본 부족(n=1<5) 경고는 유지(숨기지 않음).
    expect(screen.getByTestId('autonomy-lowsample')).toBeTruthy();
  });
});
