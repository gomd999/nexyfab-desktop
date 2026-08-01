/**
 * pipeline-trace — **파이프라인이 무엇을 했는지 응답에 싣는다** (260801, 격차 W1).
 *
 * ## 왜 필요한가 — 계산해 놓고 안 내보내고 있었다
 * 우리 파이프라인은 이미 단계가 나뉘어 있고 자동 수정 루프도 돈다. 그런데:
 * ```
 *   repairRounds   계산 → **평가 하네스까지만** 감 (API·화면엔 없음)
 *   stage          **실패 응답에만** 있음 — 성공하면 아무 과정도 안 알려 줌
 *   소요 시간       측정은 하는데 응답에 없음
 * ```
 * 사용자는 「됐다/안 됐다」만 본다. **한 번에 됐는지, 두 번 고쳐서 됐는지 구별할 수 없다.**
 *
 * ## ⚠ 이것은 자랑이 아니라 고지다
 * 시도 횟수를 보여 주는 것은 「2번 만에 해냈다」가 아니라 **「1번에는 안 됐다」**이기도 하다.
 * 숨기지 않는 것이 목적이다 — 그래야 사용자가 결과를 얼마나 믿을지 정한다.
 *
 * ## 세 상태를 구별한다
 * ```
 *   ok       그 단계를 수행했고 통과했다
 *   failed   수행했고 실패했다
 *   skipped  **수행하지 않았다** — ok 가 아니다
 * ```
 * ⚠ 건너뛴 단계를 `ok` 로 적으면 「검사했고 문제없음」으로 읽힌다. 이 저장소가 반복해서
 *   만나 온 착각(「skip 은 통과가 아니다」)을 여기서도 막는다.
 */

export type StageStatus = 'ok' | 'failed' | 'skipped';

export interface PipelineStage {
  /** 단계 이름 — 라우트 간 **같은 이름**을 써야 화면이 하나로 그린다. */
  name: string;
  status: StageStatus;
  /** 이 단계에 걸린 시간(ms). 측정하지 못했으면 생략 — 0 으로 채우지 않는다. */
  ms?: number;
  /** 건너뛰었거나 실패한 이유. 있으면 사용자에게 그대로 보여도 되는 문장. */
  note?: string;
}

export interface PipelineTrace {
  stages: PipelineStage[];
  /**
   * 최종 결과를 얻기까지의 **시도 횟수**. 1 이면 한 번에 됐다는 뜻이다.
   * ⚠ 재시도 로직이 아예 없는 경로에서도 1 을 적는다 — 「재시도했는데 1회」와
   *   「재시도 개념이 없음」을 구별해야 하면 `note` 로 적는다.
   */
  attempts: number;
  /** 전체 소요(ms). */
  elapsedMs: number;
}

/**
 * 단계 기록기. 라우트 시작에서 만들고, 단계마다 `mark`, 끝에서 `done`.
 *
 * ⚠ 시간을 **지어내지 않는다.** `mark` 를 부른 시점 사이의 실제 경과만 적는다.
 */
export class TraceRecorder {
  private readonly t0: number;
  private last: number;
  private readonly out: PipelineStage[] = [];
  private tries = 1;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
    this.t0 = now();
    this.last = this.t0;
  }

  private readonly now: () => number;

  /** 한 단계를 끝냈다고 기록한다. */
  mark(name: string, status: StageStatus = 'ok', note?: string): this {
    const t = this.now();
    this.out.push({ name, status, ms: t - this.last, ...(note ? { note } : {}) });
    this.last = t;
    return this;
  }

  /**
   * 수행하지 않은 단계를 기록한다.
   * ⚠ **이유를 반드시 적는다** — 이유 없는 skip 은 나중에 「왜 안 했지」로 남는다.
   */
  skip(name: string, note: string): this {
    this.out.push({ name, status: 'skipped', note });
    return this;
  }

  /** 자동 수정 등으로 다시 시도했다. */
  attempt(n: number): this {
    this.tries = Math.max(1, Math.floor(n) || 1);
    return this;
  }

  done(): PipelineTrace {
    return { stages: [...this.out], attempts: this.tries, elapsedMs: this.now() - this.t0 };
  }
}

/**
 * 사람이 읽는 한 줄. 화면이 없어도(CLI·MCP) 그대로 쓸 수 있게.
 *
 * ⚠ 실패·건너뜀이 있으면 **먼저** 말한다. 「3.1초 만에 완료」로 시작하면
 *   그 뒤의 경고를 아무도 안 읽는다.
 */
export function traceSummary(t: PipelineTrace, lang: 'ko' | 'en' = 'ko'): string {
  const bad = t.stages.filter((s) => s.status === 'failed');
  const skipped = t.stages.filter((s) => s.status === 'skipped');
  const sec = (t.elapsedMs / 1000).toFixed(1);
  if (lang === 'en') {
    const head = bad.length ? `${bad.length} stage(s) failed` : skipped.length ? `${skipped.length} stage(s) skipped` : 'all stages passed';
    return `${head} · ${t.attempts} attempt${t.attempts > 1 ? 's' : ''} · ${sec}s`;
  }
  const head = bad.length ? `${bad.length}개 단계 실패`
    : skipped.length ? `${skipped.length}개 단계 건너뜀(수행 안 함)`
      : '전 단계 통과';
  const tries = t.attempts > 1 ? `${t.attempts}번째 시도에 성공` : '한 번에 성공';
  return `${head} · ${tries} · ${sec}초`;
}
