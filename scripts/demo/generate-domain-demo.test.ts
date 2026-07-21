/**
 * generate-domain-demo.test.ts — 실물 예시 폴더 생성기 (설계→인테리어).
 *
 * 이 파일은 "테스트"가 아니라 GEN_DEMO=1 일 때만 도는 **생성 도구**입니다. 실제
 * 제품 엔진을 그대로 구동합니다:
 *   - 4개 비기계 분야(civil/construction/landscape/interior) = `runDomainDesign`
 *     (도메인 API 라우트 /api/nexyfab/domain-design 와 MCP domain_design 이 호출하는 바로 그 함수)
 *   - 기계 "설계"(mechanical) = `runDesignDriver` + fixturePlanner (design-brief 표면)
 * 각 예시의 브리프·검증패키지·자동수정·거절을 Downloads 폴더에 사람이 읽을 수 있는
 * 리포트(.md) + 원자료(.json)로 남깁니다.
 *
 * 실행:  GEN_DEMO=1 npx vitest run scripts/demo/generate-domain-demo
 * 출력:  $DEMO_OUT (기본 C:/Users/gomd9/Downloads/nexyfab-design-demo)
 *
 * 정직성: 출력은 "검증된 설계 패키지"입니다(실측 게이트·근거 명시). 완전한 브리프는
 * zero-touch 검증, 안전한 청구값 부족은 자동수정(검토 플래그), 데이터 부재는 정직
 * 거절 — 세 거동을 모두 실물로 보여줍니다. "실사용 LLM이 애매한 실무 한 문장을
 * 계획으로 바꾸는 능력(축 B 진짜 상한)"은 여기서 측정하지 않습니다(= Step ④, 실사용).
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runDomainDesign } from '@/lib/eng-domain/registry';
import { civilModule, steelBeamPlan } from '@/lib/eng-domain/civil/module';
import { constructionModule, rcFramePlan } from '@/lib/eng-domain/construction/module';
import { runDomainDriver } from '@/lib/domain-driver';
import { runDesignDriver, fixturePlanner } from '@/lib/ai/design-driver';

// ─── normalized driver result (mechanical + domain share the gate/refusal shape) ─
interface GateLike { id: string; kind: string; pass: boolean; metrics: Record<string, number>; reason?: string; notes: string[] }
interface RefusalLike { stage: string; reason: string; failedGateIds: string[] }
interface AdjLike { target: string; from: number; to: number; basis: string; kind: string }
interface DriverLike { ok: boolean; gates?: GateLike[]; package?: unknown; refusal?: RefusalLike; adjustments?: AdjLike[] }

interface Norm {
  ok: boolean;
  autoFixed: boolean;
  gates: GateLike[];
  pkg?: unknown;
  refusal?: RefusalLike;
  adjustments?: AdjLike[];
  raw: unknown;
}

function norm(res: DriverLike): Norm {
  const ok = res.ok === true;
  const adjustments = ok ? res.adjustments : undefined;
  return {
    ok,
    autoFixed: Array.isArray(adjustments) && adjustments.length > 0,
    gates: res.gates ?? [],
    pkg: ok ? res.package : undefined,
    refusal: ok ? undefined : res.refusal,
    ...(adjustments ? { adjustments } : {}),
    raw: res,
  };
}

// ─── the showcase corpus (설계 → 토목 → 건설 → 조경 → 인테리어 + 정직성) ──────────
interface Example {
  group: string; // folder prefix, e.g. '02-civil'
  slug: string;
  titleKo: string;
  domainKo: string;
  surface: string; // which product surface engine
  briefDesc: string;
  run: () => Promise<Norm>;
}

const mech = (key: string): (() => Promise<Norm>) =>
  async () => norm((await runDesignDriver({ id: key, text: key, params: { fixture: key } }, { planner: fixturePlanner })) as unknown as DriverLike);

const dom = (domain: string, key: string): (() => Promise<Norm>) =>
  async () => norm((await runDomainDesign(domain, { id: key, params: { fixture: key } })) as unknown as DriverLike);

const EXAMPLES: Example[] = [
  // ── 기계 설계 (design-brief 표면) ──
  { group: '01-mechanical', slug: 'stepped-shaft', titleKo: '단붙이 축 (선삭 부품)', domainKo: '기계설계', surface: 'runDesignDriver + fixturePlanner', briefDesc: '단이 진 회전축 — 부피 실측·도면 시트·DXF', run: mech('stepped-shaft') },
  { group: '01-mechanical', slug: 'weldment-frame', titleKo: '용접 프레임 (웰드먼트)', domainKo: '기계설계', surface: 'runDesignDriver + fixturePlanner', briefDesc: '형강 용접 프레임 — 부재·용접·질량', run: mech('weldment-frame') },
  { group: '01-mechanical', slug: 'spur-gear', titleKo: '평기어 (스퍼기어)', domainKo: '기계설계', surface: 'runDesignDriver + fixturePlanner', briefDesc: '치형 파라미터 기어 — 기하 검증', run: mech('spur-gear') },
  { group: '01-mechanical', slug: 'pin-block-assembly', titleKo: '핀-블록 조립체 (간섭검사)', domainKo: '기계설계', surface: 'runDesignDriver + fixturePlanner', briefDesc: '핀+블록 조립 — 간섭/체결 게이트', run: mech('pin-block-assembly') },

  // ── 토목/구조 (domain-design → engineering-core 엔진) ──
  { group: '02-civil', slug: 'steel-beam', titleKo: '강재 바닥보 (휨·전단·처짐)', domainKo: '토목/구조', surface: 'runDomainDesign(civil) → engineering-core', briefDesc: '경간 6 m 강재보, 등분포하중 20 kN/m (Fy355)', run: dom('civil', 'steel-beam') },
  { group: '02-civil', slug: 'mixed-structure', titleKo: '복합 구조 (보+기둥+옹벽+사면)', domainKo: '토목/구조', surface: 'runDomainDesign(civil) → engineering-core', briefDesc: '보·기둥·옹벽·사면 4부재 일괄 검증', run: dom('civil', 'mixed-structure') },

  // ── 건설/BOQ (domain-design) ──
  { group: '03-construction', slug: 'rc-frame', titleKo: 'RC 골조 물량·공정·비용', domainKo: '건설/적산', surface: 'runDomainDesign(construction)', briefDesc: 'RC 라멘 1베이 — 콘크리트·철근·공정·비용·토공', run: dom('construction', 'rc-frame') },
  {
    group: '03-construction', slug: 'under-order-autofix', titleKo: '콘크리트 주문부족 → 자동수정(검토대기)', domainKo: '건설/적산',
    surface: 'runDomainDesign(construction) + Step② autoFix', briefDesc: '주문 1.0 m³ < 산정 필요량 → 자동으로 산출값에 정합',
    run: async () => {
      const plan = rcFramePlan();
      (plan as { claimedConcreteM3: number }).claimedConcreteM3 = 1.0;
      return norm((await runDomainDriver({ id: 'under-order' }, { ...constructionModule, plan: () => plan })) as unknown as DriverLike);
    },
  },

  // ── 조경 (domain-design) ──
  { group: '04-landscape', slug: 'park-plaza', titleKo: '근린 광장 (조경면적·객토·관수·배수)', domainKo: '조경', surface: 'runDomainDesign(landscape)', briefDesc: '공원 광장 — 녹지율·식재기반·관수·배수구배', run: dom('landscape', 'park-plaza') },

  // ── 인테리어 (domain-design) ──
  { group: '05-interior', slug: 'office-floor', titleKo: '사무실 층 (수용·피난·위생·반자)', domainKo: '인테리어/실내건축', surface: 'runDomainDesign(interior)', briefDesc: '업무시설 한 층 — 수용인원·피난폭·위생기구·반자높이', run: dom('interior', 'office-floor') },

  // ── 정직성 데모: 데이터 부재 → 거절 ──
  {
    group: '06-honesty', slug: 'civil-no-load-refusal', titleKo: '하중 미기재 보 → 정직 거절(값 날조 안 함)', domainKo: '정직성 데모',
    surface: 'runDomainDesign(civil) 정직 거절', briefDesc: '하중을 안 준 강재보 — 엔진이 지어내지 않고 거절',
    run: async () => {
      const plan = steelBeamPlan();
      delete (plan.members[0] as { udlKNpm?: number }).udlKNpm;
      return norm((await runDomainDriver({ id: 'no-load' }, { ...civilModule, plan: () => plan })) as unknown as DriverLike);
    },
  },
];

// ─── markdown renderers ──────────────────────────────────────────────────────
const verdictLabel = (n: Norm): string =>
  n.ok ? (n.autoFixed ? '🔧 검증됨 (자동수정 — 검토 대기)' : '✅ 검증됨 (zero-touch)') : `⛔ 거절 (stage: ${n.refusal?.stage ?? '?'})`;

const rnd = (v: number): number => (Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4);

function compactMetrics(m: Record<string, number>): string {
  const e = Object.entries(m);
  if (e.length === 0) return '—';
  return e.slice(0, 6).map(([k, v]) => `${k}=${rnd(v)}`).join(', ') + (e.length > 6 ? ' …' : '');
}

function pkgHighlights(pkg: unknown): string[] {
  if (!pkg || typeof pkg !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(pkg as Record<string, unknown>)) {
    if (typeof v === 'number') out.push(`- **${k}**: ${rnd(v)}`);
    else if (typeof v === 'boolean') out.push(`- **${k}**: ${v}`);
    else if (typeof v === 'string') out.push(`- **${k}**: ${v.length > 120 ? v.slice(0, 120) + '…' : v}`);
    else if (Array.isArray(v)) out.push(`- **${k}**: ${v.length}개 항목`);
    else if (v && typeof v === 'object') out.push(`- **${k}**: {…}`);
  }
  return out;
}

function renderReport(ex: Example, n: Norm): string {
  const L: string[] = [];
  L.push(`# ${ex.titleKo}`);
  L.push('');
  L.push(`- **분야**: ${ex.domainKo}`);
  L.push(`- **제품 표면(엔진)**: \`${ex.surface}\``);
  L.push(`- **입력 브리프**: ${ex.briefDesc}`);
  L.push(`- **판정**: ${verdictLabel(n)}`);
  L.push('');
  L.push('## 실측 게이트');
  L.push('');
  if (n.gates.length === 0) {
    L.push('_(계획/입력 단계 거절 — 게이트 미실행)_');
  } else {
    L.push('| 게이트 | 통과 | 핵심 실측치 | 사유 |');
    L.push('|---|:--:|---|---|');
    for (const g of n.gates) {
      L.push(`| \`${g.id}\` | ${g.pass ? '✅' : '❌'} | ${compactMetrics(g.metrics)} | ${g.reason ? g.reason.replace(/\|/g, '/').slice(0, 90) : '—'} |`);
    }
  }
  L.push('');
  if (n.autoFixed && n.adjustments) {
    L.push('## 🔧 자동수정 (Step ② — 사람 검토 대기)');
    L.push('');
    for (const a of n.adjustments) {
      L.push(`- \`${a.target}\`: **${a.from} → ${a.to}**  (${a.kind})`);
      L.push(`  - 근거: ${a.basis}`);
    }
    L.push('');
    L.push('> 형상·물성은 절대 자동변경하지 않습니다. 계산으로 확정되는 청구값(주문물량)만 정합하고 반드시 검토 플래그를 답니다.');
    L.push('');
  }
  if (n.ok) {
    L.push('## 산출물 요약 (검증 패키지)');
    L.push('');
    const hi = pkgHighlights(n.pkg);
    if (hi.length) L.push(...hi);
    else L.push('_(package.json 참조)_');
  } else {
    L.push('## 거절 상세 (정직 — 패키지 미산출)');
    L.push('');
    L.push(`- **단계**: ${n.refusal?.stage}`);
    L.push(`- **사유**: ${n.refusal?.reason}`);
    if (n.refusal?.failedGateIds?.length) L.push(`- **실패 게이트**: ${n.refusal.failedGateIds.join(', ')}`);
    L.push('');
    L.push('> 값을 지어내지 않습니다. 필요한 입력(하중 등)이 없으면 초안을 만들지 않고 거절합니다 — 이것이 "정직한 코파일럿"의 핵심입니다.');
  }
  L.push('');
  L.push('---');
  L.push('_원자료: `package.json` (게이트 전체 metrics·패키지 전 필드)_');
  L.push('');
  return L.join('\n');
}

// ─── single self-contained HTML renderer (브라우저에서 바로 열람) ─────────────────
const esc = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function badge(n: Norm): string {
  if (!n.ok) return '<span class="bd bd-no">⛔ 거절</span>';
  if (n.autoFixed) return '<span class="bd bd-fix">🔧 자동수정 · 검토대기</span>';
  return '<span class="bd bd-ok">✅ 검증됨</span>';
}

function exampleHtml(ex: Example, n: Norm, i: number): string {
  const H: string[] = [];
  H.push(`<section class="card" id="ex-${i}">`);
  H.push(`<div class="card-h"><h3>${esc(ex.titleKo)}</h3>${badge(n)}</div>`);
  H.push(`<div class="meta"><span class="tag">${esc(ex.domainKo)}</span> <code>${esc(ex.surface)}</code></div>`);
  H.push(`<p class="brief">📝 ${esc(ex.briefDesc)}</p>`);

  if (n.gates.length) {
    H.push('<table><thead><tr><th>게이트</th><th>통과</th><th>핵심 실측치</th><th>사유</th></tr></thead><tbody>');
    for (const g of n.gates) {
      H.push(
        `<tr><td><code>${esc(g.id)}</code></td><td class="c">${g.pass ? '✅' : '❌'}</td>` +
          `<td class="mx">${esc(compactMetrics(g.metrics))}</td><td>${g.reason ? esc(g.reason.slice(0, 120)) : '—'}</td></tr>`,
      );
    }
    H.push('</tbody></table>');
  } else {
    H.push('<p class="muted">계획/입력 단계 거절 — 게이트 미실행</p>');
  }

  if (n.autoFixed && n.adjustments) {
    H.push('<div class="box box-fix"><b>🔧 자동수정 (Step ② · 사람 검토 대기)</b><ul>');
    for (const a of n.adjustments) H.push(`<li><code>${esc(a.target)}</code>: <b>${esc(a.from)} → ${esc(a.to)}</b> — ${esc(a.basis)}</li>`);
    H.push('</ul><small>형상·물성은 절대 자동변경하지 않음. 계산으로 확정되는 청구값만 정합 + 검토 플래그.</small></div>');
  }
  if (!n.ok) {
    H.push(`<div class="box box-no"><b>⛔ 거절 (${esc(n.refusal?.stage)}) — 패키지 미산출</b><p>${esc(n.refusal?.reason)}</p>`);
    H.push('<small>값을 지어내지 않음. 필요한 입력이 없으면 초안을 만들지 않고 거절 — 정직한 코파일럿의 핵심.</small></div>');
  } else {
    const hi = pkgHighlights(n.pkg).map((s) => '<li>' + esc(s.replace(/^- /, '').replace(/\*\*/g, '')) + '</li>').join('');
    H.push(`<details><summary>산출물 요약 (검증 패키지)</summary><ul class="pkg">${hi}</ul></details>`);
  }
  H.push('</section>');
  return H.join('\n');
}

function renderHtml(results: Array<{ ex: Example; n: Norm; passed: number }>): string {
  const summaryRows = results
    .map(
      ({ ex, n, passed }, i) =>
        `<tr><td>${esc(ex.domainKo)}</td><td><a href="#ex-${i}">${esc(ex.titleKo)}</a></td><td>${badge(n)}</td><td class="c">${passed}/${n.gates.length}</td></tr>`,
    )
    .join('\n');
  const cards = results.map(({ ex, n }, i) => exampleHtml(ex, n, i)).join('\n');
  const ok = results.filter((r) => r.n.ok && !r.n.autoFixed).length;
  const fix = results.filter((r) => r.n.autoFixed).length;
  const no = results.filter((r) => !r.n.ok).length;

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NexyFab — 설계부터 인테리어까지, 실물 검증 예시</title>
<style>
:root{--bg:#f7f8fa;--fg:#1b1f24;--mut:#6a7280;--line:#e3e7ec;--card:#fff;--ok:#137a3f;--okbg:#e7f6ed;--fix:#8a5a00;--fixbg:#fff4de;--no:#b0203a;--nobg:#fdeaed;--acc:#2b5cff;--code:#f0f2f5}
@media(prefers-color-scheme:dark){:root{--bg:#0f1216;--fg:#e6e9ee;--mut:#98a1ad;--line:#242a31;--card:#161a20;--ok:#5fd08a;--okbg:#13291c;--fix:#e6b567;--fixbg:#2a2010;--no:#ff8098;--nobg:#2a1218;--acc:#7aa2ff;--code:#1d2229}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic",sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:26px;margin:0 0 6px}.sub{color:var(--mut);margin:0 0 22px}
.banner{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 24px}
.banner b{color:var(--acc)}.banner .ax{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px}
.banner .ax>div{flex:1;min-width:240px;background:var(--code);border-radius:8px;padding:10px 12px;font-size:13.5px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 22px}
.kpi{flex:1;min-width:120px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.kpi b{display:block;font-size:22px}.kpi span{color:var(--mut);font-size:12.5px}
table{width:100%;border-collapse:collapse;margin:6px 0;font-size:13.5px;overflow-x:auto;display:block}
@media(min-width:640px){table{display:table}}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12.5px}.c{text-align:center}.mx{color:var(--mut);font-size:12px}
code{background:var(--code);padding:1px 5px;border-radius:5px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin:0 0 16px}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:12px}.card-h h3{margin:0;font-size:17px}
.meta{margin:6px 0 2px;color:var(--mut);font-size:12.5px}.tag{background:var(--acc);color:#fff;border-radius:20px;padding:1px 9px;font-size:11.5px;margin-right:6px}
.brief{color:var(--fg);margin:8px 0 12px}
.bd{border-radius:20px;padding:3px 11px;font-size:12.5px;font-weight:600;white-space:nowrap}
.bd-ok{background:var(--okbg);color:var(--ok)}.bd-fix{background:var(--fixbg);color:var(--fix)}.bd-no{background:var(--nobg);color:var(--no)}
.box{border-radius:9px;padding:11px 13px;margin:10px 0 4px;font-size:13.5px}.box ul{margin:6px 0 4px;padding-left:20px}.box small{color:var(--mut)}
.box-fix{background:var(--fixbg)}.box-no{background:var(--nobg)}
details{margin-top:8px}summary{cursor:pointer;color:var(--acc);font-size:13.5px}.pkg{color:var(--mut);font-size:13px}
.muted{color:var(--mut)}a{color:var(--acc)}h2{font-size:15px;color:var(--mut);margin:28px 0 10px;text-transform:uppercase;letter-spacing:.04em}
</style></head><body><div class="wrap">
<h1>NexyFab — 설계부터 인테리어까지, 실물 검증 예시</h1>
<p class="sub">실제 제품 엔진이 뽑은 검증 결과입니다. 감이 아니라 코드가 실행한 실측.</p>
<div class="banner">
<b>정직한 경계 (두 축으로 읽기)</b>
<div class="ax">
<div><b>축 A · 커버리지</b><br>5개 분야에서 검증 패키지가 실제로 나옴 — 이 페이지가 증거. ✅</div>
<div><b>축 B · 무인 자율 대체</b><br>완전 브리프 zero-touch + 안전 자동수정까지는 실물. 단, 실무 브리프 실사용 통과율은 <b>미측정</b> — "대체 수준(4~5)"은 아직 아님.</div>
</div>
<p style="margin:12px 0 0;font-size:13px;color:var(--mut)">출처: 비기계 4분야=<code>runDomainDesign()</code>(웹 API·MCP·CLI가 호출하는 그 함수), 기계설계=<code>runDesignDriver()</code>. 입력이 없으면 값을 지어내지 않고 거절합니다.</p>
</div>
<div class="kpis">
<div class="kpi"><b>${results.length}</b><span>예시</span></div>
<div class="kpi"><b style="color:var(--ok)">${ok}</b><span>✅ zero-touch</span></div>
<div class="kpi"><b style="color:var(--fix)">${fix}</b><span>🔧 자동수정</span></div>
<div class="kpi"><b style="color:var(--no)">${no}</b><span>⛔ 정직 거절</span></div>
</div>
<h2>결과 요약</h2>
<table><thead><tr><th>분야</th><th>예시</th><th>판정</th><th class="c">게이트</th></tr></thead><tbody>
${summaryRows}
</tbody></table>
<h2>상세</h2>
${cards}
<p class="sub" style="margin-top:30px">재생성: <code>GEN_DEMO=1 npx vitest run scripts/demo/generate-domain-demo</code> · 원자료는 각 예시 폴더의 <code>package.json</code>.</p>
</div></body></html>`;
}

// ─── the generator (GEN_DEMO=1 gated; inert on normal test runs) ────────────────
const OUT = process.env.DEMO_OUT || 'C:/Users/gomd9/Downloads/nexyfab-design-demo';

describe.skipIf(!process.env.GEN_DEMO)('실물 예시 폴더 생성 (설계→인테리어)', () => {
  it('drives the real engines and writes the Downloads showcase folder', async () => {
    // safety: only ever wipe a folder literally named the demo folder
    if (existsSync(OUT) && basename(OUT) === 'nexyfab-design-demo') rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });

    const rows: string[] = [];
    const results: Array<{ ex: Example; n: Norm; passed: number }> = [];
    for (const ex of EXAMPLES) {
      const n = await ex.run();
      const dir = join(OUT, ex.group, ex.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'brief.json'), JSON.stringify({ domain: ex.domainKo, surface: ex.surface, title: ex.titleKo, brief: ex.briefDesc }, null, 2), 'utf8');
      writeFileSync(join(dir, 'package.json'), JSON.stringify(n.raw, null, 2), 'utf8');
      writeFileSync(join(dir, 'report.md'), renderReport(ex, n), 'utf8');

      const passed = n.gates.filter((g) => g.pass).length;
      results.push({ ex, n, passed });
      rows.push(`| ${ex.domainKo} | [${ex.titleKo}](${ex.group}/${ex.slug}/report.md) | ${verdictLabel(n)} | ${passed}/${n.gates.length} |`);
      // never silently ship a broken showcase: a case we expect to verify must not crash
      expect(Array.isArray(n.gates)).toBe(true);
    }

    // the headline deliverable: a single self-contained HTML page (open in a browser)
    writeFileSync(join(OUT, 'index.html'), renderHtml(results), 'utf8');

    const summary = [
      '# NexyFab 설계 예시 — 결과 요약',
      '',
      '실제 제품 엔진으로 생성한 검증 결과입니다. 각 행의 리포트를 열어 실측 게이트를 보세요.',
      '',
      '| 분야 | 예시 | 판정 | 게이트(통과/전체) |',
      '|---|---|---|:--:|',
      ...rows,
      '',
      '## 세 가지 거동 (정직성)',
      '- **✅ zero-touch**: 완전한 브리프 → 손 안 대고 검증 패키지.',
      '- **🔧 자동수정**: 계산으로 확정되는 청구값 부족 → 산출값에 정합 + 검토 플래그(형상 불변).',
      '- **⛔ 정직 거절**: 필요한 입력이 없으면 값을 지어내지 않고 거절(패키지 미산출).',
      '',
    ].join('\n');
    writeFileSync(join(OUT, 'SUMMARY.md'), summary, 'utf8');

    const readme = [
      '# NexyFab — 설계부터 인테리어까지, 실물 검증 예시',
      '',
      '이 폴더는 NexyFab의 **실제 엔진**이 뽑은 설계 검증 결과입니다. 감이 아니라 코드가 실행한 실측입니다.',
      '',
      '## 어떻게 만들어졌나 (출처)',
      '- 비기계 4분야(토목·건설·조경·인테리어) = `runDomainDesign()` — 웹 API(`/api/nexyfab/domain-design`)와 MCP(`domain_design`), CLI(`domain`)가 **모두 호출하는 바로 그 함수**.',
      '- 기계 설계 = `runDesignDriver()` + fixturePlanner — design-brief 표면.',
      '- CLI/MCP의 원격 모드는 배포 서버+키가 필요해, 동일 엔진을 로컬에서 직접 구동해 생성했습니다(출력은 API 반환과 동일 계산).',
      '',
      '## 무엇을 보증하나 (정직한 경계)',
      '- **보증**: 입력이 주어지면 실측 게이트로 검증한 설계 패키지를 산출하고, 한 게이트라도 실패하면 패키지를 만들지 않습니다(원자성). 값을 지어내지 않습니다.',
      '- **미보증(여기서 측정 안 함)**: "실사용 LLM이 애매한 실무 한 문장을 검증 가능한 계획으로 바꾸는" 자율 능력(축 B의 진짜 상한). 그건 실사용 데이터로만 열립니다(로드맵 Step ④).',
      '',
      '## 두 축으로 읽기',
      '- **축 A(커버리지)**: 5개 분야에서 검증 패키지가 실제로 나옵니다 — 이 폴더가 증거.',
      '- **축 B(무인 자율 대체)**: 완전 브리프 zero-touch + 안전 자동수정까지는 실물로 되지만, 실무 브리프 실사용 통과율은 미측정. "대체 수준(4~5)"은 아직 아닙니다.',
      '',
      '자세한 판정표는 [SUMMARY.md](SUMMARY.md).',
      '',
    ].join('\n');
    writeFileSync(join(OUT, 'README.md'), readme, 'utf8');

    // eslint-disable-next-line no-console
    console.log(`\n[생성 완료] ${EXAMPLES.length}개 예시 → ${OUT}\n` + rows.map((r) => '  ' + r).join('\n') + '\n');
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });
});
