/**
 * POST /api/nexyfab/drawing/dfm — { intent, process?, thicknessMm? } → 판금·절삭 제조성(DFM) 검사.
 *
 * 완벽화 Pillar ②: 형상 intent에서 홀·두께·벽을 결정론적으로 읽어 제조 규칙(최소 홀·홀-엣지·
 * 간격·최소 두께·얇은 벽)을 검사. 메시 휴리스틱이 아니라 파라미터 직독이라 정확. dfm.mjs를
 * webpackIgnore 런타임 import(다른 drawing 라우트와 동일).
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 16 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DfmModule = {
  analyzeDfm: (intent: unknown, opts?: { process?: string; thicknessMm?: number }) => unknown;
};

let _mod: DfmModule | null = null;
async function loadDfm(): Promise<DfmModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'dfm.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as DfmModule;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-dfm:${ip}`, 40, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { intent?: unknown; process?: string; thicknessMm?: number };
  try {
    body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'intent가 너무 큽니다.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.intent || typeof body.intent !== 'object') {
    return NextResponse.json({ ok: false, error: 'intent가 필요합니다.' }, { status: 400 });
  }

  try {
    const mod = await loadDfm();
    const result = mod.analyzeDfm(body.intent, { process: body.process, thicknessMm: body.thicknessMm });
    return NextResponse.json({ ok: true, ...(result as object) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'dfm failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
