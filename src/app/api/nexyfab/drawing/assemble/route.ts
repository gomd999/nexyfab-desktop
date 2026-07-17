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
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';

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
// (thinking 토큰이 maxOutputTokens 를 소모하므로 예산은 넉넉히 — 4096은 MAX_TOKENS 절단 실측)
const CLAIMS_OPTS = { models: ['gemini-2.5-flash'], maxOutputTokens: 12000 };
type AssemblyModule = { buildAssembly: (asm: Assembly) => BuiltAssembly; autoPlaceCorrect: (asm: Assembly) => { assembly: Assembly; corrections: Array<Record<string, unknown>> } };

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
- 게이트 거부 문구(예: "TL 합>구간장 — R 축소")를 받으면 해당 값만 고쳐 다시 선언하라.

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
          if (base.results[i].verdict === 'UNVERIFIABLE' && al.results[i] && al.results[i].verdict !== 'UNVERIFIABLE') base.results[i] = al.results[i];
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
    const MAX_ROUNDS = 3;
    let assembly: Assembly | null = null;
  let placeCorrections: Array<Record<string, unknown>> = [];
    let built: BuiltAssembly | null = null;
    let lastErrors: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const prompt = round === 0 || !assembly
        ? BASE_PROMPT(description)
        : FIX_PROMPT(description, lastErrors, assembly);
      const { data } = await mods.ft.callGeminiJson(prompt, null, GEMINI_OPTS);
      const hasCA = !!(data && typeof (data as { civilAlignment?: unknown }).civilAlignment === 'object');
      if (!data || (!hasCA && (!Array.isArray(data.parts) || data.parts.length === 0))) {
        lastErrors = ['빈 어셈블리(parts 없음 — 선형이면 civilAlignment 선언)'];
        continue; // 다음 라운드에서 재시도
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
          const intentMatch = await intentCheck(mods, description, assembly, (assembly as { alignment?: unknown }).alignment);
          return NextResponse.json({
            ok: true, assembly, openscad: built.openscad,
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
        return NextResponse.json({
          ok: true, assembly, openscad: built.openscad,
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
        });
      }
      lastErrors = built.gateErrors ?? ['게이트 실패'];
    }

    // 3라운드로도 유효 형상 실패 — 잘못된 형상 방출 대신 정직하게 오류 반환.
    return NextResponse.json({
      ok: false, stage: 'gate', assembly,
      gateErrors: lastErrors, interferences: built?.interferences ?? [], rounds: MAX_ROUNDS,
    }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /GEMINI_API_KEY/.test(msg) ? 503 : 502;
    return NextResponse.json({ ok: false, error: 'assemble failed: ' + msg.slice(0, 200) }, { status });
  }
}
