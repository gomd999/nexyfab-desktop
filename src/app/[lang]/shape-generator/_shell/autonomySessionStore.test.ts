/**
 * autonomySessionStore.test.ts — WA-E / §GA3 세션 스토어.
 *
 * 검증: (1) 빈 세션 = 측정 없음(n=0), (2) emitter 가 실제 이벤트를 축적하고
 * 계측기(computeRunAutonomy/computeBatchAutonomy)와 연결, (3) 주입 시각으로
 * 결정론, (4) run_started 자동 시딩·중복 방지, (5) 종결 상태.
 *
 * 이 파일은 스토어 API(emitter)만 호출한다 — 내부 상태를 손으로 조작해
 * "가짜 이벤트"를 만들지 않는다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useAutonomySessionStore,
  selectRunEventLogs,
} from './autonomySessionStore';
import {
  computeRunAutonomy,
  computeBatchAutonomy,
} from '@/lib/ai/design-driver/autonomyMetrics';

const s = () => useAutonomySessionStore.getState();

beforeEach(() => {
  s().reset();
  // 결정론: 명시적으로 주입하지 않은 emitter 호출용 고정 시계.
  s().setClock(() => 42);
});

describe('autonomySessionStore — 빈 세션(파트너 전) = 측정 없음', () => {
  it('reset 직후 런이 없고 배치 집계는 n=0(비율 null)', () => {
    expect(selectRunEventLogs(s())).toEqual([]);
    const batch = computeBatchAutonomy([]);
    expect(batch.sampleSize).toBe(0);
    expect(batch.zeroTouchRate).toBeNull(); // 0% 로 날조하지 않음
  });
});

describe('autonomySessionStore — 이벤트 축적 + 계측기 연결', () => {
  it('zero-touch 런: run_started→검토→승인, 개입 0 → zeroTouch true', () => {
    s().runStarted('run-A', 1_000);
    s().reviewStarted('run-A', 2_000);
    s().reviewEnded('run-A', 62_000); // 60,000ms
    s().approved('run-A', 63_000);

    const logs = selectRunEventLogs(s());
    expect(logs).toHaveLength(1);
    const res = computeRunAutonomy(logs[0]!);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.run.interventionCount).toBe(0);
      expect(res.run.reviewDurationMs).toBe(60_000);
      expect(res.run.finalStatus).toBe('approved');
      expect(res.run.zeroTouch).toBe(true);
    }
  });

  it('개입 런: 수정요청 1회 → intervention 1, zeroTouch false', () => {
    s().runStarted('run-B', 0);
    s().reviewStarted('run-B', 100);
    s().changesRequested('run-B', 2, 200);
    s().reviewEnded('run-B', 300);

    const res = computeRunAutonomy(selectRunEventLogs(s())[0]!);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.run.interventionCount).toBe(1);
      expect(res.run.changesRequestedCount).toBe(1);
      expect(res.run.totalCommentCount).toBe(2);
      expect(res.run.zeroTouch).toBe(false);
    }
  });

  it('배치 연결: zero-touch 1 + 개입 1 → zeroTouchRate 1/2', () => {
    // run-A: zero-touch
    s().runStarted('run-A', 1_000);
    s().reviewStarted('run-A', 2_000);
    s().reviewEnded('run-A', 3_000);
    s().approved('run-A', 4_000);
    // run-B: 개입 1회 후 승인
    s().runStarted('run-B', 1_000);
    s().reviewStarted('run-B', 2_000);
    s().changesRequested('run-B', 1, 3_000);
    s().reviewEnded('run-B', 4_000);
    s().approved('run-B', 5_000);

    const measured = selectRunEventLogs(s()).map((log) => computeRunAutonomy(log));
    expect(measured.every((m) => m.ok)).toBe(true);
    const runs = measured.flatMap((m) => (m.ok ? [m.run] : []));
    const batch = computeBatchAutonomy(runs);
    expect(batch.sampleSize).toBe(2);
    expect(batch.zeroTouchCount).toBe(1);
    expect(batch.zeroTouchRate).toBe(0.5);
    expect(batch.lowSample).toBe(true); // n<5
  });

  it('abandoned 런(거부): 개입 0이어도 승인 없으면 zeroTouch false', () => {
    s().runStarted('run-X', 10);
    s().abandoned('run-X', 20);
    const res = computeRunAutonomy(selectRunEventLogs(s())[0]!);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.run.finalStatus).toBe('abandoned');
      expect(res.run.zeroTouch).toBe(false);
    }
  });
});

describe('autonomySessionStore — run_started 시딩·중복·결정론', () => {
  it('run_started 없이 도착한 리뷰 이벤트는 같은 시각에 run_started 를 시딩(계측기 유효)', () => {
    // 리뷰-큐 런은 PDM runId 로 진입하므로 브리프 제출 없이 첫 이벤트가 review 다.
    s().reviewStarted('pdm-run', 500);
    const seeded = selectRunEventLogs(s())[0]!;
    // 시딩: 첫 이벤트가 run_started(같은 시각) — 계측기의 "첫 이벤트=run_started" 충족.
    expect(seeded[0]).toEqual({ type: 'run_started', runId: 'pdm-run', atMs: 500 });
    expect(seeded[1]!.type).toBe('human_review_started');

    // 검토를 닫아 완결된 시퀀스가 되면 계측기가 유효하게 받아들인다.
    // (열린 채로는 계측기가 정당하게 거부 — 미완결 검토는 추측하지 않음.)
    s().reviewEnded('pdm-run', 900);
    s().approved('pdm-run', 1000);
    const res = computeRunAutonomy(selectRunEventLogs(s())[0]!);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.run.reviewDurationMs).toBe(400);
  });

  it('run_started 중복 호출은 무연산(계측기가 거부하는 시퀀스를 만들지 않음)', () => {
    s().runStarted('run-A', 100);
    s().runStarted('run-A', 200); // 무시되어야 함
    const log = selectRunEventLogs(s())[0]!;
    expect(log.filter((e) => e.type === 'run_started')).toHaveLength(1);
    expect(log[0]!.atMs).toBe(100);
  });

  it('주입 시각 없으면 clock() 사용 — 결정론', () => {
    s().runStarted('run-A'); // clock()=42
    const log = selectRunEventLogs(s())[0]!;
    expect(log[0]!.atMs).toBe(42);
  });

  it('동일 시각 시퀀스는 reset 후 재현되면 동일 로그', () => {
    const run = () => {
      s().runStarted('r', 1);
      s().reviewStarted('r', 2);
      s().reviewEnded('r', 3);
      s().approved('r', 4);
      return selectRunEventLogs(s());
    };
    const first = JSON.stringify(run());
    s().reset();
    const second = JSON.stringify(run());
    expect(second).toBe(first);
  });
});
