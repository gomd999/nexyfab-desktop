// @vitest-environment jsdom

/**
 * DesignBriefPanel.autonomy.test.tsx — WA-E autonomy 방출 배선(웹 진입면).
 *
 * 실 액션(브리프 제출)에서만 이벤트가 방출되는지 검증:
 *   - 제출 전: autonomy 스토어 비어 있음(측정 없음).
 *   - 검증 패키지(200): run_started 만(in_progress — 승인은 리뷰 큐 소관).
 *   - 명시 거부(422): run_started + abandoned(승인 없이 종료).
 *   - 인증/플랜 실패(401): 드라이버 런이 없었으므로 아무 이벤트도 방출 안 함.
 * 가짜 이벤트 주입 없음 — 전부 fireEvent 경유.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/shape-generator' }));

import { DesignBriefPanel } from './DesignBriefPanel';
import {
  useAutonomySessionStore,
  selectRunEventLogs,
} from '../_shell/autonomySessionStore';
import { computeRunAutonomy } from '@/lib/ai/design-driver/autonomyMetrics';

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

const OK_PAYLOAD = {
  ok: true,
  planId: 'fixture-l-bracket',
  package: {
    planId: 'fixture-l-bracket',
    parts: [{ partId: 'bracket', volumeMm3: 14720, dxf: '0\n', dimensions: [] }],
    report: { allPassed: true, gates: [{ id: 'geometry:bracket', kind: 'geometry', pass: true, metrics: {} }], approximations: [], limitations: [] },
  },
};

const REFUSAL_PAYLOAD = {
  ok: false,
  refusal: { stage: 'plan', reason: "fixturePlanner: unknown brief 'nope'", failedGateIds: [] },
  gates: [],
};

const store = () => useAutonomySessionStore.getState();

beforeEach(() => {
  store().reset();
  store().setClock(() => 5000);
});

describe('DesignBriefPanel — autonomy 제출 방출', () => {
  it('제출 전에는 autonomy 스토어가 비어 있다(측정 없음)', () => {
    render(<DesignBriefPanel fetchImpl={vi.fn()} />);
    expect(selectRunEventLogs(store())).toEqual([]);
  });

  it('검증 패키지(200) → run_started 만(in_progress)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_PAYLOAD));
    const { getByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);
    fireEvent.submit(getByTestId('db-form'));
    await waitFor(() => expect(getByTestId('db-package')).toBeTruthy());

    const logs = selectRunEventLogs(store());
    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    // runId 는 패키지의 planId 를 사용.
    expect(log[0]).toEqual({ type: 'run_started', runId: 'fixture-l-bracket', atMs: 5000 });
    const res = computeRunAutonomy(log);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.run.finalStatus).toBe('in_progress');
  });

  it('명시 거부(422) → run_started + abandoned', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, REFUSAL_PAYLOAD));
    const { getByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);
    fireEvent.submit(getByTestId('db-form'));
    await waitFor(() => expect(getByTestId('db-refusal')).toBeTruthy());

    const log = selectRunEventLogs(store())[0]!;
    expect(log.map((e) => e.type)).toEqual(['run_started', 'abandoned']);
    const res = computeRunAutonomy(log);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.run.finalStatus).toBe('abandoned');
      expect(res.run.zeroTouch).toBe(false);
    }
  });

  it('인증 실패(401) → 드라이버 런 없음 → 방출 없음', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    const { getByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);
    fireEvent.submit(getByTestId('db-form'));
    await waitFor(() => expect(getByTestId('db-error')).toBeTruthy());
    expect(selectRunEventLogs(store())).toEqual([]);
  });
});
