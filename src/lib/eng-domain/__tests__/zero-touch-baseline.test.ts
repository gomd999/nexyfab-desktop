/**
 * zero-touch-baseline.test.ts — 축 B(무인 자율) 측정 하네스 (Step ①).
 *
 * WHAT THIS MEASURES (정직하게):
 *   The NEW eng-domain spine (the actual product surface: domain-design API / MCP /
 *   CLI) run over a curated brief corpus. For each brief we record whether the driver
 *   produced a ZERO-TOUCH verified package (ok:true) with no human input, or refused
 *   (ok:false), and we classify the refusal:
 *     • honest-refusal  — the brief genuinely lacked required data (load/section/area).
 *                         Refusing is CORRECT (값 날조 금지), not an autonomy failure.
 *     • underdesigned   — the brief HAD the data but a member fails a check today.
 *                         Refused today; a future auto-fix stage (Step ②) is the target.
 *     • capability-gap  — a brief that SHOULD verify but didn't (a real bug). Must be 0.
 *     • fabrication     — a brief that SHOULD refuse but verified (honesty violation).
 *                         Must be 0. This is the one number that can never regress.
 *
 * WHAT THIS DOES **NOT** MEASURE (착각 금지 — 이건 자율 점수가 아님):
 *   1. A LIVE LLM turning a real, vague, free-text brief into a verifiable plan.
 *      Here the plans are deterministic (fixtures / builder overrides) so the harness
 *      is reproducible in CI with no API. Live-LLM planning skill is a separate axis.
 *   2. REAL-WORLD briefs from real engineers (zero-touch pass rate at n>0). That is
 *      Step ④ and only real usage can open it. Do NOT read this file's % as "the score".
 *
 * WHY IT EXISTS: it is the instrument. When an auto-fix stage lands (Step ②), the
 * `underdesigned` cases whose `fixBy` the auto-fixer covers should flip to `verified`,
 * and this harness will measure that delta honestly instead of us self-declaring it.
 *
 * NOTE ON auto-fix scope: the RC rebar auto-search (scripts/drawing-to-3d/design-loop
 * `designSuggest`) lives in the OLD assembly path, NOT in this spine, and it only
 * resizes REBAR — never geometry (형상 변경은 사람 몫). So `fixBy:'section'` cases are
 * expected to stay human even after Step ②; that is the correct, principled ceiling.
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver, type DomainDriverResult } from '@/lib/domain-driver';
import { runDomainDesign } from '../registry';
import { civilModule, steelBeamPlan } from '../civil/module';
import { constructionModule, rcFramePlan } from '../construction/module';
import { landscapeModule, parkPlazaPlan } from '../landscape/module';

type Expect = 'verified' | 'honest-refusal' | 'underdesigned';
type FixBy = 'input' | 'section' | 'reconcile' | 'rebar';

interface BriefCase {
  domain: string;
  label: string;
  expect: Expect;
  /** For a refusal: what would a human (or a future auto-fixer) change to resolve it. */
  fixBy?: FixBy;
  run: () => Promise<DomainDriverResult<unknown, unknown>>;
}

/** A fixture brief goes through the real registry surface (the product path). */
const fixture = (domain: string, key: string): (() => Promise<DomainDriverResult<unknown, unknown>>) =>
  () => runDomainDesign(domain, { id: `${domain}:${key}`, params: { fixture: key } });

const CORPUS: BriefCase[] = [
  // ── complete + adequately specified → should verify ZERO-TOUCH ──────────────
  { domain: 'civil', label: 'steel floor beam (Fy355, Sx1.5e6, udl20)', expect: 'verified', run: fixture('civil', 'steel-beam') },
  { domain: 'civil', label: 'mixed structure (beam+column+wall+slope)', expect: 'verified', run: fixture('civil', 'mixed-structure') },
  { domain: 'interior', label: 'office floor (occupancy+egress+plumbing+ceiling)', expect: 'verified', run: fixture('interior', 'office-floor') },
  { domain: 'construction', label: 'RC frame bay BOQ (concrete/rebar/schedule/cost)', expect: 'verified', run: fixture('construction', 'rc-frame') },
  { domain: 'landscape', label: 'park plaza (green-area/soil/irrigation/drainage)', expect: 'verified', run: fixture('landscape', 'park-plaza') },

  // ── genuinely missing data → HONEST refusal (correct; needs human input) ─────
  {
    domain: 'civil', label: 'beam with NO load given', expect: 'honest-refusal', fixBy: 'input',
    run: () => {
      const plan = steelBeamPlan();
      delete (plan.members[0] as { udlKNpm?: number }).udlKNpm; // no w, no P
      return runDomainDriver({ id: 'civil:no-load' }, { ...civilModule, plan: () => plan });
    },
  },
  {
    domain: 'landscape', label: 'site area = 0 (invalid brief)', expect: 'honest-refusal', fixBy: 'input',
    run: () => {
      const plan = parkPlazaPlan();
      (plan as { siteAreaM2: number }).siteAreaM2 = 0;
      return runDomainDriver({ id: 'landscape:no-area' }, { ...landscapeModule, plan: () => plan });
    },
  },

  // ── has data but fails a check today → UNDERDESIGNED (Step ② delta targets) ───
  {
    domain: 'civil', label: 'beam over-loaded (udl 200 → bending FAIL)', expect: 'underdesigned', fixBy: 'section',
    run: () => {
      const plan = steelBeamPlan();
      (plan.members[0] as { udlKNpm?: number }).udlKNpm = 200; // demand ≫ allowable
      return runDomainDriver({ id: 'civil:over' }, { ...civilModule, plan: () => plan });
    },
  },
  {
    domain: 'construction', label: 'concrete claim too low (3.5→1.0 m³ → takeoff FAIL)', expect: 'underdesigned', fixBy: 'reconcile',
    run: () => {
      const plan = rcFramePlan();
      (plan as { claimedConcreteM3: number }).claimedConcreteM3 = 1.0; // < computed
      return runDomainDriver({ id: 'construction:under-claim' }, { ...constructionModule, plan: () => plan });
    },
  },
];

interface Outcome extends BriefCase {
  verified: boolean;
  stage?: string;
  reason?: string;
  /** classification vs expectation */
  klass: 'zero-touch' | 'honest' | 'underdesigned-target' | 'capability-gap' | 'fabrication';
}

function classify(c: BriefCase, res: DomainDriverResult<unknown, unknown>): Outcome {
  const verified = res.ok === true;
  const stage = res.ok ? undefined : res.refusal.stage;
  const reason = res.ok ? undefined : res.refusal.reason;
  let klass: Outcome['klass'];
  if (c.expect === 'verified') klass = verified ? 'zero-touch' : 'capability-gap';
  else if (c.expect === 'honest-refusal') klass = verified ? 'fabrication' : 'honest';
  else /* underdesigned */ klass = verified ? 'fabrication' : 'underdesigned-target';
  return { ...c, verified, ...(stage ? { stage } : {}), ...(reason ? { reason } : {}), klass };
}

describe('축 B 측정 하네스 — new spine zero-touch baseline (Step ①)', () => {
  it('runs the corpus, prints the honest baseline, and guards fabrication=0 / gap=0', async () => {
    const outcomes: Outcome[] = [];
    for (const c of CORPUS) {
      const res = await c.run();
      outcomes.push(classify(c, res));
    }

    const n = (k: Outcome['klass']) => outcomes.filter((o) => o.klass === k).length;
    const zeroTouch = n('zero-touch');
    const shouldVerify = outcomes.filter((o) => o.expect === 'verified').length;
    const honest = n('honest');
    const shouldRefuse = outcomes.filter((o) => o.expect === 'honest-refusal').length;
    const underTargets = n('underdesigned-target');
    const gaps = n('capability-gap');
    const fabrications = n('fabrication');

    const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(0)}%`);
    const mark = (o: Outcome) =>
      o.klass === 'zero-touch' ? '✅ zero-touch'
        : o.klass === 'honest' ? '🟡 honest-refusal'
          : o.klass === 'underdesigned-target' ? `🟠 underdesigned → Step② (fixBy:${o.fixBy})`
            : o.klass === 'capability-gap' ? '❌ CAPABILITY-GAP'
              : '🚨 FABRICATION';

    const lines: string[] = [];
    lines.push('');
    lines.push('════════ 축 B 측정: 새 스파인 zero-touch baseline ════════');
    for (const o of outcomes) {
      lines.push(`  [${o.domain.padEnd(12)}] ${mark(o).padEnd(34)} ${o.label}` + (o.reason ? `  ← ${o.reason.slice(0, 60)}` : ''));
    }
    lines.push('  ─────────────────────────────────────────────────────────');
    lines.push(`  ZERO-TOUCH 검증율 (완전한 브리프): ${zeroTouch}/${shouldVerify}  = ${pct(zeroTouch, shouldVerify)}`);
    lines.push(`  정직 거절율 (데이터 부재 브리프):   ${honest}/${shouldRefuse}  = ${pct(honest, shouldRefuse)}`);
    lines.push(`  미달설계 (Step② 자동수정 타깃):     ${underTargets}건  (fixBy: ${outcomes.filter((o) => o.klass === 'underdesigned-target').map((o) => o.fixBy).join(', ')})`);
    lines.push(`  🚨 날조(거절해야 하는데 통과):       ${fabrications}  (반드시 0)`);
    lines.push(`  ❌ 능력 결함(통과해야 하는데 거절):  ${gaps}  (반드시 0)`);
    lines.push('  ─────────────────────────────────────────────────────────');
    lines.push('  ⚠️ 이 수치는 결정론 스파인의 실측 baseline입니다. 실사용 LLM이 실무');
    lines.push('     브리프를 계획으로 바꾸는 능력(축 B의 진짜 상한)은 여기서 측정 안 됨 = Step ④.');
    lines.push('     이 %를 "자율 점수"로 읽지 말 것.');
    lines.push('═══════════════════════════════════════════════════════════');
     
    console.log(lines.join('\n'));

    // ── invariants: the two numbers that must never regress ──
    expect(fabrications, `FABRICATION: ${outcomes.filter((o) => o.klass === 'fabrication').map((o) => o.label).join('; ')}`).toBe(0);
    expect(gaps, `CAPABILITY-GAP: ${outcomes.filter((o) => o.klass === 'capability-gap').map((o) => o.label).join('; ')}`).toBe(0);
    // baseline expectations (documented, regression-guarded):
    expect(zeroTouch).toBe(shouldVerify); // every complete brief verifies zero-touch today
    expect(honest).toBe(shouldRefuse); // every missing-data brief is honestly refused today
    expect(underTargets).toBeGreaterThan(0); // there ARE fixable-later cases — that is the Step② surface
  });
});
