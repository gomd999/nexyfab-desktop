/**
 * autonomyMetrics.test.ts — WA-E 자동화율 계측기 결정론 테스트.
 *
 * 모든 fixture 는 타임스탬프 하드코딩(호출자 주입) — Date.now() 불사용.
 * 배치 집계 기대값은 전부 주석에 손계산을 병기한다.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRunAutonomy,
  computeBatchAutonomy,
  buildAutonomyReport,
  serializeAutonomyReport,
  MIN_SAMPLE_SIZE,
  type AutonomyEvent,
  type RunAutonomy,
} from './autonomyMetrics';

/** ok 를 단언하고 RunAutonomy 를 꺼낸다 — 실패 시 이유를 그대로 노출. */
function mustRun(events: AutonomyEvent[]): RunAutonomy {
  const res = computeRunAutonomy(events);
  if (!res.ok) throw new Error(`expected ok run, got rejection: ${res.reason}`);
  return res.run;
}

// ── fixture 시퀀스 ───────────────────────────────────────────────────────────

/** A: zero-touch — 개입 0, 검토 1회 60,000ms, 승인. */
const RUN_A: AutonomyEvent[] = [
  { type: 'run_started', runId: 'run-A', atMs: 1_000 },
  { type: 'human_review_started', atMs: 2_000 },
  { type: 'human_review_ended', atMs: 62_000 }, // 60,000ms
  { type: 'approved', atMs: 63_000 },
];

/** B: 개입 2회(수정요청 1 + 수동 게이트 재시도 1) + 자동 재시도 1 + 재실행 2. */
const RUN_B: AutonomyEvent[] = [
  { type: 'run_started', runId: 'run-B', atMs: 0 },
  { type: 'gate_retry', atMs: 50, gateId: 'dfm', reason: 'min wall 0.8mm < 1.2mm', initiator: 'auto' },
  { type: 'human_review_started', atMs: 100 },
  { type: 'changes_requested', atMs: 200, commentCount: 3 },
  { type: 'human_review_ended', atMs: 400 }, // 세션1 = 300ms
  { type: 'rerun', atMs: 500 },
  { type: 'gate_retry', atMs: 600, gateId: 'geometry.watertight', reason: 'open shell after boolean', initiator: 'human' },
  { type: 'rerun', atMs: 700 },
  { type: 'human_review_started', atMs: 800 },
  { type: 'human_review_ended', atMs: 1_300 }, // 세션2 = 500ms
  { type: 'approved', atMs: 1_400 },
];

/** C: 버려진 런 — 개입 0이지만 승인 없음 → zero-touch 아님. 검토 15ms. */
const RUN_C: AutonomyEvent[] = [
  { type: 'run_started', runId: 'run-C', atMs: 0 },
  { type: 'human_review_started', atMs: 10 },
  { type: 'human_review_ended', atMs: 25 }, // 15ms
  { type: 'abandoned', atMs: 30 },
];

/** D: zero-touch, 검토 2,000ms. */
const RUN_D: AutonomyEvent[] = [
  { type: 'run_started', runId: 'run-D', atMs: 0 },
  { type: 'human_review_started', atMs: 100 },
  { type: 'human_review_ended', atMs: 2_100 }, // 2,000ms
  { type: 'approved', atMs: 2_200 },
];

/** E: 개입 1회(수정요청), 검토 1,000ms, 승인. */
const RUN_E: AutonomyEvent[] = [
  { type: 'run_started', runId: 'run-E', atMs: 0 },
  { type: 'human_review_started', atMs: 100 },
  { type: 'changes_requested', atMs: 500, commentCount: 1 },
  { type: 'human_review_ended', atMs: 1_100 }, // 1,000ms
  { type: 'approved', atMs: 1_200 },
];

// ── 런 단위 ─────────────────────────────────────────────────────────────────

describe('computeRunAutonomy — 정상 시퀀스', () => {
  it('zero-touch 런: 개입 0·검토 60000ms·승인', () => {
    const run = mustRun(RUN_A);
    expect(run.runId).toBe('run-A');
    expect(run.interventionCount).toBe(0);
    expect(run.changesRequestedCount).toBe(0);
    expect(run.manualGateRetryCount).toBe(0);
    expect(run.autoGateRetryCount).toBe(0);
    expect(run.rerunCount).toBe(0);
    expect(run.reviewSessionCount).toBe(1);
    expect(run.reviewDurationMs).toBe(60_000); // 62_000 - 2_000
    expect(run.finalStatus).toBe('approved');
    expect(run.zeroTouch).toBe(true);
  });

  it('개입 2회 런: 수정요청1+수동재시도1, 자동재시도는 개입 미포함', () => {
    const run = mustRun(RUN_B);
    expect(run.changesRequestedCount).toBe(1);
    expect(run.manualGateRetryCount).toBe(1);
    expect(run.autoGateRetryCount).toBe(1);
    expect(run.interventionCount).toBe(2); // 1 + 1 (auto 제외)
    expect(run.totalCommentCount).toBe(3);
    expect(run.rerunCount).toBe(2);
    expect(run.reviewSessionCount).toBe(2);
    expect(run.reviewDurationMs).toBe(800); // (400-100) + (1300-800) = 300 + 500
    expect(run.finalStatus).toBe('approved');
    expect(run.zeroTouch).toBe(false);
  });

  it('버려진 런: 개입 0이어도 zero-touch 아님', () => {
    const run = mustRun(RUN_C);
    expect(run.interventionCount).toBe(0);
    expect(run.finalStatus).toBe('abandoned');
    expect(run.zeroTouch).toBe(false);
    expect(run.reviewDurationMs).toBe(15);
  });

  it('종결 이벤트 없는 런은 in_progress', () => {
    const run = mustRun([
      { type: 'run_started', runId: 'run-open', atMs: 0 },
      { type: 'human_review_started', atMs: 10 },
      { type: 'human_review_ended', atMs: 20 },
    ]);
    expect(run.finalStatus).toBe('in_progress');
    expect(run.zeroTouch).toBe(false); // 승인 전이므로
  });
});

describe('computeRunAutonomy — 명시 거부', () => {
  it('빈 시퀀스 거부', () => {
    const res = computeRunAutonomy([]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/empty/i);
  });

  it('첫 이벤트가 run_started 가 아니면 거부', () => {
    const res = computeRunAutonomy([{ type: 'approved', atMs: 0 }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/run_started/);
  });

  it('run_started 중복 거부', () => {
    const res = computeRunAutonomy([
      { type: 'run_started', runId: 'x', atMs: 0 },
      { type: 'run_started', runId: 'x2', atMs: 10 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/duplicate run_started/);
  });

  it('쌍 불일치: start 없는 human_review_ended 거부', () => {
    const res = computeRunAutonomy([
      { type: 'run_started', runId: 'x', atMs: 0 },
      { type: 'human_review_ended', atMs: 100 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no matching human_review_started/);
  });

  it('쌍 불일치: 닫히지 않은 human_review_started 거부', () => {
    const res = computeRunAutonomy([
      { type: 'run_started', runId: 'x', atMs: 0 },
      { type: 'human_review_started', atMs: 100 },
      { type: 'approved', atMs: 200 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unclosed review session/);
  });

  it('쌍 불일치: 중첩 human_review_started 거부', () => {
    const res = computeRunAutonomy([
      { type: 'run_started', runId: 'x', atMs: 0 },
      { type: 'human_review_started', atMs: 100 },
      { type: 'human_review_started', atMs: 150 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/already open/);
  });

  it('타임스탬프 역행 거부 (정렬로 조용히 보정하지 않음)', () => {
    const res = computeRunAutonomy([
      { type: 'run_started', runId: 'x', atMs: 1_000 },
      { type: 'rerun', atMs: 500 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/out-of-order/);
  });

  it('종결 이벤트 뒤 추가 이벤트 거부', () => {
    const res = computeRunAutonomy([
      { type: 'run_started', runId: 'x', atMs: 0 },
      { type: 'approved', atMs: 100 },
      { type: 'rerun', atMs: 200 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/after terminal 'approved'/);
  });
});

// ── 배치 단위 ────────────────────────────────────────────────────────────────

describe('computeBatchAutonomy — 손계산 일치', () => {
  it('5런 배치: zero-touch 2/5=0.4·평균개입 3/5=0.6·중앙값검토 1000ms', () => {
    // 손계산:
    //   runs = [A, B, C, D, E]
    //   zeroTouch: A(0개입·승인)✓, B✗(개입2), C✗(abandoned), D✓, E✗(개입1) → 2/5 = 0.4
    //   interventions: 0 + 2 + 0 + 0 + 1 = 3 → mean 3/5 = 0.6
    //   review durations (전 런 검토 있음): [60000, 800, 15, 2000, 1000]
    //     sorted → [15, 800, 1000, 2000, 60000] → median = 1000
    //   reruns: 0+2+0+0+0 = 2 → mean 0.4
    //   approved 4 (A,B,D,E), abandoned 1 (C), in_progress 0
    const runs = [RUN_A, RUN_B, RUN_C, RUN_D, RUN_E].map(mustRun);
    const batch = computeBatchAutonomy(runs);
    expect(batch.sampleSize).toBe(5);
    expect(batch.lowSample).toBe(false); // n=5 는 MIN_SAMPLE_SIZE 이상
    expect(batch.zeroTouchCount).toBe(2);
    expect(batch.zeroTouchRate).toBe(0.4);
    expect(batch.totalInterventionCount).toBe(3);
    expect(batch.meanInterventionCount).toBe(0.6);
    expect(batch.medianReviewDurationMs).toBe(1_000);
    expect(batch.reviewedRunCount).toBe(5);
    expect(batch.totalRerunCount).toBe(2);
    expect(batch.meanRerunCount).toBe(0.4);
    expect(batch.approvedCount).toBe(4);
    expect(batch.abandonedCount).toBe(1);
    expect(batch.inProgressCount).toBe(0);
  });

  it('n<5 배치: 수치는 반환하되 lowSample=true + 표본 명시', () => {
    // 손계산: runs=[A,B,C] → n=3 < 5, zeroTouch 1/3, interventions (0+2+0)/3
    const runs = [RUN_A, RUN_B, RUN_C].map(mustRun);
    const batch = computeBatchAutonomy(runs);
    expect(batch.sampleSize).toBe(3);
    expect(batch.lowSample).toBe(true);
    expect(batch.zeroTouchRate).toBe(1 / 3); // 원값 그대로 — 반올림 없음
    expect(batch.meanInterventionCount).toBe(2 / 3);
    // durations [60000, 800, 15] sorted [15, 800, 60000] → median 800
    expect(batch.medianReviewDurationMs).toBe(800);
  });

  it('짝수 표본 중앙값 = 가운데 두 값의 산술평균', () => {
    // durations: A=60000, B=800 → median = (800 + 60000) / 2 = 30400
    const runs = [RUN_A, RUN_B].map(mustRun);
    const batch = computeBatchAutonomy(runs);
    expect(batch.medianReviewDurationMs).toBe(30_400);
  });

  it('빈 배치: 비율을 0으로 날조하지 않고 null', () => {
    const batch = computeBatchAutonomy([]);
    expect(batch.sampleSize).toBe(0);
    expect(batch.lowSample).toBe(true);
    expect(batch.zeroTouchRate).toBeNull();
    expect(batch.meanInterventionCount).toBeNull();
    expect(batch.medianReviewDurationMs).toBeNull();
  });

  it('검토 없는 런은 중앙값 표본에서 제외 (0ms 왜곡 방지)', () => {
    const noReview = mustRun([
      { type: 'run_started', runId: 'run-nr', atMs: 0 },
      { type: 'abandoned', atMs: 10 },
    ]);
    const withReview = mustRun(RUN_A); // 60000ms
    const batch = computeBatchAutonomy([noReview, withReview]);
    expect(batch.reviewedRunCount).toBe(1);
    expect(batch.medianReviewDurationMs).toBe(60_000); // 0ms 가 섞이면 30000 이 됐을 것
  });
});

// ── 리포트 직렬화 ────────────────────────────────────────────────────────────

describe('buildAutonomyReport / serializeAutonomyReport', () => {
  it('raw 는 무손실 원값, display 는 별도 표시값', () => {
    const runs = [RUN_A, RUN_B, RUN_C].map(mustRun);
    const report = buildAutonomyReport(computeBatchAutonomy(runs));
    // raw: 반올림 없는 원값 그대로
    expect(report.raw.zeroTouchRate).toBe(1 / 3);
    expect(report.raw.meanInterventionCount).toBe(2 / 3);
    // display: 반올림은 여기서만, 분자/분모 병기로 정보 보존
    expect(report.display.zeroTouchRate).toBe('33.3% (1/3)');
    expect(report.display.meanInterventionCount).toBe('0.67 per run (2/3)');
    expect(report.display.medianReviewDuration).toContain('800 ms');
    expect(report.display.sample).toBe(`n=3 (LOW — below ${MIN_SAMPLE_SIZE})`);
  });

  it('lowSample 시 요약 문자열에 경고 라인 포함', () => {
    const runs = [RUN_A].map(mustRun);
    const report = buildAutonomyReport(computeBatchAutonomy(runs));
    expect(report.summaryText).toContain('low sample (n=1');
    expect(report.summaryText).toContain('zero-touch rate');
  });

  it('n>=5 이면 경고 라인 없음', () => {
    const runs = [RUN_A, RUN_B, RUN_C, RUN_D, RUN_E].map(mustRun);
    const report = buildAutonomyReport(computeBatchAutonomy(runs));
    expect(report.summaryText).not.toContain('low sample');
    expect(report.display.zeroTouchRate).toBe('40.0% (2/5)');
  });

  it('JSON 직렬화 왕복: raw 수치 보존', () => {
    const runs = [RUN_A, RUN_B, RUN_C, RUN_D, RUN_E].map(mustRun);
    const report = buildAutonomyReport(computeBatchAutonomy(runs));
    const parsed = JSON.parse(serializeAutonomyReport(report)) as typeof report;
    expect(parsed.raw).toEqual(report.raw);
    expect(parsed.summaryText).toBe(report.summaryText);
    expect(parsed.raw.medianReviewDurationMs).toBe(1_000);
  });
});
