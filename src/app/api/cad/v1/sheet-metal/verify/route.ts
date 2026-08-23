import { NextRequest, NextResponse } from 'next/server';
import { buildFlatPatternArtifact, flatPatternGate } from '@/lib/ai/design-driver/flatPatternGate';
import type { PlanPart, SheetMetalSpec } from '@/lib/ai/design-driver/types';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-sheet-metal-verify:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: { partId?: string; spec?: SheetMetalSpec } | null;
  try { body = await readBoundedJson(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    body = null;
  }
  if (!body?.spec) return NextResponse.json({ ok: false, code: 'INVALID_SHEET_METAL', message: 'spec is required' }, { status: 400 });
  try {
    const part = sheetPart(body.partId ?? 'sheet-metal-part', body.spec);
    const artifact = buildFlatPatternArtifact(part);
    const gate = flatPatternGate(part, artifact);
    return NextResponse.json({ ok: true, designOk: gate.pass, artifact, gate, sideEffects: { quoteCreated: false, rfqCreated: false } });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'SHEET_METAL_FAILED', message: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

function sheetPart(partId: string, sheetMetal: SheetMetalSpec): PlanPart {
  return {
    partId, name: partId, process: 'sheetMetal', sheetMetal,
    bodies: [{ bodyId: 'flat-blank', feature: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: sheetMetal.baseWidthMm, y: 0 }, { x: sheetMetal.baseWidthMm, y: sheetMetal.baseLengthMm }, { x: 0, y: sheetMetal.baseLengthMm }], depth: sheetMetal.thicknessMm, direction: 'one_sided', mode: 'add' } }],
  };
}
