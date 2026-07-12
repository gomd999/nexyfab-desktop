/**
 * POST /api/nexyfab/drawing/export-step
 *
 * 범용 조합 intent → 진짜 B-rep STEP(제조/CNC용). replicad/OCCT를 서버에서
 * 실행(webpackIgnore 런타임 import로 wasm 번들 회피). STEP 텍스트를 그대로 반환.
 *
 * caller: { intent } → { ok, step, entities, bytes }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type StepModule = { intentToStep: (intent: unknown) => Promise<{ step: string; entities: number }> };

let _mod: StepModule | null = null;
async function loadStep(): Promise<StepModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'to-step.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as StepModule;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-step:${ip}`, 8, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let intent: unknown;
  try {
    intent = ((await req.json()) as { intent?: unknown }).intent;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!intent || typeof intent !== 'object') {
    return NextResponse.json({ ok: false, error: 'intent가 필요합니다.' }, { status: 400 });
  }

  try {
    const step = await loadStep();
    const { step: stepText, entities } = await step.intentToStep(intent);
    return NextResponse.json({ ok: true, step: stepText, entities, bytes: stepText.length, format: 'STEP (B-rep, ISO-10303)' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /gate/.test(msg) ? 422 : 502;
    return NextResponse.json({ ok: false, error: 'STEP export failed: ' + msg.slice(0, 200) }, { status });
  }
}
