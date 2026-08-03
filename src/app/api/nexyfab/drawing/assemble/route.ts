/**
 * POST /api/nexyfab/drawing/assemble
 *
 * 멀티바디 어셈블리 배선 — 텍스트 → AI 어셈블리 계획(부품별 독립 body + 배치)
 * → 결정론 빌드(buildAssembly): 부품별 OpenSCAD + 간섭검사(interferences).
 * drawing-to-3d 방법론 §4(복합=부품 분해) / §12.1 #4(Assembly Topology Graph).
 *
 * 구현: from-text.mjs(textToAssembly)·assembly.mjs(buildAssembly)를 webpackIgnore
 * 런타임 import(compose 라우트와 동일 패턴). GEMINI_API_KEY env-first — 실제 호출은
 * ai-json.mjs callAiJson(모델 이름으로 Gemini/OpenAI 백엔드를 고른다).
 *
 * caller: { description } → { ok, assembly, openscad?, parts?, interferences?, gateErrors? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { TraceRecorder, traceSummary } from '@/lib/pipeline-trace';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { recordIntentMatch } from '@/lib/intentTelemetry';
import { recordFailure } from '@/lib/failureLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Assembly = { name?: string; parts?: Array<Record<string, unknown>> };
type BuiltAssembly = { ok: boolean; openscad?: string; parts?: unknown; gateErrors?: string[]; interferences?: unknown[]; contacts?: unknown[]; welds?: unknown[]; weldTotalMm?: number; composeIntent?: unknown; structural?: unknown; support?: unknown; pipes?: unknown; designOk?: boolean };
type FromTextModule = {
  callAiJson: (prompt: string, schema: unknown, o?: { models?: string[]; maxOutputTokens?: number; thinkingBudget?: number }) => Promise<{ data: Assembly; model?: string; repaired?: boolean }>;
  /** 어휘 스펙 — ALL_TYPES 에서 생성한다(하드코딩 금지, 260803). */
  VOCAB_SPEC: () => string;
  ASSEMBLY_SCHEMA: unknown;
};
// 260803 — Gemini 로 되돌린다(260802 OpenAI 전환의 역방향). 아래 두 상수의
// `thinkingBudget` 은 **Gemini 전용 실측값**이라 백엔드와 함께 되돌려야 한다 —
// OpenAI 배선일 때는 ai-json.mjs 가 이 값을 무시한다.
//
// MAX_TOKENS 원인은 2.5 "thinking"(출력토큰 소진) → thinkingBudget:0 으로 차단.
// + response_schema 없이 free-form(플랫 스키마 토큰폭주 회피). flash 고정(속도).
const AI_OPTS = { models: ['gemini-2.5-flash'], maxOutputTokens: 12000, thinkingBudget: 0 };
// claims 추출용: thinkingBudget:0 이면 flash 가 조용히 빈 claims 를 낸다(260717 라이브 프로브 확인)
// — 출력이 작아 MAX_TOKENS 위험이 없으므로 thinking 기본값으로 호출.
// thinking 은 **유계 512**: 0=빈 claims(무력화)·무제한=1/3 확률 폭주 MAX_TOKENS(둘 다 실측).
// tb=512 는 2개 설명문 × 3회 반복 전부 성공 + 핵심 클레임(연장·R·수량·존재) 보존 확인.
const CLAIMS_OPTS = { models: ['gemini-2.5-flash'], maxOutputTokens: 8192, thinkingBudget: 512 };
type AssemblyModule = { buildAssembly: (asm: Assembly) => BuiltAssembly; autoPlaceCorrect: (asm: Assembly) => { assembly: Assembly; corrections: Array<Record<string, unknown>> }; autoTagAssembly: (asm: Assembly) => Assembly; assemblyAtLevel: (asm: Assembly, level: number) => Assembly };

// 1차 골격→2차 상세(260719): 자동 태깅 후 detail≤1 부분집합의 별도 빌드(초안 프리뷰).
// 실패해도 본 응답을 막지 않음(draft=null).
function lodExtras(asmMod: AssemblyModule, assembly: Assembly): { assembly: Assembly; draft: { openscad: string; parts: unknown[] } | null } {
  try {
    const tagged = asmMod.autoTagAssembly(assembly);
    const lvl1 = asmMod.assemblyAtLevel(tagged, 1);
    const n1 = ((lvl1 as { parts?: unknown[] }).parts ?? []).length;
    const nAll = ((tagged as { parts?: unknown[] }).parts ?? []).length;
    if (n1 > 0 && n1 < nAll) {
      const db = asmMod.buildAssembly(lvl1) as unknown as { ok?: boolean; openscad?: string; parts?: unknown[] };
      if (db.ok && typeof db.openscad === 'string') return { assembly: tagged, draft: { openscad: db.openscad, parts: db.parts ?? [] } };
    }
    return { assembly: tagged, draft: null };
  } catch {
    return { assembly, draft: null };
  }
}

let _ft: FromTextModule | null = null;
let _asm: AssemblyModule | null = null;
async function load(): Promise<{ ft: FromTextModule; asm: AssemblyModule }> {
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  if (!_ft) _ft = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'from-text.mjs')).href)) as FromTextModule;
  if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'assembly.mjs')).href)) as AssemblyModule;
  return { ft: _ft, asm: _asm };
}

/**
 * 부품 선택 필드 — 어휘 목록과 **따로** 유지한다(어휘에 종속되지 않는 공통 필드).
 *
 * ⚠⚠ 260803 — 여기 위에 **어휘 16종과 그 params 가 손으로 박혀 있었다.** 실제 어휘는 38종이고
 *   **22종이 프롬프트에 아예 없었다**(slab_with_openings·composite·revolve·cone·torus·
 *   pipe_elbow·coil_spring 등). 즉 라이브 라우트는 어휘의 42%만 쓸 수 있었다.
 *   `from-text.mjs` 는 `VOCAB_SPEC()` 으로 `ALL_TYPES` 에서 생성하는데 **라우트만 자기
 *   목록을 들고 있었다** — 260802 에 enum·힌트에서 두 번 고친 것과 **같은 단일소스 결손의
 *   다섯 번째 판**이다. 이제 `VOCAB_SPEC()` 하나에서 만든다.
 */
const PART_FIELDS = `부품 선택 필드(정확도·물량에 중요):
- material: STS316 | STS304 | steel | aluminum | concrete | timber | PVC 중 하나. 콘크리트 구조물(RC 보·기둥·슬래브·옹벽)은 반드시 "concrete", 목구조(데크·파고라·가구)는 "timber".
- role: column | beam | slab | joist | deck | floor | wall | table | counter | frame | motor | panel 등 — 계통색·도면 라벨에 쓰임. 힌지 핀·와셔 같은 관통 체결구는 "fastener".`;

// 템플릿 카탈로그(챗 개방, 260717 — 참고파일들급 복잡물 대화 생성): 결정론 템플릿
// 레지스트리에서 동적 생성. AI 는 template{domain,id,params} 선언만 — 형상·게이트·도서=엔진.
let _catalog: string | null = null;
async function templateCatalog(): Promise<string> {
  if (_catalog) return _catalog;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'domain-assemblies.mjs');
  const dm = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as {
    listAssemblyTemplates: () => Array<{ domain: string; id: string; labelKo: string; params: Array<{ name: string; labelKo: string; unit: string; default: number; min: number; max: number }> }>;
  };
  _catalog = dm.listAssemblyTemplates()
    .filter((t) => t.id !== 'retaining_wall_alignment') // 선형은 civilAlignment 전용 경로(더 풍부한 입력)
    .map((t) => `- ${t.domain}/${t.id} (${t.labelKo}): ${t.params.map((q) => `${q.name}=${q.labelKo}${q.unit ? '(' + q.unit + ')' : ''} 기본${q.default} 범위${q.min}~${q.max}`).join(', ')}`)
    .join('\n');
  return _catalog;
}

/**
 * ★260803 — **템플릿 우선(template-first)**. 종전에는 `parts[]` 직접 생성이 기본이고
 * 템플릿이 「예외 2」였다.
 *
 * 실측이 순서를 뒤집을 근거를 줬다:
 * ```
 *   템플릿 경로  55종 중 48종 designOk
 *   자유형 경로  부품 42개 중 28개 부유(designOk:false)
 * ```
 * 원인은 명확하다 — 자유형은 `at{tx,ty,tz}` **절대좌표를 LLM 이 계산**하므로 부품이
 * 서로 닿지 못한다. 템플릿은 비율 배치를 코드가 한다.
 * ⚠ 자유형을 없애지 않는다 — 카탈로그에 없는 제품이 훨씬 많다. **먼저 고르게** 할 뿐이고,
 *   못 고른 이유를 `templateMiss` 로 받아 **다음에 만들 아키타입 목록이 자동으로 쌓이게** 한다.
 */
const BASE_PROMPT = (desc: string, vocab: string) => `자연어 제품 설명을 3D 어셈블리 계획(JSON)으로 변환하라.

**1순위 — 템플릿.** 아래 카탈로그에 맞는 것이 있으면 **반드시 template 하나만** 선언하라.
형상·배치·간섭·도면집·물량을 결정론 엔진이 만든다 — 부품을 직접 만들지 마라.
{"name":"...","template":{"domain":"bridge","id":"arch_bridge","params":{"mainSpan":120000,"rise":26400}}}
[템플릿 카탈로그 — params 는 목록의 키만·범위 내 숫자. 미기입=기본값(assumptions 에 병기)]
{{CATALOG}}

**2순위 — 선형(노선).** 옹벽·도로변 벽 등 노선 설계면 civilAlignment 하나만 선언:
{"name":"...","civilAlignment":{"ips":[[0,0],[120000,0],[200000,60000]],"curves":[{"ip":1,"R":30000}],"structures":[{"sta":60000,"type":"culvert"}],"H":3000,"baseWidth":2000,"stemThickness":300,"baseThickness":400,"toeLength":600}}
- 좌표·측점·곡선 기하·도면집·검증은 결정론 엔진이 수행 — 경로 좌표를 지어내지 마라.
- **곡선은 방향이 꺾이는 내부 IP 에만 붙는다**: ips 가 3점 이상이고 해당 IP 에서 실제로 꺾여야 한다.
- 구조물 요구는 structures:[{"sta":측점mm,"type":"culvert"|"catch_basin"|"expansion_joint"}] 로 선언.

**3순위 — 부품 직접 조립.** 위 둘에 해당하지 않을 때만 parts 를 만든다.
⚠ 이 경로는 네가 **절대좌표를 직접 계산**해야 해서 부품이 서로 안 닿는 일이 잦다.
  템플릿으로 되는 것을 여기서 만들지 마라. 그리고 **왜 템플릿을 못 썼는지**를
  "templateMiss":"카탈로그에 노트북 거치대 없음" 처럼 한 줄로 적어라(다음 템플릿을 만드는 근거가 된다).

어휘(이 목록의 type 만 쓴다):
${vocab}

${PART_FIELDS}

좌표: 전역 원점(0,0,0), 각 부품 로컬 원점이 at(tx,ty,tz mm; rx,ry,rz deg) 에 놓임. 판재는 z=0 바닥, 위에 얹으면 tz=판두께.
부피 침투 없이 **접촉** 배치 — 떠 있으면 실패한다. 치수 미기입은 통상값.

**출력은 JSON 하나만**(다른 텍스트·코드펜스 금지):
{"name":"...","parts":[{"id":"post1","type":"rect_tube","params":{"width":60,"height":60,"wallThk":3,"length":1000},"at":{"tx":0,"ty":0,"tz":0,"rx":0,"ry":0,"rz":0}}],"templateMiss":"..."}
- parts 배열은 최소 2개 이상, 각 부품은 id·type·params·at 을 모두 포함.
- params 는 그 type 의 정확한 키만(위 어휘 목록). at 의 6개 값은 항상 숫자로.
- 설명에 없어서 네가 정한 값이 있으면 "assumptions":[...] 로 전부 나열(숨기지 마라).

설명: "${desc}"`;

const FIX_PROMPT = (desc: string, errs: string[], prev: Assembly, vocab: string) => `직전 어셈블리 계획이 결정론 게이트에서 실패했다. **각 부품의 type 에 맞는 정확한 params 로만** 고쳐라.
게이트 오류: ${errs.join(' | ')}
${vocab}
${PART_FIELDS}
직전 계획(수정 대상): ${JSON.stringify(prev).slice(0, 1800)}
원래 설명: "${desc}"
JSON 하나만 출력.`;

// 의도 교정 라운드(260717): 게이트는 통과했지만 요청 정합(intent-match)에서 불일치가
// 나온 경우, 결정론 판정문을 그대로 되먹여 1회 재수정. 채택은 조건부(불일치 감소+일치 비감소).
const INTENT_FIX_PROMPT = (desc: string, mismatches: string[], prev: Assembly, vocab: string) => `직전 어셈블리는 형상 게이트는 통과했지만, 사용자 요청과 실측 대조에서 아래 항목이 **불일치**로 판정됐다.
요청을 다시 읽고 불일치 항목만 고친 전체 JSON 을 다시 내라(스키마 동일, 일치한 값은 유지).
[사용자 요청] "${desc}"
[불일치 판정(결정론 실측)]
${mismatches.map((m) => '- ' + m).join('\n')}
${vocab}
${PART_FIELDS}
직전 계획(수정 대상): ${JSON.stringify(prev).slice(0, 1800)}
JSON 하나만 출력.`;

// 선형(civilAlignment) 경로용 의도 교정: 형상은 결정론 템플릿이 만들므로 AI 는 선언 값만 고친다.
const INTENT_FIX_CA_PROMPT = (desc: string, mismatches: string[], prevCa: Record<string, unknown>) => `직전 선형 선언(civilAlignment)으로 생성한 결과가 사용자 요청과 실측 대조에서 아래 항목이 **불일치**로 판정됐다.
요청을 다시 읽고 값만 고친 {"civilAlignment":{...}} JSON 하나만 다시 내라(기존 키 구조 유지: ips [[x,y],..]·curves [{ip,R,Ls?}]·structures [{sta,type}] 등, 일치한 값은 유지).
[사용자 요청] "${desc}"
[불일치 판정(결정론 실측)]
${mismatches.map((m) => '- ' + m).join('\n')}
직전 선언(수정 대상): ${JSON.stringify(prevCa).slice(0, 1800)}
JSON 하나만 출력.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-assemble:${ip}`, 8, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  // 구독 정합(2026-07-16): 로그인=shape_chat 슬롯+예산, 익명=합산 리밋(게스트 데모 유지)
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;

  let description: string;
  try {
    const body = (await req.json()) as { description?: string };
    description = (body.description ?? '').trim();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!description || description.length < 4) {
    return NextResponse.json({ ok: false, error: 'description이 필요합니다(최소 4자).' }, { status: 400 });
  }
  if (description.length > 2000) {
    return NextResponse.json({ ok: false, error: 'description이 너무 깁니다(2000자 이하).' }, { status: 400 });
  }

  let mods: { ft: FromTextModule; asm: AssemblyModule };
  try {
    mods = await load();
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'pipeline load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  // 요청 정합 검사(intent-match, 260717 — "시킨 것과 다른 걸 만든다" 대응):
  // AI=검증 가능한 요구 추출만 · 판정=결정론 실측 · 검증 불가=UNVERIFIABLE 정직 표기.
  // 실패해도 생성은 막지 않음(null) — 단, 불일치는 그물 패널에 노출.
  type IMMod = {
    CLAIMS_PROMPT: (d: string) => string; CLAIMS_SCHEMA: unknown;
    verifyClaims: (claims: unknown[], a: unknown) => { results: Array<{ verdict: string; note: string; text: string; kind: string }>; matched: number; mismatched: number; unverifiable: number };
    verifyAlignmentClaims: (claims: unknown[], al: unknown) => { results: Array<{ verdict: string; note: string; text: string; kind: string }>; matched: number; mismatched: number; unverifiable: number };
  };
  const intentCheck = async (mods2: { ft: FromTextModule }, description2: string, asm2: unknown, alignment?: unknown) => {
    try {
      const p2 = join(process.cwd(), 'scripts', 'drawing-to-3d', 'intent-match.mjs');
      const im = (await import(/* webpackIgnore: true */ pathToFileURL(p2).href)) as IMMod;
      const { data: cd } = await mods2.ft.callAiJson(im.CLAIMS_PROMPT(description2), im.CLAIMS_SCHEMA, CLAIMS_OPTS as never);
      const claims = (cd as { claims?: unknown[] })?.claims ?? [];
      if (!claims.length) return null;
      const base = im.verifyClaims(claims, asm2);
      if (alignment) {
        const al = im.verifyAlignmentClaims(claims, alignment);
        for (let i = 0; i < base.results.length; i++) {
          // 선형 어휘(연장·R·곡선·구조물)는 부품 매칭이 아니라 alignment 실측이 정답 —
          // 확정 판정이면 base 의 UNVERIFIABLE 뿐 아니라 거짓 MISMATCH 도 대체(MATCH 는 유지)
          if (base.results[i].verdict !== 'MATCH' && al.results[i] && al.results[i].verdict !== 'UNVERIFIABLE') base.results[i] = al.results[i];
        }
        base.matched = base.results.filter((q) => q.verdict === 'MATCH').length;
        base.mismatched = base.results.filter((q) => q.verdict === 'MISMATCH').length;
        base.unverifiable = base.results.length - base.matched - base.mismatched;
      }
      return base;
    } catch { return null; }
  };

  try {
    // ── 게이트-교정 루프 (compose.composeWithGate 패턴을 어셈블리에 적용) ──
    // textToAssembly 의 스키마 준수 신뢰성이 낮아, buildAssembly 게이트 오류를
    // AI 에 되먹여 params 를 고쳐 최대 3라운드 재시도한다(§2.1 교정루프).
    /**
     * ★260801 — `rounds` 는 이미 응답에 실렸지만 **소요 시간과 단계 구성은 없었다.**
     *   두 라우트가 **같은 모양**으로 내보내야 화면이 하나로 그릴 수 있다.
     */
    const trace = new TraceRecorder();
    const MAX_ROUNDS = 3;
    let assembly: Assembly | null = null;
  let placeCorrections: Array<Record<string, unknown>> = [];
  // 어휘 오분류 교정 내역(260803) — 배치 보정과 **별개로** 공개한다. 무엇이 바뀌었는지
  // 사용자가 알아야 조용한 수정이 되지 않는다.
  let typeCorrections: Array<Record<string, unknown>> = [];
  // 최종 라운드에서 못 고쳐 제외한 부품(260803). ⚠ 질량이 그만큼 **과소**다 — 응답에
  // 원본 파라미터까지 실어, 사용자가 값을 채워 되살릴 수 있게 한다.
  let droppedParts: Array<Record<string, unknown>> = [];
  // 템플릿을 못 써서 자유형으로 갔을 때 그 사유(260803) — 다음 아키타입 우선순위의 근거.
  let templateMiss: string | null = null;
  // 근거 요약(260803 B1) — observed/assumed 분포. 화면이 "검증됨"과 "조건부"를 구분해 표시한다.
  let provenance: Record<string, unknown> | null = null;
    let built: BuiltAssembly | null = null;
    let lastErrors: string[] = [];

    const catalog = await templateCatalog().catch(() => '');
    // ⚠ 어휘는 ALL_TYPES 에서 생성한다 — 라우트가 자기 목록을 들면 또 갈린다(§단일소스).
    const vocab = mods.ft.VOCAB_SPEC();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const prompt = (round === 0 || !assembly
        ? BASE_PROMPT(description, vocab)
        : FIX_PROMPT(description, lastErrors, assembly, vocab)).replace('{{CATALOG}}', catalog);
      const { data } = await mods.ft.callAiJson(prompt, null, AI_OPTS);
      const hasCA = !!(data && typeof (data as { civilAlignment?: unknown }).civilAlignment === 'object');
      const tpl = (data as { template?: { domain?: string; id?: string; params?: Record<string, unknown> } })?.template;
      const hasTpl = !!(tpl && typeof tpl === 'object' && typeof tpl.domain === 'string' && typeof tpl.id === 'string');
      if (!data || (!hasCA && !hasTpl && (!Array.isArray(data.parts) || data.parts.length === 0))) {
        lastErrors = ['빈 어셈블리(parts 없음 — 선형이면 civilAlignment, 정형 구조물이면 template 선언)'];
        continue; // 다음 라운드에서 재시도
      }
      // §템플릿 선언(260717 챗 개방): AI=선언만, 결정론 템플릿이 형상·측점·도서 생성
      if (hasTpl && !hasCA) {
        const dp = join(process.cwd(), 'scripts', 'drawing-to-3d', 'domain-assemblies.mjs');
        const dm = (await import(/* webpackIgnore: true */ pathToFileURL(dp).href)) as { buildAssemblyTemplate: (d: string, t: string, p: Record<string, unknown>) => (Assembly & { alignmentErrors?: string[] }) | null };
        const built2 = dm.buildAssemblyTemplate(tpl!.domain!, tpl!.id!, tpl!.params ?? {});
        if (!built2) { lastErrors = [`template ${tpl!.domain}/${tpl!.id}: 카탈로그에 없는 id — 카탈로그의 domain/id 만 사용`]; continue; }
        if (built2.alignmentErrors?.length) { assembly = { ...built2, template: tpl } as Assembly; lastErrors = built2.alignmentErrors; continue; }
        assembly = built2;
        placeCorrections = [];
        built = mods.asm.buildAssembly(assembly);
        if (built.ok) {
          let intentMatch = await intentCheck(mods, description, assembly, (assembly as { alignment?: unknown }).alignment);
          // 교정 라운드: 불일치 판정문 되먹임 → 템플릿 params 만 재선언(조건부 채택 — parts 경로와 동일 게이트)
          if (intentMatch && intentMatch.mismatched > 0) {
            const before = intentMatch.mismatched;
            let adopted = false;
            try {
              const notes = intentMatch.results.filter((q) => q.verdict === 'MISMATCH').map((q) => `${q.text} → ${q.note}`).slice(0, 8);
              const { data: fd } = await mods.ft.callAiJson(
                `직전 template 선언(${tpl!.domain}/${tpl!.id})의 결과가 요청과 실측 대조에서 불일치했다. params 만 고친 {"template":{...}} JSON 하나만 다시 내라(키·범위는 카탈로그).\n[요청] "${description}"\n[불일치]\n${notes.map((m) => '- ' + m).join('\n')}\n직전: ${JSON.stringify(tpl)}\nJSON 하나만.`,
                null, AI_OPTS);
              const t2 = (fd as { template?: { domain?: string; id?: string; params?: Record<string, unknown> } })?.template;
              if (t2?.domain && t2?.id) {
                const a2 = dm.buildAssemblyTemplate(t2.domain, t2.id, t2.params ?? {});
                if (a2 && !a2.alignmentErrors?.length) {
                  const b2 = mods.asm.buildAssembly(a2);
                  const okDesign = !(b2.designOk === false && built.designOk === true);
                  if (b2.ok && okDesign) {
                    const im2 = await intentCheck(mods, description, a2, (a2 as { alignment?: unknown }).alignment);
                    if (im2 && im2.mismatched < before && im2.matched >= intentMatch.matched) {
                      assembly = a2; built = b2; intentMatch = im2; adopted = true;
                    }
                  }
                }
              }
            } catch { /* 원본 유지 */ }
            (intentMatch as { repair?: unknown }).repair = { attempted: true, adopted, before, after: intentMatch.mismatched };
          }
          if (intentMatch) await recordIntentMatch(description, tpl!.domain!, intentMatch);
          const lodT = lodExtras(mods.asm, assembly as Assembly);
          return NextResponse.json({
            ok: true, assembly: lodT.assembly, draft: lodT.draft, openscad: built.openscad,
            parts: built.parts ?? (assembly as { parts?: unknown[] }).parts,
            interferences: built.interferences ?? [], contacts: built.contacts ?? [],
            placeCorrections: [], welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
            composeIntent: built.composeIntent ?? null, structural: built.structural ?? null,
            support: built.support ?? null, pipes: built.pipes ?? null, designOk: built.designOk ?? null,
            intentMatch,
            domain: tpl!.domain, template: tpl, gateErrors: [], rounds: round + 1,
          });
        }
        assembly = { ...(assembly ?? {}), template: tpl } as Assembly;
        lastErrors = built.gateErrors ?? ['템플릿 게이트 실패'];
        continue;
      }
      // §D 토목 선형 개방: AI가 civilAlignment 를 선언하면 parts 가 아니라 **결정론 템플릿**이
      // 형상·측점·곡선·구조물을 생성(자동 배치 보정 불요 — 템플릿=정합). 게이트 거부 문구는
      // 기존 3라운드 재시도로 AI 에게 그대로 피드백된다.
      const ca = (data as { civilAlignment?: Record<string, unknown> }).civilAlignment;
      if (ca && typeof ca === 'object' && Array.isArray((ca as { ips?: unknown[] }).ips)) {
        const dp = join(process.cwd(), 'scripts', 'drawing-to-3d', 'domain-assemblies.mjs');
        const dm = (await import(/* webpackIgnore: true */ pathToFileURL(dp).href)) as { buildAssemblyTemplate: (d: string, t: string, p: Record<string, unknown>) => Assembly & { alignmentErrors?: string[] } };
        assembly = dm.buildAssemblyTemplate('civil', 'retaining_wall_alignment', ca);
        placeCorrections = [];
        built = mods.asm.buildAssembly(assembly);
        if (built.ok) {
          let intentMatch = await intentCheck(mods, description, assembly, (assembly as { alignment?: unknown }).alignment);
          // 선형 경로 의도 교정 라운드(1회): AI 는 civilAlignment 선언 값만 고치고
          // 형상은 결정론 템플릿이 재생성 — 채택 게이트는 parts 경로와 동일.
          if (intentMatch && intentMatch.mismatched > 0) {
            const before = intentMatch.mismatched;
            let adopted = false;
            try {
              const notes = intentMatch.results
                .filter((q) => q.verdict === 'MISMATCH').map((q) => `${q.text} → ${q.note}`).slice(0, 8);
              const { data: fd } = await mods.ft.callAiJson(INTENT_FIX_CA_PROMPT(description, notes, ca), null, AI_OPTS);
              const ca2 = (fd as { civilAlignment?: Record<string, unknown> })?.civilAlignment;
              if (ca2 && typeof ca2 === 'object' && Array.isArray((ca2 as { ips?: unknown[] }).ips)) {
                const asm2 = dm.buildAssemblyTemplate('civil', 'retaining_wall_alignment', ca2);
                const b2 = mods.asm.buildAssembly(asm2);
                const okDesign = !(b2.designOk === false && built.designOk === true);
                if (b2.ok && okDesign) {
                  const im2 = await intentCheck(mods, description, asm2, (asm2 as { alignment?: unknown }).alignment);
                  if (im2 && im2.mismatched < before && im2.matched >= intentMatch.matched) {
                    assembly = asm2; built = b2; intentMatch = im2; adopted = true;
                  }
                }
              }
            } catch { /* 교정 실패=원본 유지 */ }
            (intentMatch as { repair?: unknown }).repair = { attempted: true, adopted, before, after: intentMatch.mismatched };
          }
          if (intentMatch) await recordIntentMatch(description, 'civil', intentMatch);
          const lodC = lodExtras(mods.asm, assembly as Assembly);
          return NextResponse.json({
            ok: true, assembly: lodC.assembly, draft: lodC.draft, openscad: built.openscad,
            parts: built.parts ?? (assembly as { parts?: unknown[] }).parts,
            interferences: built.interferences ?? [], contacts: built.contacts ?? [],
            placeCorrections: [], welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
            composeIntent: built.composeIntent ?? null, structural: built.structural ?? null,
            support: built.support ?? null, pipes: built.pipes ?? null, designOk: built.designOk ?? null,
            intentMatch,
            domain: 'civil', gateErrors: [], rounds: round + 1,
          });
        }
        // FIX_PROMPT 의 prev 에 원 선언(civilAlignment)이 실리도록 — AI 가 값만 고쳐 재선언 가능
        assembly = { ...(assembly ?? {}), civilAlignment: ca } as Assembly;
        lastErrors = built.gateErrors ?? ['선형 게이트 실패'];
        continue; // 거부 문구를 다음 라운드 프롬프트로 피드백
      }
      /**
       * ★260803 — **어휘 오분류 결정론 교정.** 배치 보정보다 **먼저** 돈다.
       *
       * 라이브에서 마찰 와셔가 `flange` 로 분류돼 게이트 60건이 쏟아졌다. 그런데
       * 「외경·내경·두께가 성립하고 볼트원이 통째로 없으면 와셔」는 판단이 아니라 **규칙**이라
       * LLM 왕복 없이 고쳐진다 → 다음 라운드로 넘기지 않고 **이 라운드에서 결과를 낸다.**
       * ⚠ 배치 보정 앞에 둔다 — 타입이 바뀌면 AABB 가 바뀌고, 그래야 배치가 옳은 형상 위에서 계산된다.
       * ⚠ 없는 치수는 지어내지 않는다(볼트원이 *일부만* 있으면 그대로 에러). `auto-fix.mjs` 참조.
       */
      /**
       * ★260803 — **마지막 라운드에서는 드롭한다.** 실측: 부품 4개 중 1개가 게이트에 걸리면
       * `buildAssembly` 가 `parts:0 · openscad:false` 를 내 **멀쩡한 3개까지 버려졌다.**
       * 3라운드를 다 쓰고도 못 고친 부품은 빼고 나머지로 조립한다 — 빈 화면 대신 결과를 낸다.
       * ⚠ 드롭은 **최후 수단**이다. 첫 라운드에 드롭하면 고칠 수 있었던 부품을 버린다.
       */
      const lastRound = round === MAX_ROUNDS - 1;
      const af = await (async () => {
        try {
          const ap = join(process.cwd(), 'scripts', 'drawing-to-3d', 'auto-fix.mjs');
          const am = (await import(/* webpackIgnore: true */ pathToFileURL(ap).href)) as {
            resolveAssembly: (a: unknown, o?: { drop?: boolean }) => {
              assembly: Assembly; corrections: Record<string, unknown>[];
              dropped: Record<string, unknown>[]; allFailed: boolean;
            };
          };
          return am.resolveAssembly(data, { drop: lastRound });
        } catch { return { assembly: data as Assembly, corrections: [], dropped: [], allFailed: false }; }
      })();
      typeCorrections = af.corrections;
      droppedParts = af.dropped;
      /**
       * ★자유형으로 떨어진 이유를 받아 둔다 — **다음에 만들 아키타입 목록**이 된다.
       * 템플릿 경로가 48/55 designOk 인데 자유형이 부유를 낳으므로, 카탈로그를 넓히는 것이
       * 가장 큰 개선이다. 무엇이 없어서 못 썼는지를 사람이 추측하지 않게 한다.
       */
      const miss = String((data as { templateMiss?: unknown })?.templateMiss ?? '').trim();
      if (miss) {
        templateMiss = miss.slice(0, 200);
        void recordFailure({ stage: 'template-miss', input: description, errors: [templateMiss] });
      }
      /**
       * ★260803 (B1) — **축 2: 이 숫자가 어디서 왔는가.**
       * 형상은 나온다(§0.4). 그런데 어느 치수가 사용자가 준 값이고 어느 것이 LLM 이 채운
       * 통상값인지 표시가 없으면 **가정을 검증된 것처럼 내보내게 된다.**
       * 원문 숫자 대조(결정론)로 `observed`/`assumed` 를 가른다 — LLM 을 다시 부르지 않는다.
       */
      const pv = await (async () => {
        try {
          const pp = join(process.cwd(), 'scripts', 'drawing-to-3d', 'provenance.mjs');
          const pm = (await import(/* webpackIgnore: true */ pathToFileURL(pp).href)) as {
            annotateAssembly: (a: unknown, t: string, o?: { repairedIds?: string[] }) => Assembly;
            assemblyProvenance: (a: unknown, o?: { dropped?: unknown[] }) => Record<string, unknown>;
          };
          const annotated = pm.annotateAssembly(af.assembly, description);
          return { assembly: annotated, provenance: pm.assemblyProvenance(annotated, { dropped: af.dropped }) };
        } catch { return { assembly: af.assembly, provenance: null }; }
      })();
      provenance = pv.provenance;
      // AI 배치 결정론 보정(§12.1-4 v1): 부유 드롭·깊은 관통 분리 — 내역은 응답에 공개
      const corrected = mods.asm.autoPlaceCorrect(pv.assembly);
      assembly = corrected.assembly;
      placeCorrections = corrected.corrections;
      built = mods.asm.buildAssembly(assembly);
      if (built.ok) {
        let intentMatch = await intentCheck(mods, description, assembly);
        // AI 가 임의로 채운 값 자가보고(라벨 명시) — "조용한 기본값"이 불일치의 주원인
        const assumptions = Array.isArray((data as { assumptions?: unknown[] }).assumptions)
          ? ((data as { assumptions: unknown[] }).assumptions).filter((q) => typeof q === 'string').slice(0, 12)
          : [];
        // 의도 교정 라운드(1회): 불일치 판정문 되먹임 → 재빌드 → 재검증.
        // 채택 조건: 게이트 통과 + designOk 악화 없음 + 불일치 감소 + 일치 비감소. 내역은 repair 로 공개.
        if (intentMatch && intentMatch.mismatched > 0) {
          const before = intentMatch.mismatched;
          let adopted = false;
          try {
            const notes = intentMatch.results
              .filter((q) => q.verdict === 'MISMATCH').map((q) => `${q.text} → ${q.note}`).slice(0, 8);
            const { data: fd } = await mods.ft.callAiJson(INTENT_FIX_PROMPT(description, notes, assembly, vocab), null, AI_OPTS);
            if (fd && Array.isArray(fd.parts) && fd.parts.length) {
              const c2 = mods.asm.autoPlaceCorrect(fd);
              const b2 = mods.asm.buildAssembly(c2.assembly);
              const okDesign = !(b2.designOk === false && built.designOk === true);
              if (b2.ok && okDesign) {
                const im2 = await intentCheck(mods, description, c2.assembly);
                if (im2 && im2.mismatched < before && im2.matched >= intentMatch.matched) {
                  assembly = c2.assembly; placeCorrections = c2.corrections; built = b2; intentMatch = im2;
                  adopted = true;
                }
              }
            }
          } catch { /* 교정 실패=원본 유지(생성은 막지 않음) */ }
          (intentMatch as { repair?: unknown }).repair = { attempted: true, adopted, before, after: intentMatch.mismatched };
        }
        if (intentMatch && assumptions.length) (intentMatch as { assumptions?: string[] }).assumptions = assumptions as string[];
        if (intentMatch) await recordIntentMatch(description, (assembly as { domain?: string }).domain ?? null, intentMatch);
        const lodA = lodExtras(mods.asm, assembly as Assembly);
        return NextResponse.json({
          ok: true, assembly: lodA.assembly, draft: lodA.draft, openscad: built.openscad,
          parts: built.parts ?? assembly.parts,
          interferences: built.interferences ?? [],
          contacts: built.contacts ?? [], // §12.7.3 접촉/체결 후보(과탐 분리)
          placeCorrections, // 자동 배치 보정 내역(정직 공개)
          typeCorrections,  // 어휘 오분류 자동 교정 내역(260803 — 조용한 수정 방지)
          droppedParts,     // 못 고쳐 제외한 부품 + 원본 파라미터(260803). ⚠ 질량이 그만큼 과소
          templateMiss,     // 자유형으로 간 사유(260803) — 카탈로그 확장 근거
          provenance,       // 근거 요약(260803 B1) — verifiable=false 면 결과는 **조건부**다
          degraded: droppedParts.length > 0, // 부분 산출임을 화면이 한 번에 알 수 있게
          welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
          composeIntent: built.composeIntent ?? null,
          structural: built.structural ?? null,
          support: built.support ?? null, // 그물: 부유·면접촉(매립 제안)
          pipes: built.pipes ?? null, designOk: built.designOk ?? null,
          intentMatch, // 요청 정합(의도↔형상 실측 대조 — 불일치 노출 + 교정 라운드 내역)
          gateErrors: [], rounds: round + 1,
          // ★ 과정을 같은 모양으로 — extract 라우트와 필드명을 맞춘다.
          ...(() => {
            trace.attempt(round + 1).mark('gate', 'ok');
            const pipeline = trace.done();
            return { pipeline, pipelineSummary: traceSummary(pipeline) };
          })(),
        });
      }
      lastErrors = built.gateErrors ?? ['게이트 실패'];
    }

    // 3라운드로도 유효 형상 실패 — 잘못된 형상 방출 대신 정직하게 오류 반환.
    // ⚠ 실패해도 과정을 싣는다 — 무엇을 몇 번 시도하다 못 했는지가 실패에선 더 중요하다.
    // ★260803 — **실패를 남긴다.** 종전에는 화면에 뿌리고 끝이라 무엇이 자주 깨지는지 알 수 없었다.
    //   지문은 PII 없이 만들고 원문은 저장하지 않는다(`failureLog.ts` 참조).
    void recordFailure({
      stage: 'gate', input: description, errors: lastErrors,
      partTypes: (assembly?.parts ?? []).map((p) => String((p as { type?: unknown }).type ?? '')).filter(Boolean),
    });
    trace.attempt(MAX_ROUNDS).mark('gate', 'failed', `게이트 오류 ${lastErrors.length}건`);
    const failTrace = trace.done();
    return NextResponse.json({
      ok: false, stage: 'gate', assembly,
      gateErrors: lastErrors, interferences: built?.interferences ?? [], rounds: MAX_ROUNDS,
      pipeline: failTrace, pipelineSummary: traceSummary(failTrace),
    }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 키 미설정은 503(설정 문제) — 백엔드를 Gemini↔OpenAI 로 바꿔도 맞게 남도록 둘 다 본다.
    const status = /GEMINI_API_KEY|OPENAI_API_KEY/.test(msg) ? 503 : 502;
    return NextResponse.json({ ok: false, error: 'assemble failed: ' + msg.slice(0, 200) }, { status });
  }
}
