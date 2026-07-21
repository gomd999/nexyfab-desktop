/**
 * autonomyMetrics.ts — Wave A WA-E: AI 설계 드라이버 자동화율 계측기.
 *
 * 목적 (WAVE_A_AI_DRIVER.md §GA3): "AI가 대부분"은 주장이 아니라 측정이다.
 * design-partner 실측 전에 측정 도구 자체를 먼저 만든다 — 목표치는 첫 실측
 * 후에만 설정한다(측정 없는 목표는 날조).
 *
 * 설계 원칙:
 *  - 순수 함수 모듈. DB·네트워크·Date.now() 없음 — 모든 타임스탬프는 호출자
 *    주입(atMs). 같은 이벤트 시퀀스 = 같은 수치 (테스트 결정성).
 *  - design-driver의 다른 파일을 import 하지 않는다(동시 트랙 소유권 격리).
 *    이벤트 IR은 구조적 로컬 타입으로 자립하며, WA-A 리포트가 이 타입을
 *    소비하는 방향으로만 결합한다.
 *  - 이상 시퀀스(리뷰 쌍 불일치·시간 역행 등)는 조용히 보정하지 않고
 *    이유와 함께 명시 거부한다 — 잘못 측정된 자동화율은 무측정보다 나쁘다.
 *  - 어떤 수치도 반올림으로 정보를 숨기지 않는다: 집계는 전부 원값(raw)으로
 *    반환하고, 사람이 읽는 표시값(display)은 리포트 계층에서 별도로 만든다.
 *
 * funnel-logger.ts 의 "이벤트 타입은 한 곳에 등록, 집계는 명시 산식" 관례를
 * 읽기 참조했다(코드 의존 없음).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. 이벤트 IR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 런 1건에서 발생 가능한 개입/진행 이벤트. 신규 타입 추가 시 여기 등록하고
 * computeRunAutonomy 의 분기·테스트 fixture 를 함께 갱신한다.
 */
export type AutonomyEventType =
  | 'run_started'
  | 'gate_retry'
  | 'changes_requested'
  | 'rerun'
  | 'human_review_started'
  | 'human_review_ended'
  | 'approved'
  | 'abandoned';

interface AutonomyEventBase {
  /** 발생 시각 (epoch ms). 호출자 주입 — 이 모듈은 시계를 갖지 않는다. */
  atMs: number;
}

/** 드라이버 런 시작. 시퀀스의 첫 이벤트여야 한다. */
export interface RunStartedEvent extends AutonomyEventBase {
  type: 'run_started';
  runId: string;
}

/**
 * 검증 게이트 재시도.
 * initiator='human' 만 개입으로 집계한다 — 드라이버가 스스로 수행한 자동
 * 재시도('auto')는 사람 노동이 아니므로 자동화율을 깎지 않는다. 다만 auto
 * 횟수도 별도 필드로 보존한다(엔진 불안정성 신호).
 */
export interface GateRetryEvent extends AutonomyEventBase {
  type: 'gate_retry';
  /** 실패한 게이트 식별자 (예: 'geometry.watertight', 'dfm', 'interference'). */
  gateId: string;
  /** 재시도 사유 — 게이트가 낸 실패 수치/메시지 요약. */
  reason: string;
  initiator: 'human' | 'auto';
}

/** 검토자가 수정을 요청함 (WA-C 검토 루프의 수정요청 IR과 대응). */
export interface ChangesRequestedEvent extends AutonomyEventBase {
  type: 'changes_requested';
  /** 이 수정요청에 달린 코멘트 수 (>=1 이 정상, 0 허용). */
  commentCount: number;
}

/** 수정요청/재시도 후 드라이버 재실행. */
export interface RerunEvent extends AutonomyEventBase {
  type: 'rerun';
}

/** 사람 검토 세션 시작. ended 와 반드시 쌍을 이룬다. */
export interface HumanReviewStartedEvent extends AutonomyEventBase {
  type: 'human_review_started';
}

/** 사람 검토 세션 종료. started 와 반드시 쌍을 이룬다. */
export interface HumanReviewEndedEvent extends AutonomyEventBase {
  type: 'human_review_ended';
}

/** 최종 승인 (WA-C: main 머지). */
export interface ApprovedEvent extends AutonomyEventBase {
  type: 'approved';
}

/** 런 폐기 — 승인 없이 종료. */
export interface AbandonedEvent extends AutonomyEventBase {
  type: 'abandoned';
}

export type AutonomyEvent =
  | RunStartedEvent
  | GateRetryEvent
  | ChangesRequestedEvent
  | RerunEvent
  | HumanReviewStartedEvent
  | HumanReviewEndedEvent
  | ApprovedEvent
  | AbandonedEvent;

// ─────────────────────────────────────────────────────────────────────────────
// 2. 런 단위 집계
// ─────────────────────────────────────────────────────────────────────────────

export type RunFinalStatus = 'approved' | 'abandoned' | 'in_progress';

export interface RunAutonomy {
  runId: string;
  /**
   * 개입 횟수 = changes_requested 수 + 사람이 발화한 gate_retry 수.
   * 자동 gate_retry 는 포함하지 않는다 (GateRetryEvent JSDoc 참조).
   */
  interventionCount: number;
  changesRequestedCount: number;
  manualGateRetryCount: number;
  /** 개입은 아니지만 엔진 안정성 신호로 보존. */
  autoGateRetryCount: number;
  /** changes_requested 이벤트들의 commentCount 합. */
  totalCommentCount: number;
  rerunCount: number;
  /** 완결된 검토 세션(start/end 쌍) 수. */
  reviewSessionCount: number;
  /** 검토 소요 합 (ms) — 각 start/end 쌍의 (end-start) 합산. 원값. */
  reviewDurationMs: number;
  finalStatus: RunFinalStatus;
  /**
   * zero-touch = 개입 0회 **그리고** 최종 승인.
   * 개입 0회라도 abandoned 런을 zero-touch 로 치면 "사람이 버린 실패"가
   * 자동화 성공으로 둔갑하므로 승인 조건을 요구한다.
   */
  zeroTouch: boolean;
}

export type RunAutonomyResult =
  | { ok: true; run: RunAutonomy }
  | { ok: false; reason: string };

/**
 * 이벤트 시퀀스 1건 → 런 집계.
 *
 * 명시 거부(ok:false) 조건 — 보정·추측 없이 이유를 반환한다:
 *  - 빈 시퀀스 / 첫 이벤트가 run_started 가 아님 / run_started 중복
 *  - 타임스탬프 역행 (앞 이벤트보다 이른 atMs) — 정렬로 조용히 고치면
 *    리뷰 쌍 매칭이 왜곡될 수 있어 거부한다
 *  - 리뷰 쌍 불일치: end 가 열린 start 없이 등장 / start 중첩(이미 열려
 *    있는데 다시 start) / 시퀀스 종료 시점에 닫히지 않은 start
 *  - approved 와 abandoned 가 동시 존재, 또는 종결 이벤트 뒤에 추가 이벤트
 */
export function computeRunAutonomy(events: readonly AutonomyEvent[]): RunAutonomyResult {
  if (events.length === 0) {
    return { ok: false, reason: 'empty event sequence: nothing to measure' };
  }
  const first = events[0];
  if (first.type !== 'run_started') {
    return { ok: false, reason: `first event must be run_started, got '${first.type}'` };
  }

  let changesRequestedCount = 0;
  let manualGateRetryCount = 0;
  let autoGateRetryCount = 0;
  let totalCommentCount = 0;
  let rerunCount = 0;
  let reviewSessionCount = 0;
  let reviewDurationMs = 0;
  let openReviewStartMs: number | null = null;
  let finalStatus: RunFinalStatus = 'in_progress';
  let prevAtMs = -Infinity;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.atMs < prevAtMs) {
      return {
        ok: false,
        reason: `out-of-order timestamp at index ${i}: ${ev.atMs} < ${prevAtMs} (events must be non-decreasing in atMs)`,
      };
    }
    prevAtMs = ev.atMs;

    if (finalStatus !== 'in_progress') {
      return {
        ok: false,
        reason: `event '${ev.type}' at index ${i} occurs after terminal '${finalStatus}' event`,
      };
    }

    switch (ev.type) {
      case 'run_started':
        if (i !== 0) {
          return { ok: false, reason: `duplicate run_started at index ${i}` };
        }
        break;
      case 'gate_retry':
        if (ev.initiator === 'human') manualGateRetryCount++;
        else autoGateRetryCount++;
        break;
      case 'changes_requested':
        changesRequestedCount++;
        totalCommentCount += ev.commentCount;
        break;
      case 'rerun':
        rerunCount++;
        break;
      case 'human_review_started':
        if (openReviewStartMs !== null) {
          return {
            ok: false,
            reason: `human_review_started at index ${i} while a review session is already open (nested sessions are not a thing we can time)`,
          };
        }
        openReviewStartMs = ev.atMs;
        break;
      case 'human_review_ended':
        if (openReviewStartMs === null) {
          return {
            ok: false,
            reason: `human_review_ended at index ${i} with no matching human_review_started`,
          };
        }
        reviewSessionCount++;
        reviewDurationMs += ev.atMs - openReviewStartMs;
        openReviewStartMs = null;
        break;
      case 'approved':
        finalStatus = 'approved';
        break;
      case 'abandoned':
        finalStatus = 'abandoned';
        break;
    }
  }

  if (openReviewStartMs !== null) {
    return {
      ok: false,
      reason: `unclosed review session: human_review_started at ${openReviewStartMs} has no human_review_ended (duration would be a guess, refusing)`,
    };
  }

  const interventionCount = changesRequestedCount + manualGateRetryCount;
  return {
    ok: true,
    run: {
      runId: first.runId,
      interventionCount,
      changesRequestedCount,
      manualGateRetryCount,
      autoGateRetryCount,
      totalCommentCount,
      rerunCount,
      reviewSessionCount,
      reviewDurationMs,
      finalStatus,
      zeroTouch: interventionCount === 0 && finalStatus === 'approved',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 배치(부품군) 단위 집계
// ─────────────────────────────────────────────────────────────────────────────

/** 통계적 신뢰를 논하기 시작할 최소 표본 수. 미만이면 lowSample=true. */
export const MIN_SAMPLE_SIZE = 5;

export interface BatchAutonomy {
  /** 표본 수 (런 개수). 모든 소비자는 이 값과 함께 수치를 인용해야 한다. */
  sampleSize: number;
  /**
   * n < MIN_SAMPLE_SIZE(5) 이면 true. 수치는 그대로 반환하되 "신뢰 낮음"
   * 라벨을 강제한다 — 숨기는 게 아니라 표본과 함께 명시하는 정책.
   */
  lowSample: boolean;
  /**
   * zero-touch rate = zeroTouch 런 수 / 전체 런 수. 원값(0..1), 반올림 없음.
   * n=0 이면 null (0% 로 날조하지 않음).
   */
  zeroTouchRate: number | null;
  zeroTouchCount: number;
  /** 평균 개입 횟수 = Σ interventionCount / n. n=0 → null. */
  meanInterventionCount: number | null;
  totalInterventionCount: number;
  /**
   * 중앙값 검토 시간 (ms) — **검토 세션이 1회 이상 있었던 런들만** 대상.
   * 검토가 아예 없던 런(예: 즉시 abandoned)을 0ms 로 섞으면 "검토가 빨랐다"
   * 로 왜곡되므로 제외하고, 대상 런 수를 reviewedRunCount 로 명시한다.
   * 짝수 표본의 중앙값 = 가운데 두 값의 산술평균(비정수 가능, 원값 유지).
   * 검토 런 0건 → null.
   */
  medianReviewDurationMs: number | null;
  reviewedRunCount: number;
  meanRerunCount: number | null;
  totalRerunCount: number;
  approvedCount: number;
  abandonedCount: number;
  inProgressCount: number;
}

/**
 * 부품군(런 배열) → 배치 집계.
 *
 * ## 자동화율 산식 정의와 선택 근거
 *
 * 단일 "자동화율 %"로 합성하지 않고 세 축을 병렬 보고한다:
 *
 *  1. **zero-touch rate** = (개입 0회 & 승인된 런) / 전체 런.
 *     "AI가 사람 노동 없이 끝까지 간 비율" — §GA3 의 핵심 질문에 가장
 *     직접 대응하는 수치.
 *  2. **평균 개입 횟수** = Σ(changes_requested + 수동 gate_retry) / n.
 *     zero-touch 가 아니어도 개입 1회와 7회는 다르다 — 개입의 깊이를 잡는다.
 *  3. **중앙값 검토 시간** = 검토가 있었던 런들의 reviewDurationMs 중앙값.
 *     개입 횟수가 0이어도 사람이 30분을 들여다봤다면 그만큼 사람 비용이다.
 *     평균 대신 중앙값인 이유: 검토 시간은 한두 개 장기 세션이 평균을
 *     지배하는 우측 꼬리 분포가 예상되어, 대표값으로는 중앙값이 강건하다
 *     (평균이 필요한 소비자는 raw 배열을 직접 집계할 것).
 *
 * 세 축을 하나의 점수로 합치지 않는 근거: 가중치 선택 자체가 목표치 설정과
 * 같은 문제 — design-partner 첫 실측 전에는 어떤 가중치도 근거가 없다
 * (feedback_metric_design: 단일 합성 점수 금지, 차원별 분리). 첫 실측 후
 * 목표치를 정할 때도 축별로 정한다.
 */
export function computeBatchAutonomy(runs: readonly RunAutonomy[]): BatchAutonomy {
  const n = runs.length;
  const zeroTouchCount = runs.filter(r => r.zeroTouch).length;
  const totalInterventionCount = runs.reduce((s, r) => s + r.interventionCount, 0);
  const totalRerunCount = runs.reduce((s, r) => s + r.rerunCount, 0);
  const reviewed = runs.filter(r => r.reviewSessionCount > 0);

  return {
    sampleSize: n,
    lowSample: n < MIN_SAMPLE_SIZE,
    zeroTouchRate: n === 0 ? null : zeroTouchCount / n,
    zeroTouchCount,
    meanInterventionCount: n === 0 ? null : totalInterventionCount / n,
    totalInterventionCount,
    medianReviewDurationMs: median(reviewed.map(r => r.reviewDurationMs)),
    reviewedRunCount: reviewed.length,
    meanRerunCount: n === 0 ? null : totalRerunCount / n,
    totalRerunCount,
    approvedCount: runs.filter(r => r.finalStatus === 'approved').length,
    abandonedCount: runs.filter(r => r.finalStatus === 'abandoned').length,
    inProgressCount: runs.filter(r => r.finalStatus === 'in_progress').length,
  };
}

/** 중앙값. 빈 배열 → null. 짝수 길이 → 가운데 두 값의 산술평균(원값). */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 리포트 직렬화 — 원값(raw) + 표시값(display) 분리
// ─────────────────────────────────────────────────────────────────────────────

export interface AutonomyReport {
  /** 무손실 원값. 어떤 소비자든 여기서 다시 계산할 수 있다. */
  raw: BatchAutonomy;
  /**
   * 사람용 표시 문자열. 반올림은 여기서만 일어나며(비율 소수 1자리,
   * 시간 초 단위 소수 1자리), raw 가 항상 함께 실려 정보 손실이 없다.
   */
  display: {
    zeroTouchRate: string;
    meanInterventionCount: string;
    medianReviewDuration: string;
    sample: string;
  };
  /** 여러 줄 사람용 요약. lowSample 시 경고 라인이 포함된다. */
  summaryText: string;
}

/** ms → "123456 ms (2.1 min)" — 원값 ms 를 표시 문자열 안에도 남긴다. */
function formatDurationMs(ms: number): string {
  const minutes = ms / 60_000;
  return `${ms} ms (${minutes.toFixed(1)} min)`;
}

export function buildAutonomyReport(batch: BatchAutonomy): AutonomyReport {
  const display = {
    zeroTouchRate:
      batch.zeroTouchRate === null
        ? 'n/a (no runs)'
        : `${(batch.zeroTouchRate * 100).toFixed(1)}% (${batch.zeroTouchCount}/${batch.sampleSize})`,
    meanInterventionCount:
      batch.meanInterventionCount === null
        ? 'n/a (no runs)'
        : `${batch.meanInterventionCount.toFixed(2)} per run (${batch.totalInterventionCount}/${batch.sampleSize})`,
    medianReviewDuration:
      batch.medianReviewDurationMs === null
        ? 'n/a (no reviewed runs)'
        : `${formatDurationMs(batch.medianReviewDurationMs)} over ${batch.reviewedRunCount} reviewed run(s)`,
    sample: `n=${batch.sampleSize}${batch.lowSample ? ` (LOW — below ${MIN_SAMPLE_SIZE})` : ''}`,
  };

  const lines = [
    `Autonomy report — sample ${display.sample}`,
    `  zero-touch rate:        ${display.zeroTouchRate}`,
    `  mean interventions:     ${display.meanInterventionCount}`,
    `  median review duration: ${display.medianReviewDuration}`,
    `  outcomes: approved=${batch.approvedCount} abandoned=${batch.abandonedCount} in_progress=${batch.inProgressCount}`,
    `  reruns: total=${batch.totalRerunCount}`,
  ];
  if (batch.lowSample) {
    lines.push(
      `  ⚠ low sample (n=${batch.sampleSize} < ${MIN_SAMPLE_SIZE}): numbers above are reported but not statistically reliable.`,
    );
  }

  return { raw: batch, display, summaryText: lines.join('\n') };
}

/** JSON 직렬화 — raw/display/summaryText 전부 포함, 무손실. */
export function serializeAutonomyReport(report: AutonomyReport): string {
  return JSON.stringify(report, null, 2);
}
