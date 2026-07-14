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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Assembly = { name?: string; parts?: Array<Record<string, unknown>> };
type BuiltAssembly = { ok: boolean; openscad?: string; parts?: unknown; gateErrors?: string[]; interferences?: unknown[]; welds?: unknown[]; weldTotalMm?: number; composeIntent?: unknown; structural?: unknown };
type FromTextModule = {
  callGeminiJson: (prompt: string, schema: unknown, o?: { models?: string[]; maxOutputTokens?: number; thinkingBudget?: number }) => Promise<{ data: Assembly; model?: string; repaired?: boolean }>;
  ASSEMBLY_SCHEMA: unknown;
};
// MAX_TOKENS 원인은 2.5 "thinking"(출력토큰 소진) → thinkingBudget:0 으로 차단.
// + response_schema 없이 free-form(플랫 스키마 토큰폭주 회피). flash 고정(속도).
const GEMINI_OPTS = { models: ['gemini-2.5-flash'], maxOutputTokens: 12000, thinkingBudget: 0 };
type AssemblyModule = { buildAssembly: (asm: Assembly) => BuiltAssembly };

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

설명: "${desc}"`;

const FIX_PROMPT = (desc: string, errs: string[], prev: Assembly) => `직전 어셈블리 계획이 결정론 게이트에서 실패했다. **각 부품의 type 에 맞는 정확한 params 로만** 고쳐라.
게이트 오류: ${errs.join(' | ')}
${TYPE_SPEC}
직전 계획(수정 대상): ${JSON.stringify(prev).slice(0, 1800)}
원래 설명: "${desc}"
JSON 하나만 출력.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-assemble:${ip}`, 8, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });

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

  try {
    // ── 게이트-교정 루프 (compose.composeWithGate 패턴을 어셈블리에 적용) ──
    // textToAssembly 의 스키마 준수 신뢰성이 낮아, buildAssembly 게이트 오류를
    // Gemini 에 되먹여 params 를 고쳐 최대 3라운드 재시도한다(§2.1 교정루프).
    const MAX_ROUNDS = 3;
    let assembly: Assembly | null = null;
    let built: BuiltAssembly | null = null;
    let lastErrors: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const prompt = round === 0 || !assembly
        ? BASE_PROMPT(description)
        : FIX_PROMPT(description, lastErrors, assembly);
      const { data } = await mods.ft.callGeminiJson(prompt, null, GEMINI_OPTS);
      if (!data || !Array.isArray(data.parts) || data.parts.length === 0) {
        lastErrors = ['빈 어셈블리(parts 없음)'];
        continue; // 다음 라운드에서 재시도
      }
      assembly = data;
      built = mods.asm.buildAssembly(assembly);
      if (built.ok) {
        return NextResponse.json({
          ok: true, assembly, openscad: built.openscad,
          parts: built.parts ?? assembly.parts,
          interferences: built.interferences ?? [],
          welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
          composeIntent: built.composeIntent ?? null,
          structural: built.structural ?? null,
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
