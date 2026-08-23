import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { type Seg, segmentsToDxf, segmentsToSvg } from '@/lib/papercraft/netDxf';
import { chatCompletion } from '@/lib/ai';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_JSON_BODY_BYTES = 1024 * 1024;

/**
 * PoC — sheet-metal FLAT PATTERN (전개도) with bend-allowance compensation.
 * A base panel with 90°(or arbitrary) edge flanges unfolds to a flat blank; the
 * developed length is NOT base+flange — it is corrected by the bend allowance so
 * the laser/punch blank, once bent, lands on the right outside dimensions.
 *   BA (bend allowance) = (θ·π/180)·(R + K·T)        ← neutral-axis arc
 *   OSSB (outside setback) = (R + T)·tan(θ/2)
 *   BD (bend deduction) = 2·OSSB − BA                 ← blank = ΣOuter − ΣBD
 * Emits one DXF with CUT (outline) + BEND (fold lines) on separate layers.
 */
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

interface Flange { edge: 'front' | 'back' | 'left' | 'right'; height: number; angle?: number }

export async function POST(req: NextRequest) {
  const b = (await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => ({}))) as {
    width?: number; length?: number; thickness?: number; bendRadius?: number; kFactor?: number; flanges?: Flange[]; prompt?: string; lang?: string;
  };
  const locale = resolveServerLocale(req, b.lang ?? req.nextUrl.searchParams.get('lang'));
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`sheetmetal-flat:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: localizedApiMessage(locale, 'rateLimited'), code: 'RATE_LIMIT', outputLanguage: locale.route }, { status: 429 });
  }

  // AI: extract a sheet-metal spec from a free-text part description.
  let aiFlanges: Flange[] | undefined;
  let usedPrompt = false;
  if (b.prompt && b.width == null) {
    const planGuard = await guardStudioAi(req);
    if (planGuard) return planGuard;
    try {
      const r = await chatCompletion({
        messages: [
          { role: 'system', content: 'Extract a sheet-metal part spec in MILLIMETRES from the description. Reply STRICT JSON ONLY: {"width":N,"length":N,"thickness":N,"bendRadius":N,"flanges":[{"edge":"front"|"back"|"left"|"right","height":N,"angle":N}]}. width=X span, length=Y span, thickness=sheet gauge (default 2). bendRadius defaults to thickness. Each flange folds up from a base edge (angle 90 default). A simple bracket = one flange. A U/channel = two opposite flanges. A tray/box = all four. Default 100×60×2, one back flange 30mm.' },
          { role: 'user', content: b.prompt },
        ],
        maxTokens: 220,
        temperature: 0,
        timeoutMs: 20_000,
      });
      const m = r.text.match(/\{[\s\S]*\}/);
      const j = (m ? JSON.parse(m[0]) : {}) as typeof b;
      if (j.width != null) b.width = j.width;
      if (j.length != null) b.length = j.length;
      if (j.thickness != null) b.thickness = j.thickness;
      if (j.bendRadius != null) b.bendRadius = j.bendRadius;
      if (Array.isArray(j.flanges)) aiFlanges = j.flanges;
      usedPrompt = true;
    } catch { /* fall back to defaults below */ }
  }

  const W = Math.min(Math.max(10, num(b.width, 100)), 2000);
  const L = Math.min(Math.max(10, num(b.length, 60)), 2000);
  const T = Math.min(Math.max(0.3, num(b.thickness, 2)), 20);
  const R = Math.min(Math.max(0.1, num(b.bendRadius, T)), 50);          // inside bend radius (≈ T)
  const K = Math.min(Math.max(0.1, num(b.kFactor, 0.4)), 0.5);          // neutral-axis factor
  const flanges = (aiFlanges ?? (Array.isArray(b.flanges) ? b.flanges : [{ edge: 'back' as const, height: 30 }]))
    .filter(f => ['front', 'back', 'left', 'right'].includes(f.edge))
    .slice(0, 4);

  const rad = (deg: number) => (deg * Math.PI) / 180;
  const bend = (angle: number) => {
    const ba = rad(angle) * (R + K * T);
    const ossb = (R + T) * Math.tan(rad(angle) / 2);
    return { ba, ossb, bd: 2 * ossb - ba };
  };

  // Per-edge bend geometry. The base panel is SHORTENED by OSSB on each flanged
  // edge (the bend region replaces material up to the bend tangent), so the
  // developed length = (L − ΣOSSB) + Σ(BA + flange_flat) = (L+H) − ΣBD. Without
  // this setback the blank comes out too long by OSSB per bend.
  const onEdge = (e: Flange['edge']) => flanges.find(f => f.edge === e);
  const edgeBend = (e: Flange['edge']) => {
    const f = onEdge(e); if (!f) return null;
    const angle = Math.min(Math.max(1, num(f.angle, 90)), 179);
    const H = Math.min(Math.max(2, num(f.height, 30)), 1000);
    const { ba, ossb, bd } = bend(angle);
    const flat = Math.max(0.5, H - ossb);
    return { angle, H, ba, ossb, bd, flat, dev: ba + flat };
  };
  const bF = edgeBend('front'), bB = edgeBend('back'), bL = edgeBend('left'), bR = edgeBend('right');
  // Developed base panel (setback applied) — base origin at (x0, y0).
  const x0 = 0, y0 = 0;
  const baseW = W - (bL?.ossb ?? 0) - (bR?.ossb ?? 0);
  const baseL = L - (bF?.ossb ?? 0) - (bB?.ossb ?? 0);
  const x1 = x0 + baseW, y1 = y0 + baseL;

  const segs: Seg[] = [];
  // base edges: flanged → BEND (the bend line), else CUT
  segs.push({ a: [x0, y0], b: [x1, y0], layer: bF ? 'BEND' : 'CUT' });
  segs.push({ a: [x0, y1], b: [x1, y1], layer: bB ? 'BEND' : 'CUT' });
  segs.push({ a: [x0, y0], b: [x0, y1], layer: bL ? 'BEND' : 'CUT' });
  segs.push({ a: [x1, y0], b: [x1, y1], layer: bR ? 'BEND' : 'CUT' });

  // unfold each flange outward: far bend tangent (BEND) + flange flat outline (CUT)
  if (bB) { const e = y1 + bB.dev; segs.push({ a: [x0, y1 + bB.ba], b: [x1, y1 + bB.ba], layer: 'BEND' }, { a: [x0, y1], b: [x0, e], layer: 'CUT' }, { a: [x1, y1], b: [x1, e], layer: 'CUT' }, { a: [x0, e], b: [x1, e], layer: 'CUT' }); }
  if (bF) { const e = y0 - bF.dev; segs.push({ a: [x0, y0 - bF.ba], b: [x1, y0 - bF.ba], layer: 'BEND' }, { a: [x0, y0], b: [x0, e], layer: 'CUT' }, { a: [x1, y0], b: [x1, e], layer: 'CUT' }, { a: [x0, e], b: [x1, e], layer: 'CUT' }); }
  if (bR) { const e = x1 + bR.dev; segs.push({ a: [x1 + bR.ba, y0], b: [x1 + bR.ba, y1], layer: 'BEND' }, { a: [x1, y0], b: [e, y0], layer: 'CUT' }, { a: [x1, y1], b: [e, y1], layer: 'CUT' }, { a: [e, y0], b: [e, y1], layer: 'CUT' }); }
  if (bL) { const e = x0 - bL.dev; segs.push({ a: [x0 - bL.ba, y0], b: [x0 - bL.ba, y1], layer: 'BEND' }, { a: [x0, y0], b: [e, y0], layer: 'CUT' }, { a: [x0, y1], b: [e, y1], layer: 'CUT' }, { a: [e, y0], b: [e, y1], layer: 'CUT' }); }

  const report: Record<string, unknown>[] = [];
  for (const [edge, bnd] of [['front', bF], ['back', bB], ['left', bL], ['right', bR]] as const) {
    if (bnd) report.push({ edge, angle: bnd.angle, height: bnd.H, bendAllowance: +bnd.ba.toFixed(2), bendDeduction: +bnd.bd.toFixed(2), flangeFlat: +bnd.flat.toFixed(2) });
  }

  // overall developed blank bounding size
  let minX = x0, maxX = x1, minY = y0, maxY = y1;
  for (const s of segs) for (const p of [s.a, s.b]) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const dxf = segmentsToDxf(segs);
  const svg = segmentsToSvg(segs);
  return NextResponse.json({
    ok: true,
    fromPrompt: usedPrompt,
    base: { W, L, thickness: T, bendRadius: R, kFactor: K },
    blank: { width: +(maxX - minX).toFixed(2), length: +(maxY - minY).toFixed(2) },
    bends: report,
    bytes: Buffer.byteLength(dxf, 'utf8'),
    svg,
    dxf,
    outputLanguage: locale.route,
  });
}
