/**
 * autonomySessionStore.ts — Wave A · WA-E / §GA3 자동화율 실측 세션 스토어.
 *
 * autonomyMetrics.ts 는 "이벤트 시퀀스 → 수치"를 계산하는 순수 계측기다. 이
 * 스토어는 그 계측기에 먹일 이벤트를 **실 사용자 UI 액션에서만** 수집하는
 * 클라이언트 세션 저장소다. (sessionRepoStore.ts 의 zustand 관례를 따른다.)
 *
 * 정직 원칙 (랜딩 mock/허위 금지):
 *   - 이벤트는 실제 UI 액션(설계 브리프 제출·리뷰 열람/승인/수정요청)에서만
 *     방출된다. 가짜 주입 API 는 없다 — 오직 아래 emitter 들뿐이고, 각 emitter
 *     는 패널의 실 액션 핸들러에서만 호출된다.
 *   - 파트너 세션(GA3) 전에는 아무 액션도 없으므로 runs 는 비어 있고, 대시보드는
 *     "측정 없음(n=0)"을 표시한다. 이 스토어는 **측정 준비**이지 측정 자체가
 *     아니다 — 실 zero-touch 수치는 파트너 세션에서만 나온다.
 *   - 타임스탬프는 런타임 실시각(clock()=Date.now)이다. 단 테스트가 결정론적일
 *     수 있도록 clock 은 주입 가능하고, 모든 emitter 는 atMs 를 직접 받을 수도
 *     있다(주입 시 실시각 대신 사용).
 *
 * 계측기와의 결합은 단방향이다: 스토어는 AutonomyEvent 를 **축적만** 하고,
 * 어떤 집계도 하지 않는다(집계는 computeRunAutonomy/computeBatchAutonomy 소관).
 * 대시보드는 selectRunEventLogs 로 런별 로그를 받아 스스로 계측한다.
 */

import { create } from 'zustand';
import type {
  AutonomyEvent,
} from '@/lib/ai/design-driver/autonomyMetrics';

/** Injectable time source. Date.now() in the app; fixed values in tests. */
export type Clock = () => number;

export interface AutonomySessionState {
  /**
   * 런별 이벤트 로그. key=runId, 값=방출 순서 그대로의 AutonomyEvent 배열.
   * 각 배열의 첫 이벤트는 항상 run_started 다 (emitter 가 보장 — 아래 참조).
   */
  runs: Record<string, readonly AutonomyEvent[]>;
  /** runId 삽입 순서 — 대시보드가 런을 결정론적으로 나열하도록 보존. */
  runOrder: readonly string[];
  /** 시계. 앱에서는 Date.now, 테스트에서는 주입. */
  clock: Clock;

  // ── emitter: 실 UI 액션에서만 호출된다 (가짜 주입 없음) ──────────────────────
  //   atMs 를 넘기면 그 값을, 아니면 clock() 을 타임스탬프로 쓴다.
  //   run_started 가 아직 없는 run 에 대해 다른 이벤트가 오면, 그 run 을 처음
  //   관측한 시점으로 run_started 를 자동 시딩한다(계측기가 요구하는 "첫 이벤트=
  //   run_started" 불변식 충족). 이는 설계-브리프 런과 리뷰-큐 런(PDM runId)이
  //   서로 다른 표면에서 진입해도 각 시퀀스가 유효하도록 만든다.

  /** 드라이버 런 시작 (설계 브리프 제출). 이미 시작된 run 이면 무연산(중복 금지). */
  runStarted: (runId: string, atMs?: number) => void;
  /** 검증 게이트 재시도. initiator='human' 만 개입으로 집계됨(계측기 소관). */
  gateRetry: (
    runId: string,
    gateId: string,
    reason: string,
    initiator: 'human' | 'auto',
    atMs?: number,
  ) => void;
  /** 검토자가 수정을 요청함 (리뷰 큐의 수정요청). */
  changesRequested: (runId: string, commentCount: number, atMs?: number) => void;
  /** 수정요청/재시도 후 재실행. */
  rerun: (runId: string, atMs?: number) => void;
  /** 사람 검토 세션 시작 (리뷰 큐에서 런 열람). */
  reviewStarted: (runId: string, atMs?: number) => void;
  /** 사람 검토 세션 종료 (런 접기/승인/수정요청으로 상세를 닫음). */
  reviewEnded: (runId: string, atMs?: number) => void;
  /** 최종 승인 (main 머지). 종결 이벤트. */
  approved: (runId: string, atMs?: number) => void;
  /** 런 폐기 — 승인 없이 종료 (예: 거부된 브리프). 종결 이벤트. */
  abandoned: (runId: string, atMs?: number) => void;

  /** 테스트/GA3 세션 seam: 시계 교체. */
  setClock: (clock: Clock) => void;
  /** 세션 초기화 — 모든 런 로그 제거. */
  reset: () => void;
}

/**
 * 이벤트 1건을 run 로그에 덧붙인다. run_started 시딩 규칙 포함:
 *   - run 이 처음이면: run_started 이벤트면 그대로 [ev]. 아니면 [seed, ev]
 *     (seed=run_started, 같은 atMs — 첫 관측 시점).
 *   - run 이 이미 있으면: run_started 는 무연산(중복 금지). 그 외는 append.
 *
 * 순수 함수 — set 콜백 안에서만 쓰이며 상태를 직접 변형하지 않는다.
 */
function appendEvent(
  state: Pick<AutonomySessionState, 'runs' | 'runOrder'>,
  runId: string,
  ev: AutonomyEvent,
): Pick<AutonomySessionState, 'runs' | 'runOrder'> {
  const existing = state.runs[runId];
  if (existing === undefined) {
    const seq: AutonomyEvent[] =
      ev.type === 'run_started'
        ? [ev]
        : [{ type: 'run_started', runId, atMs: ev.atMs }, ev];
    return {
      runs: { ...state.runs, [runId]: seq },
      runOrder: [...state.runOrder, runId],
    };
  }
  if (ev.type === 'run_started') {
    // 이미 시작된 런 — run_started 중복 금지(계측기가 거부하는 시퀀스가 됨).
    return state;
  }
  return {
    runs: { ...state.runs, [runId]: [...existing, ev] },
    runOrder: state.runOrder,
  };
}

export const useAutonomySessionStore = create<AutonomySessionState>((set, get) => ({
  runs: {},
  runOrder: [],
  clock: () => Date.now(),

  runStarted: (runId, atMs) =>
    set((s) => appendEvent(s, runId, { type: 'run_started', runId, atMs: atMs ?? s.clock() })),

  gateRetry: (runId, gateId, reason, initiator, atMs) =>
    set((s) =>
      appendEvent(s, runId, {
        type: 'gate_retry',
        gateId,
        reason,
        initiator,
        atMs: atMs ?? s.clock(),
      }),
    ),

  changesRequested: (runId, commentCount, atMs) =>
    set((s) =>
      appendEvent(s, runId, {
        type: 'changes_requested',
        commentCount,
        atMs: atMs ?? s.clock(),
      }),
    ),

  rerun: (runId, atMs) =>
    set((s) => appendEvent(s, runId, { type: 'rerun', atMs: atMs ?? s.clock() })),

  reviewStarted: (runId, atMs) =>
    set((s) => appendEvent(s, runId, { type: 'human_review_started', atMs: atMs ?? s.clock() })),

  reviewEnded: (runId, atMs) =>
    set((s) => appendEvent(s, runId, { type: 'human_review_ended', atMs: atMs ?? s.clock() })),

  approved: (runId, atMs) =>
    set((s) => appendEvent(s, runId, { type: 'approved', atMs: atMs ?? s.clock() })),

  abandoned: (runId, atMs) =>
    set((s) => appendEvent(s, runId, { type: 'abandoned', atMs: atMs ?? s.clock() })),

  setClock: (clock) => set({ clock }),

  reset: () => set({ runs: {}, runOrder: [] }),
}));

/**
 * 런별 이벤트 로그를 삽입 순서대로 반환 — AutonomyDashboardPanel 의
 * `runEventLogs` prop 형태(런당 이벤트 배열의 배열).
 *
 * ⚠ 새 배열을 만들므로 zustand selector 로 직접 쓰면 매 렌더 재구독 경고가 난다.
 * 훅에서는 runs·runOrder 를 각각 구독한 뒤 useMemo 로 조립하라
 * (AutonomyDashboardConnected 참조). 이 헬퍼는 비-훅/테스트용이다.
 */
export function selectRunEventLogs(
  state: Pick<AutonomySessionState, 'runs' | 'runOrder'>,
): readonly (readonly AutonomyEvent[])[] {
  return state.runOrder.map((id) => state.runs[id]!);
}
