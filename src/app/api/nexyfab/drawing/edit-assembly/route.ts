/**
 * POST { assembly, instruction }
 * Repairs placement against the exact existing assembly rather than asking the
 * chat classifier to generate a replacement model.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-edit-assembly:${ip}`, 8, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;

  let body: { assembly?: { parts?: unknown[] }; instruction?: string };
  try {
    body = await readBoundedJson<typeof body>(req, 1_200_000);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ ok: false, error: '조립체 데이터가 너무 큽니다(최대 1.2MB).' }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }
  if (!body.assembly || !Array.isArray(body.assembly.parts) || body.assembly.parts.length < 2) {
    return NextResponse.json({ ok: false, error: '수정할 assembly.parts가 필요합니다.' }, { status: 400 });
  }
  if (body.assembly.parts.length > 600) {
    return NextResponse.json({ ok: false, error: '한 번에 수정할 수 있는 부품 수를 초과했습니다(최대 600개).' }, { status: 400 });
  }

  try {
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'edit-assembly.mjs')).href);
    const result = await mod.repairAssemblyWithAi(body.assembly, String(body.instruction ?? '간섭을 해결하도록 배치를 수정'));
    if (!result.ok) return NextResponse.json(result, { status: 422 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: `조립체 배치 수정에 실패했습니다: ${(error instanceof Error ? error.message : String(error)).slice(0, 180)}`,
    }, { status: 502 });
  }
}
