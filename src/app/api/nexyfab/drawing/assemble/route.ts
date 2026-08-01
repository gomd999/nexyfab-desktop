/**
 * POST /api/nexyfab/drawing/assemble
 *
 * 멀티바디 어셈블리 배선 — 텍스트 → AI 어셈블리 계획(부품별 독립 body + 배치)
 * → 결정론 빌드(buildAssembly): 부품별 OpenSCAD + 간섭검사(interferences).
 * drawing-to-3d 방법론 §4(복합=부품 분해) / §12.1 #4(Assembly Topology Graph).
 *
 * 구현: from-text.mjs(textToAssembly)·assembly.mjs(buildAssembly)를 webpackIgnore
 * 런타임 import(compose 라우트와 동일 패턴). GEMINI_API_KEY env-first.
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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Assembly = { name?: string; parts?: Array<Record<string, unknown>> };
type BuiltAssembly = { ok: boolean; openscad?: string; parts?: unknown; gateErrors?: string[]; interferences?: unknown[]; contacts?: unknown[]; welds?: unknown[]; weldTotalMm?: number; composeIntent?: unknown; structural?: unknown; support?: unknown; pipes?: unknown; designOk?: boolean };
type FromTextModule = {
  callGeminiJson: (prompt: string, schema: unknown, o?: { models?: string[]; maxOutputTokens?: number; thinkingBudget?: number }) => Promise<{ data: Assembly; model?: string; repaired?: boolean }>;
  ASSEMBLY_SCHEMA: unknown;
};
// MAX_TOKENS 원인은 2.5 "thinking"(출력토큰 소진) → thinkingBudget:0 으로 차단.
// + response_schema 없이 free-form(플랫 스키마 토큰폭주 회피). flash 고정(속도).
const GEMINI_OPTS = { models: ['gemini-2.5-flash'], maxOutputTokens: 12000, thinkingBudget: 0 };
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

// type별 정확한 params (reconstruct.mjs PARAMS 와 동기화 — AI 가 params 를 섞지 않도록 명시).
const TYPE_SPEC = `각 부품 type 의 params 는 아래 목록만 사용(다른 키 금지, 모든 값은 양수 mm):
- plate_with_holes: width, depth, thickness (선택 holes:[{x,y,d}])
- stepped_plate: width, depth, thickness, stepWidth, stepThickness
- l_bracket: legA, legB, width, thickness
- flange: outerDia, boreDia, thickness, bcd, boltHoleD, boltCount
- bent_sheet: webWidth, flangeHeight, length, thickness
- tube: outerDia, innerDia, length   (원형 파이프/중공)
- rect_tube: width, height, wallThk, length   (각관/중공)
- box: width, depth, height   (속찬 직육면체 블록)
- cylinder: diameter, length   (속찬 원기둥 봉·포스트)
- gusset: legA, legB, thickness   (직각삼각 거셋 보강판)
- base_plate: width, depth, thickness, boltDia   (4모서리 볼트홀 자동 베이스판)
- spur_gear: module, teeth, thickness, boreDia   (인벌류트 스퍼기어 — 외경=module×(teeth+2), 원점=기어중심, boreDia 0=무보어)
- hex_bolt: threadDia, length   (육각볼트 M3~M36 표준호칭 — 머리치수 자동, 원점=자루 끝, +Z로 머리)
- sheet_profile: thickness, width, segments:[len...], angles:[deg...]   (다단 절곡 판금 — 단면=세그먼트 길이열+절곡각열(angles는 segments−1개, |a|≤120), width=압출 길이. 예: 햇채널 segments:[20,40,60,40,20], angles:[90,-90,-90,90])
- wall_with_openings: length, thickness, height, openings:[{x,w,h,sill}]   (벽체 — X길이·Y두께·Z높이. 문=sill 0(예 w900 h2100), 창=sill>0. 개구 X구간 겹침 금지)

부품 선택 필드(정확도·물량에 중요):
- material: STS316 | STS304 | steel | aluminum | concrete | timber | PVC 중 하나. 콘크리트 구조물(RC 보·기둥·슬래브·옹벽)은 반드시 "concrete", 목구조(데크·파고라·가구)는 "timber".
- role: column | beam | slab | joist | deck | floor | wall | table | counter | frame | motor | panel 등 — 계통색·도면 라벨에 쓰임.`;

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

const BASE_PROMPT = (desc: string) => `자연어 제품 설명을 "부품별 독립 body" 복합 어셈블리 계획(JSON)으로 변환하라.
어휘 15종: plate_with_holes / stepped_plate / l_bracket / flange / bent_sheet / tube / rect_tube / box / cylinder / gusset / base_plate / spur_gear / hex_bolt / sheet_profile / wall_with_openings.
${TYPE_SPEC}
좌표: 전역 원점(0,0,0), 각 부품 로컬 원점이 at(tx,ty,tz mm; rx,ry,rz deg) 에 놓임. 판재는 z=0 바닥, 위에 얹으면 tz=판두께.
부피 침투 없이 접촉 배치. 치수 미기입은 통상값.

**출력은 아래 형식의 JSON 하나만**(다른 텍스트·코드펜스 금지):
{"name":"...","parts":[{"id":"post1","type":"rect_tube","params":{"width":60,"height":60,"wallThk":3,"length":1000},"at":{"tx":0,"ty":0,"tz":0,"rx":0,"ry":0,"rz":0}}]}
- parts 배열은 최소 2개 이상, 각 부품은 id·type·params·at 을 모두 포함.
- params 는 그 type 의 정확한 키만(위 목록). at 의 6개 값은 항상 숫자로.
- 설명에 없어서 네가 정한 값(치수·수량·배치)이 있으면 "assumptions":["높이 미지정 → 700mm 가정", ...] 로 전부 나열(숨기지 마라).

예외 — 옹벽·도로변 벽 등 "선형(노선)" 설계 요청이면 parts 대신 civilAlignment 하나만 선언:
{"name":"...","civilAlignment":{"ips":[[0,0],[120000,0],[200000,60000]],"curves":[{"ip":1,"R":30000}],"structures":[{"sta":60000,"type":"culvert"}],"H":3000,"baseWidth":2000,"stemThickness":300,"baseThickness":400,"toeLength":600}}
- 좌표·측점·곡선 기하·도면집·검증은 결정론 엔진이 수행 — 경로 좌표를 지어내지 마라.
- **곡선은 방향이 꺾이는 내부 IP 에만 붙는다**: curves 를 쓰려면 ips 가 3점 이상이고 해당 IP 에서 실제로 꺾여야 한다(직선 2점에 곡선 선언 금지 — 곡선 요구가 있으면 중간 IP 를 만들어 꺾어라. 총 연장은 ips 경로 길이로 맞춘다).
- 구조물 요구(암거·집수정·신축이음)는 structures:[{"sta":측점mm,"type":"culvert"|"catch_basin"|"expansion_joint"}] 로 반드시 선언.
- 게이트 거부 문구(예: "TL 합>구간장 — R 축소")를 받으면 해당 값만 고쳐 다시 선언하라.

예외 2 — 아래 카탈로그의 **정형 구조물**(교량·캐노피·골조·파고라·데크·실내 유닛 등) 요청이면 parts 대신 template 하나만 선언(형상·간섭·도면집·물량=결정론 엔진 — 부품을 직접 만들지 마라):
{"name":"...","template":{"domain":"bridge","id":"arch_bridge","params":{"mainSpan":120000,"rise":26400}}}
[템플릿 카탈로그 — params 는 목록의 키만·범위 내 숫자. 미기입=기본값(assumptions 에 병기)]
{{CATALOG}}

설명: "${desc}"`;

const FIX_PROMPT = (desc: string, errs: string[], prev: Assembly) => `직전 어셈블리 계획이 결정론 게이트에서 실패했다. **각 부품의 type 에 맞는 정확한 params 로만** 고쳐라.
게이트 오류: ${errs.join(' | ')}
${TYPE_SPEC}
직전 계획(수정 대상): ${JSON.stringify(prev).slice(0, 1800)}
원래 설명: "${desc}"
JSON 하나만 출력.`;

// 의도 교정 라운드(260717): 게이트는 통과했지만 요청 정합(intent-match)에서 불일치가
// 나온 경우, 결정론 판정문을 그대로 되먹여 1회 재수정. 채택은 조건부(불일치 감소+일치 비감소).
const INTENT_FIX_PROMPT = (desc: string, mismatches: string[], prev: Assembly) => `직전 어셈블리는 형상 게이트는 통과했지만, 사용자 요청과 실측 대조에서 아래 항목이 **불일치**로 판정됐다.
요청을 다시 읽고 불일치 항목만 고친 전체 JSON 을 다시 내라(스키마 동일, 일치한 값은 유지).
[사용자 요청] "${desc}"
[불일치 판정(결정론 실측)]
${mismatches.map((m) => '- ' + m).join('\n')}
${TYPE_SPEC}
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
      const { data: cd } = await mods2.ft.callGeminiJson(im.CLAIMS_PROMPT(description2), im.CLAIMS_SCHEMA, CLAIMS_OPTS as never);
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
    // Gemini 에 되먹여 params 를 고쳐 최대 3라운드 재시도한다(§2.1 교정루프).
    /**
     * ★260801 — `rounds` 는 이미 응답에 실렸지만 **소요 시간과 단계 구성은 없었다.**
     *   두 라우트가 **같은 모양**으로 내보내야 화면이 하나로 그릴 수 있다.
     */
    const trace = new TraceRecorder();
    const MAX_ROUNDS = 3;
    let assembly: Assembly | null = null;
  let placeCorrections: Array<Record<string, unknown>> = [];
    let built: BuiltAssembly | null = null;
    let lastErrors: string[] = [];

    const catalog = await templateCatalog().catch(() => '');
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const prompt = (round === 0 || !assembly
        ? BASE_PROMPT(description)
        : FIX_PROMPT(description, lastErrors, assembly)).replace('{{CATALOG}}', catalog);
      const { data } = await mods.ft.callGeminiJson(prompt, null, GEMINI_OPTS);
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
              const { data: fd } = await mods.ft.callGeminiJson(
                `직전 template 선언(${tpl!.domain}/${tpl!.id})의 결과가 요청과 실측 대조에서 불일치했다. params 만 고친 {"template":{...}} JSON 하나만 다시 내라(키·범위는 카탈로그).\n[요청] "${description}"\n[불일치]\n${notes.map((m) => '- ' + m).join('\n')}\n직전: ${JSON.stringify(tpl)}\nJSON 하나만.`,
                null, GEMINI_OPTS);
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
              const { data: fd } = await mods.ft.callGeminiJson(INTENT_FIX_CA_PROMPT(description, notes, ca), null, GEMINI_OPTS);
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
      // AI 배치 결정론 보정(§12.1-4 v1): 부유 드롭·깊은 관통 분리 — 내역은 응답에 공개
      const corrected = mods.asm.autoPlaceCorrect(data);
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
            const { data: fd } = await mods.ft.callGeminiJson(INTENT_FIX_PROMPT(description, notes, assembly), null, GEMINI_OPTS);
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
    trace.attempt(MAX_ROUNDS).mark('gate', 'failed', `게이트 오류 ${lastErrors.length}건`);
    const failTrace = trace.done();
    return NextResponse.json({
      ok: false, stage: 'gate', assembly,
      gateErrors: lastErrors, interferences: built?.interferences ?? [], rounds: MAX_ROUNDS,
      pipeline: failTrace, pipelineSummary: traceSummary(failTrace),
    }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /GEMINI_API_KEY/.test(msg) ? 503 : 502;
    return NextResponse.json({ ok: false, error: 'assemble failed: ' + msg.slice(0, 200) }, { status });
  }
}
