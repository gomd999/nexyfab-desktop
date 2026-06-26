import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { buildingNetDxf, gableHouseNetDxf } from '@/lib/papercraft/netDxf';
import { chatCompletion } from '@/lib/ai';

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
  const b = (await req.json().catch(() => ({}))) as { width?: number; depth?: number; height?: number; tab?: number; prompt?: string; roof?: string; gableHeight?: number };
  let { width, depth, height } = b;
  let roof = b.roof === 'gable' ? 'gable' : b.roof === 'flat' ? 'flat' : '';

  // AI: extract dimensions from a free-text building description.
  let usedPrompt = false;
  if (b.prompt && (width == null || depth == null || height == null)) {
    try {
      const r = await chatCompletion({
        messages: [
          { role: 'system', content: 'Extract a papercraft building spec in MILLIMETRES from the description. Reply STRICT JSON ONLY: {"width":N,"depth":N,"height":N,"roof":"flat"|"gable"}. roof="gable" for a house/pitched/triangular roof, "flat" for a box/shop/tower. If a storey count is given, height ≈ storeys×30mm. Default small building: 60×40×30, flat.' },
          { role: 'user', content: b.prompt },
        ],
        maxTokens: 90,
        temperature: 0,
        timeoutMs: 20_000,
      });
      const m = r.text.match(/\{[\s\S]*?\}/);
      const j = (m ? JSON.parse(m[0]) : {}) as { width?: number; depth?: number; height?: number; roof?: string };
      width = width ?? j.width; depth = depth ?? j.depth; height = height ?? j.height;
      if (!roof && (j.roof === 'gable' || j.roof === 'flat')) roof = j.roof;
      usedPrompt = true;
    } catch { /* fall back to defaults below */ }
  }

  const W = clamp(width, 60), D = clamp(depth, 40), H = clamp(height, 30);
  const tab = Math.min(Math.max(2, typeof b.tab === 'number' ? b.tab : 6), 20);
  const gableH = Math.min(Math.max(2, typeof b.gableHeight === 'number' ? b.gableHeight : Math.round(D * 0.4)), 500);
  const { dxf, counts } = roof === 'gable'
    ? gableHouseNetDxf(W, D, H, gableH, tab)
    : buildingNetDxf(W, D, H, tab);
  return NextResponse.json({
    ok: true,
    dims: { W, D, H, tab, roof: roof || 'flat', ...(roof === 'gable' ? { gableHeight: gableH } : {}) },
    fromPrompt: usedPrompt,
    layers: counts,            // { CUT, FOLD, TAB } line counts
    bytes: Buffer.byteLength(dxf, 'utf8'),
    dxf,
  });
}
