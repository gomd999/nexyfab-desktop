import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { type Seg, segmentsToDxf, segmentsToSvg } from '@/lib/papercraft/netDxf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`sheetmetal-flat:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as {
    width?: number; length?: number; thickness?: number; bendRadius?: number; kFactor?: number; flanges?: Flange[];
  };
  const W = Math.min(Math.max(10, num(b.width, 100)), 2000);
  const L = Math.min(Math.max(10, num(b.length, 60)), 2000);
  const T = Math.min(Math.max(0.3, num(b.thickness, 2)), 20);
  const R = Math.min(Math.max(0.1, num(b.bendRadius, T)), 50);          // inside bend radius (≈ T)
  const K = Math.min(Math.max(0.1, num(b.kFactor, 0.4)), 0.5);          // neutral-axis factor
  const flanges = (Array.isArray(b.flanges) ? b.flanges : [{ edge: 'back' as const, height: 30 }])
    .filter(f => ['front', 'back', 'left', 'right'].includes(f.edge));

  const rad = (deg: number) => (deg * Math.PI) / 180;
  const bend = (angle: number) => {
    const ba = rad(angle) * (R + K * T);
    const ossb = (R + T) * Math.tan(rad(angle) / 2);
    return { ba, ossb, bd: 2 * ossb - ba };
  };

  const segs: Seg[] = [];
  // Base panel rectangle [0,0]-[W,L]; flanged edges become BEND lines, others CUT.
  const onEdge = (e: Flange['edge']) => flanges.find(f => f.edge === e);
  segs.push({ a: [0, 0], b: [W, 0], layer: onEdge('front') ? 'BEND' : 'CUT' });
  segs.push({ a: [0, L], b: [W, L], layer: onEdge('back') ? 'BEND' : 'CUT' });
  segs.push({ a: [0, 0], b: [0, L], layer: onEdge('left') ? 'BEND' : 'CUT' });
  segs.push({ a: [W, 0], b: [W, L], layer: onEdge('right') ? 'BEND' : 'CUT' });

  const report: Record<string, unknown>[] = [];
  for (const f of flanges) {
    const angle = Math.min(Math.max(1, num(f.angle, 90)), 179);
    const H = Math.min(Math.max(2, num(f.height, 30)), 1000);
    const { ba, ossb, bd } = bend(angle);
    const flat = Math.max(0.5, H - ossb);   // straight (flat) part of the flange beyond the bend
    const dev = ba + flat;                  // developed strip beyond the bend line
    // unfold the flange outward from its base edge as a CUT rectangle + a 2nd
    // BEND line at the far tangent of the bend zone.
    if (f.edge === 'back') {
      segs.push({ a: [0, L + ba], b: [W, L + ba], layer: 'BEND' });               // far bend tangent
      segs.push({ a: [0, L], b: [0, L + dev], layer: 'CUT' });
      segs.push({ a: [W, L], b: [W, L + dev], layer: 'CUT' });
      segs.push({ a: [0, L + dev], b: [W, L + dev], layer: 'CUT' });
    } else if (f.edge === 'front') {
      segs.push({ a: [0, -ba], b: [W, -ba], layer: 'BEND' });
      segs.push({ a: [0, 0], b: [0, -dev], layer: 'CUT' });
      segs.push({ a: [W, 0], b: [W, -dev], layer: 'CUT' });
      segs.push({ a: [0, -dev], b: [W, -dev], layer: 'CUT' });
    } else if (f.edge === 'right') {
      segs.push({ a: [W + ba, 0], b: [W + ba, L], layer: 'BEND' });
      segs.push({ a: [W, 0], b: [W + dev, 0], layer: 'CUT' });
      segs.push({ a: [W, L], b: [W + dev, L], layer: 'CUT' });
      segs.push({ a: [W + dev, 0], b: [W + dev, L], layer: 'CUT' });
    } else { // left
      segs.push({ a: [-ba, 0], b: [-ba, L], layer: 'BEND' });
      segs.push({ a: [0, 0], b: [-dev, 0], layer: 'CUT' });
      segs.push({ a: [0, L], b: [-dev, L], layer: 'CUT' });
      segs.push({ a: [-dev, 0], b: [-dev, L], layer: 'CUT' });
    }
    report.push({ edge: f.edge, angle, height: H, bendAllowance: +ba.toFixed(2), bendDeduction: +bd.toFixed(2), flangeFlat: +flat.toFixed(2) });
  }

  // overall developed blank bounding size
  let minX = 0, maxX = W, minY = 0, maxY = L;
  for (const s of segs) for (const p of [s.a, s.b]) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const dxf = segmentsToDxf(segs);
  const svg = segmentsToSvg(segs);
  return NextResponse.json({
    ok: true,
    base: { W, L, thickness: T, bendRadius: R, kFactor: K },
    blank: { width: +(maxX - minX).toFixed(2), length: +(maxY - minY).toFixed(2) },
    bends: report,
    bytes: Buffer.byteLength(dxf, 'utf8'),
    svg,
    dxf,
  });
}
