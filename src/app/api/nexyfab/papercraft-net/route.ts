import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { buildingNetSegments, gableHouseNetSegments, roomNetSegments, segmentsToDxf, segmentsToSvg } from '@/lib/papercraft/netDxf';
import { chatCompletion } from '@/lib/ai';
import { visionCompletion } from '@/lib/ai/vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Parametric building → papercraft flat-pattern, as ONE laser-ready DXF with
 * CUT / FOLD / TAB on separate named layers. Accepts explicit dimensions, or a
 * natural-language description ("a 2-storey shop 30 wide 20 deep 25 tall") that
 * an LLM turns into dimensions first. The weeks-not-months path for the paper/
 * laser kit market (buildings, rooms, boxes).
 */
const clamp = (v: unknown, d: number) => {
  const n = typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Math.min(Math.max(10, isFinite(n) ? n : d), 1000);
};

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`papercraft-net:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as { width?: number; depth?: number; height?: number; tab?: number; prompt?: string; roof?: string; gableHeight?: number; type?: string; image?: string; thickness?: number };
  let { width, depth, height } = b;
  let roof = b.roof === 'gable' ? 'gable' : b.roof === 'flat' ? 'flat' : '';
  let type = b.type === 'room' ? 'room' : b.type === 'building' ? 'building' : '';

  const SPEC_SCHEMA = 'STRICT JSON ONLY: {"width":N,"depth":N,"height":N,"roof":"flat"|"gable","type":"building"|"room"}. type="room" for an interior space (open-top), else "building". roof="gable" for a house/pitched roof, "flat" for a box/shop/tower (ignored for rooms). All dimensions in MILLIMETRES for a tabletop diorama (pick pleasing 40–120mm sizes). Default: 60×40×30, building, flat.';

  // Vision: a photo of a building/room → papercraft spec (the "upload a photo,
  // get a paper kit" path). Takes priority over text when both are present.
  let usedImage = false;
  const imageB64 = typeof b.image === 'string' && b.image.length > 0
    ? b.image.replace(/^data:image\/\w+;base64,/, '')
    : null;
  if (imageB64 && (width == null || depth == null || height == null)) {
    try {
      const bytes = Uint8Array.from(Buffer.from(imageB64, 'base64'));
      const v = await visionCompletion({
        prompt: `Look at this photo of a building or interior space and estimate a papercraft spec for a tabletop paper/cardboard diorama model. Reply ${SPEC_SCHEMA}\n${b.prompt ? 'User note: ' + b.prompt : ''}`,
        images: [{ bytes }],
        maxTokens: 120,
        timeoutMs: 25_000,
      });
      const m = v.text.match(/\{[\s\S]*?\}/);
      const j = (m ? JSON.parse(m[0]) : {}) as { width?: number; depth?: number; height?: number; roof?: string; type?: string };
      width = width ?? j.width; depth = depth ?? j.depth; height = height ?? j.height;
      if (!roof && (j.roof === 'gable' || j.roof === 'flat')) roof = j.roof;
      if (!type && (j.type === 'room' || j.type === 'building')) type = j.type;
      usedImage = true;
    } catch { /* fall back to text / defaults below */ }
  }

  // AI: extract dimensions from a free-text building description.
  let usedPrompt = false;
  if (b.prompt && (width == null || depth == null || height == null)) {
    try {
      const r = await chatCompletion({
        messages: [
          { role: 'system', content: 'Extract a papercraft spec in MILLIMETRES from the description. Reply STRICT JSON ONLY: {"width":N,"depth":N,"height":N,"roof":"flat"|"gable","type":"building"|"room"}. type="room" for an interior space (open-top), else "building". roof="gable" for a house/pitched roof, "flat" for a box/shop/tower (ignored for rooms). storeys → height ≈ storeys×30mm. Default: 60×40×30, building, flat.' },
          { role: 'user', content: b.prompt },
        ],
        maxTokens: 100,
        temperature: 0,
        timeoutMs: 20_000,
      });
      const m = r.text.match(/\{[\s\S]*?\}/);
      const j = (m ? JSON.parse(m[0]) : {}) as { width?: number; depth?: number; height?: number; roof?: string; type?: string };
      width = width ?? j.width; depth = depth ?? j.depth; height = height ?? j.height;
      if (!roof && (j.roof === 'gable' || j.roof === 'flat')) roof = j.roof;
      if (!type && (j.type === 'room' || j.type === 'building')) type = j.type;
      usedPrompt = true;
    } catch { /* fall back to defaults below */ }
  }

  const W = clamp(width, 60), D = clamp(depth, 40), H = clamp(height, 30);
  // Material thickness (e.g. foam board / 우드락). Grows the glue tab so a
  // thicker board still has a bonding flap; >1.5mm can't really be folded, so
  // the response flags it and the UI suggests the layered/cut approach.
  const thickness = typeof b.thickness === 'number' && b.thickness > 0 ? Math.min(b.thickness, 30) : 0;
  const tab = Math.min(Math.max(2, (typeof b.tab === 'number' ? b.tab : 6) + thickness * 0.5), 30);
  const gableH = Math.min(Math.max(2, typeof b.gableHeight === 'number' ? b.gableHeight : Math.round(D * 0.4)), 500);
  const segs = type === 'room'
    ? roomNetSegments(W, D, H, tab)
    : roof === 'gable'
      ? gableHouseNetSegments(W, D, H, gableH, tab)
      : buildingNetSegments(W, D, H, tab);
  const counts = { CUT: 0, FOLD: 0, TAB: 0 } as Record<string, number>;
  for (const s of segs) counts[s.layer]++;
  const dxf = segmentsToDxf(segs);
  const svg = segmentsToSvg(segs);
  return NextResponse.json({
    ok: true,
    dims: { W, D, H, tab, type: type || 'building', roof: type === 'room' ? 'open' : (roof || 'flat'), ...(roof === 'gable' && type !== 'room' ? { gableHeight: gableH } : {}) },
    fromPrompt: usedPrompt,
    fromImage: usedImage,
    thickness: thickness || undefined,
    thick: thickness > 1.5,
    layers: counts,            // { CUT, FOLD, TAB } line counts
    steps: assemblySteps(type === 'room' ? 'room' : (roof === 'gable' ? 'gable' : 'building')),
    bytes: Buffer.byteLength(dxf, 'utf8'),
    svg,
    dxf,
  });
}

/**
 * Deterministic step-by-step assembly guide for the generated paper kit. The
 * nets are templated (building / gable house / open room), so the fold/glue
 * sequence is predictable — no LLM needed, instant and reliable.
 */
function assemblySteps(kind: 'building' | 'gable' | 'room'): string[] {
  const common = [
    '빨강 칼선(Cut)을 모두 따라 오려냅니다.',
    '파랑 접는선(Fold)을 칼등이나 다 쓴 볼펜으로 눌러 자국을 냅니다(스코어링) — 깔끔하게 접힙니다.',
  ];
  if (kind === 'room') {
    return [
      ...common,
      '바닥을 기준으로 벽 4개를 위로 직각이 되게 접어 세웁니다.',
      '모서리의 초록 조립 탭(Tab)에 풀을 발라 옆 벽 안쪽에 붙여 고정합니다.',
      '천장이 없는 개방형 실내 공간이 완성됩니다 — 디오라마 배경으로 사용하세요.',
    ];
  }
  if (kind === 'gable') {
    return [
      ...common,
      '바닥 기준으로 벽 4개를 세우고, 초록 탭에 풀칠해 인접 벽에 붙입니다.',
      '박공(삼각) 지붕면을 접어 용마루에서 맞물리게 한 뒤 탭으로 붙여 지붕을 만듭니다.',
      '완성된 지붕을 벽 위에 얹고 탭으로 고정하면 집이 완성됩니다.',
    ];
  }
  return [
    ...common,
    '바닥 기준으로 벽 4개를 위로 접어 세웁니다.',
    '초록 조립 탭(Tab)에 풀을 발라 인접한 벽에 붙여 상자 형태를 고정합니다.',
    '윗면(뚜껑)을 접어 덮고 남은 탭으로 마무리하면 완성됩니다.',
  ];
}
