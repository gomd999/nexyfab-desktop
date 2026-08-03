/**
 * POST /api/nexyfab/drawing/extract-preset
 *
 * 이미지(도면·스케치·사진) → 분야 파라메트릭 프리셋 매칭 (전 분야 도면→3D).
 * AI(Gemini Vision)는 "어느 템플릿 + 읽힌 치수"만 반환하고, 여기서 결정론으로
 * 검증한다: 템플릿 존재 확인 · 허용 파라미터만 통과 · min/max 클램프 · 저신뢰 정직 반려.
 * 형상 생성은 클라이언트가 판독값을 **확인한 뒤** 기존 POST /preset 으로 수행(확인 단계 필수).
 *
 * caller: { imageBase64, mimeType, domain } →
 *   { ok:true, templateId, labelKo, labelEn, confidence, unit?, values, filled, clamped, notes? }
 * | { ok:false, error, recognized? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { recordFailure } from '@/lib/failureLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ParamSpec { name: string; labelKo: string; unit: string; default: number; min: number; max: number }
interface Template { id: string; labelKo: string; labelEn: string; params: ParamSpec[] }
type PresetModule = {
  listTemplates: (domain?: string) => Template[];
  listAssemblyPresets: (domain?: string) => Promise<Template[]>;
};
type ExtractPresetModule = {
  extractPresetFromImage: (b64: string, mime: string, domainLabel: string, templates: Template[]) =>
    Promise<{
      templateId?: string; confidence?: number; unit?: string; notes?: string;
      // 260803 — 템플릿 미매칭 시 조립 경로로 넘길 부품 서술(같은 vision 호출에서 함께 받는다)
      description?: string;
      params?: Array<{ name: string; value: number }>;
    }>;
};
type FromTextModule = {
  textToAssembly: (d: string) => Promise<{
    assembly: unknown; model?: string; gateErrors?: string[];
    corrections?: unknown[]; dropped?: unknown[]; degraded?: boolean; allFailed?: boolean;
  }>;
};
type AssemblyModule = {
  buildAssembly: (a: unknown) => { ok: boolean; openscad?: string; parts?: unknown[]; gateErrors?: string[]; interferences?: unknown[]; structural?: unknown; designOk?: boolean };
  autoPlaceCorrect: (a: unknown) => { assembly: unknown; corrections: unknown[] };
};

/**
 * ★260803 — **템플릿이 안 맞아도 막다른 길을 만들지 않는다** (제품 원칙 §0.4).
 *
 * 라이브에서 노트북 거치대 사진을 올리면 "이 분야 템플릿과 맞는 형상을 찾지 못했어요"로 끝났다.
 * 원인은 명확하다 — mech 템플릿 18종이 전부 중공업이라 **소비재 아키타입이 0개**다.
 * 그런데 같은 vision 호출이 이미 **부품 서술**을 갖고 있다(`description`). 그걸 조립 경로에 넘기면
 * 형상이 나온다. 조립 경로에는 이미 사다리가 있다(auto-fix → LLM 수리 → 드롭).
 *
 * ⚠ vision 을 **다시 부르지 않는다** — 서술은 첫 호출에서 이미 받아 뒀다.
 * ⚠ 이 경로로 나온 결과는 **템플릿 매칭이 아니다.** `via:'description'` 으로 구분해 보고한다.
 *   사진에서 못 읽은 치수는 LLM 이 통상값으로 채웠을 수 있다 → `provenance` 경고를 같이 싣는다.
 */
async function assemblyFromDescription(description: string): Promise<Record<string, unknown> | null> {
  const desc = String(description ?? '').trim();
  if (desc.length < 10) return null; // 서술이 부실하면 억지로 만들지 않는다
  try {
    const ftPath = join(process.cwd(), 'scripts', 'drawing-to-3d', 'from-text.mjs');
    const asmPath = join(process.cwd(), 'scripts', 'drawing-to-3d', 'assembly.mjs');
    const [ft, asm] = await Promise.all([
      import(/* webpackIgnore: true */ pathToFileURL(ftPath).href) as Promise<FromTextModule>,
      import(/* webpackIgnore: true */ pathToFileURL(asmPath).href) as Promise<AssemblyModule>,
    ]);
    const r = await ft.textToAssembly(desc);
    if (r.allFailed) return null;
    const placed = asm.autoPlaceCorrect(r.assembly);
    const built = asm.buildAssembly(placed.assembly);
    if (!built.ok) return null;
    return {
      assembly: placed.assembly,
      openscad: built.openscad, parts: built.parts,
      interferences: built.interferences ?? [], structural: built.structural ?? null,
      designOk: built.designOk ?? null,
      corrections: r.corrections ?? [], droppedParts: r.dropped ?? [],
      degraded: !!r.degraded,
      model: r.model,
    };
  } catch {
    return null; // 이 경로가 실패해도 원래의 정직한 안내로 되돌아간다
  }
}

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIN_CONFIDENCE = 0.4;
const DOMAIN_LABEL: Record<string, string> = {
  mech: '기계·장비·판금', rack: '가설·랙·경량철골', civil: '토목 소구조물',
  building: '건축 부재', landscape: '조경 구조·배수', interior: '인테리어·상업공간',
};

let _pr: PresetModule | null = null;
let _ex: ExtractPresetModule | null = null;
async function load(): Promise<{ pr: PresetModule; ex: ExtractPresetModule }> {
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  if (!_pr) _pr = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'preset-registry.mjs')).href)) as PresetModule;
  if (!_ex) _ex = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'extract-preset.mjs')).href)) as ExtractPresetModule;
  return { pr: _pr, ex: _ex };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-extract-preset:${ip}`, 6, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  // 구독 정합(2026-07-16): 로그인=shape_chat 슬롯+예산, 익명=합산 리밋(게스트 데모 유지)
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  // 전역 비용 브레이커 — Vision 호출도 AI 일시정지에 복종(감사 2026-07-16)
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ ok: false, error: 'AI가 일시 중지되어 있습니다. 잠시 후 다시 시도하세요.' }, { status: 503 });
  } catch { /* 브레이커 조회 실패는 무시하고 진행 */ }

  let imageBase64: string, mimeType: string, domain: string, kind: string;
  try {
    const body = (await req.json()) as { imageBase64?: string; mimeType?: string; domain?: string; kind?: string };
    imageBase64 = (body.imageBase64 ?? '').replace(/^data:[^,]+,/, '').trim();
    mimeType = (body.mimeType ?? 'image/png').toLowerCase();
    domain = body.domain ?? 'mech';
    kind = body.kind === 'assembly' ? 'assembly' : 'part';
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!imageBase64 || imageBase64.length < 100) return NextResponse.json({ ok: false, error: '이미지가 필요합니다.' }, { status: 400 });
  if (imageBase64.length > 8_000_000) return NextResponse.json({ ok: false, error: '이미지가 너무 큽니다(6MB 이하).' }, { status: 413 });
  if (!ALLOWED_MIME.has(mimeType)) return NextResponse.json({ ok: false, error: 'PNG·JPG·WebP 이미지만 지원합니다.' }, { status: 415 });

  let mods: { pr: PresetModule; ex: ExtractPresetModule };
  try {
    mods = await load();
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'pipeline load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  // kind=assembly → 어셈블리 템플릿 카탈로그(RC 골조·파고라·데크·카페 등)와 매칭
  const templates = kind === 'assembly' ? await mods.pr.listAssemblyPresets(domain) : mods.pr.listTemplates(domain);
  if (!templates?.length) return NextResponse.json({ ok: false, error: '이 분야에는 프리셋 템플릿이 없습니다.' }, { status: 400 });

  // ① Vision — 템플릿 분류 + 치수 판독 (AI = 이해만)
  let raw: Awaited<ReturnType<ExtractPresetModule['extractPresetFromImage']>>;
  try {
    raw = await mods.ex.extractPresetFromImage(imageBase64, mimeType, DOMAIN_LABEL[domain] ?? domain, templates);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /GEMINI_API_KEY/.test(msg) ? 503 : 502;
    return NextResponse.json({ ok: false, error: '이미지 판독 실패: ' + msg.slice(0, 160) }, { status });
  }

  const templateId = String(raw.templateId ?? 'none');
  const confidence = typeof raw.confidence === 'number' ? +raw.confidence.toFixed(2) : 0;
  const tpl = templates.find((t) => t.id === templateId);
  const recognized = { templateId, confidence, unit: raw.unit, notes: raw.notes };

  /**
   * ★260803 — 종전에는 여기가 **막다른 길**이었다(`ok:false` + 안내 문구).
   * 템플릿이 안 맞거나 신뢰도가 낮으면 **부품 서술로 조립 경로**를 태운다.
   * ⚠ 허위 매칭은 여전히 하지 않는다 — 안 맞는 템플릿에 억지로 끼우는 게 아니라
   *   **다른 경로**로 만드는 것이다. 결과에 `via:'description'` 을 달아 구분한다.
   */
  const needsFallback = templateId === 'none' || !tpl || confidence < MIN_CONFIDENCE;
  if (needsFallback) {
    const built = await assemblyFromDescription(String(raw.description ?? ''));
    if (built) {
      return NextResponse.json({
        ok: true, via: 'description', stage: 'assembly', recognized,
        description: raw.description,
        ...built,
        // ⚠ 사진에서 못 읽은 치수는 통상값일 수 있다. 이 경로는 **항상** 확인을 요구한다.
        provenanceWarning: '사진에서 읽히지 않은 치수는 통상값으로 채워졌을 수 있습니다 — 치수를 확인해 주세요.',
      }, { status: 200 });
    }
    /**
     * ★260803 — **여기가 진짜 실패다.** 템플릿도 못 찾고 조립 경로도 못 만들었다.
     * 종전에는 안내 문구만 내고 끝이라 「어떤 제품이 우리 어휘 밖인지」가 안 쌓였다.
     * 지문에 부품 타입이 없으므로 `stage` 와 도메인만으로 집계된다 — 그래도
     * 「mech 에서 template-miss 가 몇 건인가」는 알 수 있고, 그게 아키타입 우선순위다.
     */
    void recordFailure({
      stage: 'template-miss', input: String(raw.description ?? ''),
      errors: [`templateId=${templateId} confidence=${confidence}`], domain,
    });
    // 조립 경로도 실패 — 그때는 정직하게 안내한다(억지 형상보다 낫다).
    if (templateId === 'none' || !tpl) {
      return NextResponse.json({ ok: false, stage: 'recognize', recognized, description: raw.description ?? null, error: '이 사진으로는 형상을 만들지 못했어요. 부품과 치수를 채팅에 글로 알려주시면 조립체로 만들어 드릴게요(예: "노트북 거치대, 하부 베이스 260×220mm, 상판 280×240mm, 힌지 2조..."). 단순 형상이면 템플릿 카드를 직접 고르셔도 됩니다.' }, { status: 200 });
    }
    return NextResponse.json({ ok: false, stage: 'confidence', recognized, description: raw.description ?? null, error: `판독 신뢰도가 낮아요(${Math.round(confidence * 100)}%). 더 선명한 이미지를 올리거나 치수를 직접 입력해 주세요.` }, { status: 200 });
  }

  // ② 결정론 검증 — 허용 파라미터만 · min/max 클램프 · 생략값은 기본값 표기
  const values: Record<string, number> = {};
  const clamped: string[] = [];
  for (const p of Array.isArray(raw.params) ? raw.params : []) {
    const spec = tpl.params.find((s) => s.name === p.name);
    if (!spec || !Number.isFinite(p.value)) continue;
    const v = Math.min(spec.max, Math.max(spec.min, p.value));
    if (v !== p.value) clamped.push(`${spec.labelKo}(${p.value}→${v})`);
    values[spec.name] = v;
  }
  const filled = tpl.params.filter((s) => !(s.name in values)).map((s) => s.labelKo);

  return NextResponse.json({
    ok: true,
    templateId: tpl.id,
    labelKo: tpl.labelKo,
    labelEn: tpl.labelEn,
    confidence,
    unit: raw.unit,
    values,       // 판독·클램프된 값(확인 카드 표시용)
    filled,       // 판독 못해 기본값을 쓸 파라미터(정직 표기)
    clamped,      // 범위 밖이라 클램프된 값(정직 표기)
    notes: raw.notes,
  });
}
