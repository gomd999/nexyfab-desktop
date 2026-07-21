/**
 * zero-touch-baseline.test.ts — 축 B(무인 자율) 측정 하네스 (Step ①).
 *
 * WHAT THIS MEASURES (정직하게):
 *   The NEW eng-domain spine (the actual product surface: domain-design API / MCP /
 *   CLI) run over a curated brief corpus. For each brief we record whether the driver
 *   produced a verified package (ok:true) with no human input, or refused (ok:false),
 *   and we classify the outcome:
 *     • zero-touch      — complete brief → verified package, untouched. ✅
 *     • auto-fixed      — Step ② reconciled a SAFE claim (e.g. an under-ordered
 *                         quantity → its geometry-derived takeoff) and re-verified.
 *                         Verified but the adjustment is flagged PENDING REVIEW. 🔧
 *     • honest-refusal  — the brief genuinely lacked required data (load/section/area).
 *                         Refusing is CORRECT (값 날조 금지), not an autonomy failure.
 *     • underdesigned   — the brief HAD the data but fails on a change auto-fix must
 *                         NOT make (geometry/section) → stays human. The principled
 *                         autonomy ceiling, not a bug. 🟠
 *     • capability-gap  — a brief that SHOULD verify/auto-fix but didn't (a real bug). =0.
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
 * WHY IT EXISTS: it is the instrument. Step ② (spine auto-fix) has landed, so the
 * safe-reconcile case now flips refused→auto-fixed and this harness MEASURES that
 * delta instead of us self-declaring it. When we widen auto-fix later, new cases
 * flip here — the number moves on evidence, not assertion.
 *
 * NOTE ON auto-fix scope (정직 천장): the spine auto-fix only reconciles a claim/
 * assertion to its deterministically-computed value (an under-ordered quantity → its
 * takeoff). It NEVER changes geometry or a physical parameter. So `fixBy:'section'`
 * cases STAY human — that is the correct, principled ceiling, and the harness asserts
 * it holds (underTargets > 0). (The RC rebar auto-search in scripts/drawing-to-3d/
 * design-loop `designSuggest` is a separate, assembly-path tool, not wired here.)
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver, type DomainDriverResult } from '@/lib/domain-driver';
import { runDomainDesign } from '../registry';
import { civilModule, steelBeamPlan } from '../civil/module';
import { constructionModule, rcFramePlan } from '../construction/module';
import { landscapeModule, parkPlazaPlan } from '../landscape/module';

type Expect = 'verified' | 'honest-refusal' | 'auto-fixable' | 'underdesigned';
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

  // ── has data, fails today, but a SAFE claim-reconcile fixes it → AUTO-FIXABLE ─
  // (Step ② delta: refused at baseline, now auto-resolved WITH a review flag.)
  {
    domain: 'construction', label: 'concrete order too low (3.5→1.0 m³ → auto-reconcile to takeoff)', expect: 'auto-fixable', fixBy: 'reconcile',
    run: () => {
      const plan = rcFramePlan();
      (plan as { claimedConcreteM3: number }).claimedConcreteM3 = 1.0; // < computed order
      return runDomainDriver({ id: 'construction:under-claim' }, { ...constructionModule, plan: () => plan });
    },
  },

  // ── has data but fails on a change auto-fix must NOT make → UNDERDESIGNED ──────
  // (geometry/section change = human's job = the principled ceiling; stays refused.)
  {
    domain: 'civil', label: 'beam over-loaded (udl 200 → bending FAIL, needs bigger section)', expect: 'underdesigned', fixBy: 'section',
    run: () => {
      const plan = steelBeamPlan();
      (plan.members[0] as { udlKNpm?: number }).udlKNpm = 200; // demand ≫ allowable
      return runDomainDriver({ id: 'civil:over' }, { ...civilModule, plan: () => plan });
    },
  },
];

interface Outcome extends BriefCase {
  verified: boolean;
  stage?: string;
  reason?: string;
  /** classification vs expectation */
  klass: 'zero-touch' | 'honest' | 'auto-fixed' | 'underdesigned-target' | 'capability-gap' | 'fabrication';
}

function classify(c: BriefCase, res: DomainDriverResult<unknown, unknown>): Outcome {
  const verified = res.ok;
  const adjustments = res.ok ? res.adjustments ?? [] : [];
  const adjusted = adjustments.length > 0;
  const stage = res.ok ? undefined : res.refusal.stage;
  const reason = res.ok
    ? adjusted
      ? adjustments.map((a) => `${a.target} ${a.from}→${a.to}`).join('; ')
      : undefined
    : res.refusal.reason;
  let klass: Outcome['klass'];
  if (c.expect === 'verified') klass = verified ? 'zero-touch' : 'capability-gap';
  else if (c.expect === 'honest-refusal') klass = verified ? 'fabrication' : 'honest';
  else if (c.expect === 'auto-fixable') klass = adjusted ? 'auto-fixed' : verified ? 'fabrication' : 'capability-gap';
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
    const autoFixed = n('auto-fixed');
    const shouldAutoFix = outcomes.filter((o) => o.expect === 'auto-fixable').length;
    const underTargets = n('underdesigned-target');
    const gaps = n('capability-gap');
    const fabrications = n('fabrication');

    const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(0)}%`);
    const mark = (o: Outcome) =>
      o.klass === 'zero-touch' ? '✅ zero-touch'
        : o.klass === 'honest' ? '🟡 honest-refusal'
          : o.klass === 'auto-fixed' ? `🔧 auto-fixed → 검토대기 (${o.fixBy})`
            : o.klass === 'underdesigned-target' ? `🟠 underdesigned → 사람 (fixBy:${o.fixBy})`
              : o.klass === 'capability-gap' ? '❌ CAPABILITY-GAP'
                : '🚨 FABRICATION';

    const lines: string[] = [];
    lines.push('');
    lines.push('════════ 축 B 측정: 새 스파인 (Step ② 자동수정 편입 후) ════════');
    for (const o of outcomes) {
      lines.push(`  [${o.domain.padEnd(12)}] ${mark(o).padEnd(36)} ${o.label}` + (o.reason ? `  ← ${o.reason.slice(0, 56)}` : ''));
    }
    lines.push('  ─────────────────────────────────────────────────────────');
    lines.push(`  ZERO-TOUCH 검증율 (완전한 브리프):   ${zeroTouch}/${shouldVerify}  = ${pct(zeroTouch, shouldVerify)}`);
    lines.push(`  🔧 자동수정→검토대기 (Step② 델타):    ${autoFixed}/${shouldAutoFix}  (claim reconcile, 형상 불변)`);
    lines.push(`  정직 거절율 (데이터 부재 브리프):     ${honest}/${shouldRefuse}  = ${pct(honest, shouldRefuse)}`);
    lines.push(`  🟠 미달설계→사람 (형상변경, 정직 천장): ${underTargets}건  (fixBy: ${outcomes.filter((o) => o.klass === 'underdesigned-target').map((o) => o.fixBy).join(', ') || '-'})`);
    lines.push(`  🚨 날조(거절해야 하는데 통과):         ${fabrications}  (반드시 0)`);
    lines.push(`  ❌ 능력 결함(통과해야 하는데 거절):    ${gaps}  (반드시 0)`);
    lines.push('  ─────────────────────────────────────────────────────────');
    lines.push('  ⚠️ 이 수치는 결정론 스파인의 실측치입니다. 자동수정은 "계산으로 확정되는');
    lines.push('     청구값(주문물량)"만 정합하며 형상·물성은 사람 몫으로 남깁니다(정직 천장).');
    lines.push('     실사용 LLM의 실무 브리프→계획 능력(축 B 진짜 상한)은 여기서 측정 안 됨 = Step ④.');
    lines.push('     이 %를 "자율 점수"로 읽지 말 것.');
    lines.push('═══════════════════════════════════════════════════════════');
     
    console.log(lines.join('\n'));

    // ── invariants: the two numbers that must never regress ──
    expect(fabrications, `FABRICATION: ${outcomes.filter((o) => o.klass === 'fabrication').map((o) => o.label).join('; ')}`).toBe(0);
    expect(gaps, `CAPABILITY-GAP: ${outcomes.filter((o) => o.klass === 'capability-gap').map((o) => o.label).join('; ')}`).toBe(0);
    // baseline + Step② expectations (documented, regression-guarded):
    expect(zeroTouch).toBe(shouldVerify); // every complete brief verifies zero-touch
    expect(honest).toBe(shouldRefuse); // every missing-data brief is honestly refused
    expect(autoFixed).toBe(shouldAutoFix); // Step② delta: safe claim-reconciles now auto-resolve (with review flag)
    expect(underTargets).toBeGreaterThan(0); // geometry/section cases STAY human — the principled ceiling holds
  });
});
