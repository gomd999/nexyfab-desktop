/**
 * 실 LLM 설계 벤치 러너 — 동결 세트(`benchBriefs.ts`)를 돌려 **세션 간 비교 가능한** 표를 낸다.
 * (260728 §7-2. 종전엔 세션마다 임시 브리프를 새로 써서 수치가 서로 비교 불가였다.)
 *
 * 실행:
 *   node -r ./scripts/load-parent-env.cjs ./node_modules/tsx/dist/cli.mjs scripts/design-bench/run-bench.ts
 * 옵션(환경변수):
 *   BENCH_ONLY=b-03,b-07   특정 브리프만
 *   BENCH_REPS=3           반복(비결정 완화 — 온도 0 이어도 실 LLM 은 바이트 결정론이 아니다)
 *
 * 지표는 둘 다 낸다:
 *  ① 완주율 — 전 게이트 통과 + 패키지 산출.
 *  ② **기능 선택률** — 그 브리프를 정직하게 풀려면 필요한 기능(`requires`)을 계획이 실제로
 *    골랐는가. §5-4 가 세운 지표이고, 완주율보다 배선의 도달 가능성을 정확히 잰다.
 *
 * ⚠ 결과를 문서에 옮길 때 `BENCH_VERSION` 을 함께 적을 것 — 버전이 다르면 비교 금지.
 */
import { BENCH_BRIEFS, BENCH_VERSION, type BenchBrief, type BenchCapability } from '../../src/lib/ai/design-driver/benchBriefs';
import { chatCompletionPlanner } from '../../src/lib/ai/design-driver/llmPlanner';
import { runDesignDriver } from '../../src/lib/ai/design-driver/designDriver';
import type { DesignPlan } from '../../src/lib/ai/design-driver/types';

/** 계획이 실제로 사용한 기능 — 선언이 아니라 계획 객체에서 읽는다(자기보고 금지). */
function usedCapabilities(plan: DesignPlan): Set<BenchCapability> {
  const used = new Set<BenchCapability>();
  for (const part of plan.parts) {
    for (const h of part.holes ?? []) {
      if (h.shape === 'rect') used.add('holes.rect');
      else used.add('holes.round');
      if (h.depthMm !== undefined) used.add('holes.blind');
    }
    if (part.expectedVolume?.decomposition) {
      const terms = part.expectedVolume.decomposition.terms;
      // 항이 2개 이상이거나 빼는 항이 있으면 단순 직사각이 아니다
      if (terms.length > 1 || terms.some((t) => (t.sign ?? 1) === -1) || terms.some((t) => t.shape !== 'rect')) {
        used.add('volume.nonRect');
      }
    }
  }
  for (const d of plan.drawing.dimensions) {
    if (d.kind === 'aligned') used.add('dim.aligned');
    if (d.axis !== undefined) used.add('dim.axis');
  }
  return used;
}

type Row = {
  id: string; label: string; rep: number;
  planned: boolean; gatesPass: boolean; packaged: boolean;
  requires: BenchCapability[]; used: BenchCapability[]; chose: boolean;
  decomposition: boolean; valueMm3: boolean;
  why: string;
};

async function runOne(item: BenchBrief, rep: number): Promise<Row> {
  const planner = chatCompletionPlanner({ name: 'bench', temperature: 0, maxTokens: 6000, timeoutMs: 120_000 });
  const base = {
    id: item.brief.id, label: item.label, rep,
    requires: item.requires, used: [] as BenchCapability[], chose: false,
    decomposition: false, valueMm3: false,
  };
  try {
    const res = await runDesignDriver({ ...item.brief, id: `${item.brief.id}#${rep}` }, { planner });
    const plan = (res as { plan?: DesignPlan }).plan;
    if (!plan) {
      return { ...base, planned: false, gatesPass: false, packaged: false,
        why: res.ok ? '' : `refused[${res.refusal.stage}]: ${String(res.refusal.reason).slice(0, 170)}` };
    }
    const used = usedCapabilities(plan);
    const failed = res.gates.filter((g) => !g.pass);
    return {
      ...base,
      planned: true,
      gatesPass: res.gates.length > 0 && failed.length === 0,
      packaged: res.ok,
      used: [...used].sort(),
      chose: item.requires.every((c) => used.has(c)),
      decomposition: plan.parts.some((p) => !!p.expectedVolume?.decomposition),
      valueMm3: plan.parts.some((p) => p.expectedVolume?.valueMm3 !== undefined),
      why: failed.length ? `${failed[0]!.id}: ${String(failed[0]!.reason).slice(0, 170)}`
        : (!res.ok ? `refused[${res.refusal.stage}]: ${String(res.refusal.reason).slice(0, 170)}` : ''),
    };
  } catch (e) {
    return { ...base, planned: false, gatesPass: false, packaged: false,
      why: `throw: ${String(e instanceof Error ? e.message : e).slice(0, 170)}` };
  }
}

async function main(): Promise<void> {
  const only = (process.env.BENCH_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const reps = Math.max(1, Number(process.env.BENCH_REPS ?? 1) || 1);
  const items = only.length ? BENCH_BRIEFS.filter((x) => only.includes(x.brief.id)) : BENCH_BRIEFS;
  if (!items.length) { console.error('BENCH_ONLY 에 해당하는 브리프가 없다'); process.exitCode = 1; return; }

  console.log(`bench ${BENCH_VERSION} · ${items.length} briefs x ${reps} rep(s)\n`);
  const rows: Row[] = [];
  for (let r = 0; r < reps; r++) {
    for (const item of items) {
      const t0 = Date.now();
      const row = await runOne(item, r);
      rows.push(row);
      console.log(`  ${row.id}#${r} ${row.packaged ? '✔' : '✘'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }

  console.log(`\n| brief | 계획 | 요구기능 선택 | 전 게이트 | 완주 | 사유 |`);
  console.log(`|---|---|---|---|---|---|`);
  for (const r of rows) {
    const cap = r.requires.length === 0 ? '—(기준선)' : `${r.chose ? '✔' : '✘'} [${r.requires.join(' ')}]`;
    console.log(`| ${r.id}#${r.rep} ${r.label} | ${r.planned ? '✔' : '✘'} | ${cap} | ${r.gatesPass ? '✔' : '✘'} | ${r.packaged ? '✔' : '✘'} | ${r.why} |`);
  }

  const n = rows.length;
  const needCap = rows.filter((r) => r.requires.length > 0);
  const planned = rows.filter((r) => r.planned);
  console.log(`\n### ${BENCH_VERSION} 요약 (n=${n})`);
  console.log(`- 계획 통과: ${planned.length}/${n}`);
  console.log(`- 전 게이트 통과: ${rows.filter((r) => r.gatesPass).length}/${n}`);
  console.log(`- **완주(패키지 산출): ${rows.filter((r) => r.packaged).length}/${n}**`);
  console.log(`- **요구 기능 선택: ${needCap.filter((r) => r.chose).length}/${needCap.length}** (기능이 필요한 브리프 기준)`);
  console.log(`- decomposition 사용: ${planned.filter((r) => r.decomposition).length}/${planned.length} · valueMm3 사용: ${planned.filter((r) => r.valueMm3).length}/${planned.length}`);
  console.log(`\n⚠ 다른 BENCH_VERSION 의 수치와 비교하지 말 것.`);
}

void main();
