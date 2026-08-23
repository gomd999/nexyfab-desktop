/**
 * /api/nexyfab/drawing/face-map — 면→파라미터 역매핑 (P2: 사람이 면을 잡으면
 * 파라미터가 잡힌다). POST { type, face } 또는 { type, normal:[x,y,z], rz? }
 * → { ok, param, dragSign } | { ok:false, reason, sectionParams? }.
 * 매핑은 어휘 정의에서 결정론 파생(face-param-map.mjs) — 추측 없음.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mod = {
  mapFace: (type: string, face: string) => Record<string, unknown>;
  worldNormalToFace: (normal: number[], rz?: number) => string;
  coverage: () => unknown[];
};

let _mod: Mod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'face-param-map.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as Mod;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-facemap:${ip}`, 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { type?: string; face?: string; normal?: number[]; rz?: number };
  try {
    body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'face-map 입력이 너무 큽니다.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.type) return NextResponse.json({ ok: false, error: 'type 필요' }, { status: 400 });

  try {
    const mod = await load();
    const face = body.face ?? (Array.isArray(body.normal) && body.normal.length === 3
      ? mod.worldNormalToFace(body.normal, body.rz ?? 0)
      : null);
    if (!face) return NextResponse.json({ ok: false, error: 'face 또는 normal[3] 필요' }, { status: 400 });
    return NextResponse.json({ face, ...mod.mapFace(body.type, face) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'face-map failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
