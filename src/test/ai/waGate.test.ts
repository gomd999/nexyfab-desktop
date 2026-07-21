/**
 * waGate.test.ts — Wave A 게이트 GA1·GA2 실행형 실증.
 *
 * WAVE_A_AI_DRIVER.md §3:
 *   GA1(드라이버): fixture 계획이 전 게이트 통과 패키지를 산출하고,
 *     실패 주입은 명시 거부. (개별 실증은 design-driver의 fixtures/
 *     failures 스위트 — 여기서는 게이트 문장을 대표 케이스로 재실행.)
 *   GA2(검토 루프): AI 커밋→검토→승인/수정요청→재실행이 한 사이클로
 *     실행되고, 게이트 실패물은 사람 승인으로도 main에 들어갈 수 없다.
 *
 * 이 파일은 두 게이트를 **하나의 이어진 사이클**로 실행한다:
 * 드라이버 실행(실측 게이트 체인) → 리뷰 큐 기록(ai/<runId> 브랜치) →
 * 수정요청(RevisionDirective) → 재실행 → 승인(2-parent 머지) → 자동화율
 * 계측까지. GA3(design-partner 자동화율 실측)는 코드로 통과 불가 —
 * 여기의 계측은 도구 검증이지 GA3 판정이 아니다.
 *
 * 정직 노트: 드라이버 산출물(바디)→PDM FeatureInstance 스냅샷 변환은 이
 * 하네스의 로컬 어댑터로 수행한다 — 실제 제품 어댑터는 WA-D(표면)에서
 * 확정한다(여기서는 사이클 계약을 검증).
 */
import { describe, it, expect } from 'vitest';
import {
  runDesignDriver,
  fixturePlanner,
  type DriverResult,
} from '@/lib/ai/design-driver';
import {
  computeRunAutonomy,
  type AutonomyEvent,
} from '@/lib/ai/design-driver/autonomyMetrics';
import { VersionRepo } from '@/app/[lang]/shape-generator/pdm/versionBranch';
import {
  recordAiRun,
  approveRun,
  buildRevisionDirective,
  type VerificationReportLike,
} from '@/app/[lang]/shape-generator/pdm/reviewQueue';
import type { FeatureInstance } from '@/app/[lang]/shape-generator/features/types';

// ─── 로컬 어댑터 (하네스 전용 — 헤더 정직 노트 참조) ─────────────────────

function runToFeatures(runId: string, res: Extract<DriverResult, { ok: true }>): FeatureInstance[] {
  return res.package.parts.map((p) => ({
    id: `${runId}:${p.partId}`,
    type: 'shell',
    params: { dimensionCount: p.dimensions.length },
    enabled: true,
  }));
}

function reportOf(res: DriverResult): VerificationReportLike {
  return { gates: res.gates.map((g) => ({ id: g.id, pass: g.pass, reason: g.reason })) };
}

const REVIEWER = 'partner-reviewer';
const AI = 'design-driver';

async function runBracket(): Promise<DriverResult> {
  return runDesignDriver({ id: 'l-bracket', text: 'fixture l-bracket' }, { planner: fixturePlanner });
}

describe('Wave A gates — GA1 driver package + GA2 review cycle (executed)', () => {
  it('GA1: bracket brief → all gates pass → package with measured dims + DXF', async () => {
    const res = await runBracket();
    if (!res.ok) throw new Error(`driver refused: ${res.refusal.reason}`);
    expect(res.gates.length).toBeGreaterThanOrEqual(3);
    for (const g of res.gates) {
      expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);
    }
    expect(res.package.report.allPassed).toBe(true);
    const part = res.package.parts[0]!;
    expect(part.dimensions.length).toBeGreaterThan(0);
    expect(part.dxf).toContain('60');
    expect(part.dxf).not.toContain('NEXYFAB_DIM_UNMEASURED');
    // 한계 명시가 리포트에 실존(정직 고지의 제품화).
    expect(res.package.report.limitations.length).toBeGreaterThan(0);
  });

  it('GA1(거부): 미지 브리프 → 계획 단계 명시 거부(추측 없음)', async () => {
    const res = await runDesignDriver(
      { id: 'ga1-unknown-part', text: 'something the fixture planner does not know' },
      { planner: fixturePlanner },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
  });

  it('GA2: 커밋→수정요청→재실행→승인(2-parent 머지) + 게이트 실패물 승인 불가 + 자동화율 계측', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const events: AutonomyEvent[] = [];
    let t = 0;
    const at = () => (t += 1_000);

    // 1) 1차 실행 → 큐 기록.
    events.push({ type: 'run_started', atMs: at(), runId: 'run-1' });
    const run1 = await runBracket();
    if (!run1.ok) throw new Error('run-1 must pass');
    const rec1 = recordAiRun(repo, {
      runId: 'run-1', briefSummary: 'bracket v1', author: AI,
      features: runToFeatures('run-1', run1),
      report: reportOf(run1),
    });
    expect(rec1.branchName).toBe('ai/run-1');
    expect(rec1.status).toBe('pending');

    // 2) 검토자 수정요청 → RevisionDirective가 다음 실행 입력.
    events.push({ type: 'human_review_started', atMs: at() });
    const directive = buildRevisionDirective(rec1, [
      { featureId: 'run-1:bracket', note: 'flange face needs a chamfer note' },
    ]);
    events.push({ type: 'changes_requested', atMs: at(), commentCount: directive.comments.length });
    events.push({ type: 'human_review_ended', atMs: at() });
    expect(directive.kind).toBe('revision_directive');
    expect(directive.baseCommitId).toBe(rec1.commitId);
    expect(directive.comments[0]!.note).toContain('chamfer');

    // 3) 재실행 → 새 run 기록 → 승인 = main 2-parent 머지.
    events.push({ type: 'rerun', atMs: at() });
    const run2 = await runBracket();
    if (!run2.ok) throw new Error('run-2 must pass');
    const rec2 = recordAiRun(repo, {
      runId: 'run-2', briefSummary: 'bracket v2 (revised)', author: AI,
      features: runToFeatures('run-2', run2),
      report: reportOf(run2),
    });
    events.push({ type: 'human_review_started', atMs: at() });
    const approved = approveRun(repo, rec2, REVIEWER);
    events.push({ type: 'human_review_ended', atMs: at() });
    events.push({ type: 'approved', atMs: at() });
    if (!approved.ok) throw new Error(`approve failed: ${approved.reason}`);
    expect(approved.mergeCommit.parents).toHaveLength(2);
    expect(approved.mergeCommit.parents).toContain(rec2.commitId);

    // 4) 게이트 실패물은 사람 승인으로도 main 진입 불가.
    const recFail = recordAiRun(repo, {
      runId: 'run-fail', briefSummary: 'broken', author: AI,
      features: [{ id: 'run-fail:x', type: 'shell', params: {}, enabled: true }],
      report: { gates: [{ id: 'geometry.volume', pass: false, value: 0, reason: 'degenerate profile' }] },
    });
    const blocked = approveRun(repo, recFail, REVIEWER);
    expect(blocked.ok).toBe(false);
    if (blocked.ok || blocked.reason !== 'gate_failed') {
      throw new Error(`expected gate_failed, got ${JSON.stringify(blocked)}`);
    }
    expect(blocked.failedGates[0]!.reason).toContain('degenerate');

    // 5) 자동화율 계측 — 이 사이클 = 개입 1회·재실행 1회·승인, 검토 2세션 각 2,000/1,000ms.
    const autonomy = computeRunAutonomy(events);
    if (!autonomy.ok) throw new Error(`autonomy refused: ${autonomy.reason}`);
    expect(autonomy.run.interventionCount).toBe(1);
    expect(autonomy.run.changesRequestedCount).toBe(1);
    expect(autonomy.run.finalStatus).toBe('approved');
    // 세션1: start(2s)→end(4s)=2,000ms · 세션2: start(6s)→end(7s)=1,000ms.
    expect(autonomy.run.reviewDurationMs).toBe(3_000);
  });
});
