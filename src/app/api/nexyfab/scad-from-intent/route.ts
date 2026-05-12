/**
 * POST /api/nexyfab/scad-from-intent
 *
 * Takes a shape-chat-style JSON intent ({ shapeId, params, features })
 * and returns deterministic OpenSCAD source. Caller then POSTs the source
 * to /api/nexyfab/openscad-render to get an STL.
 *
 * No AI involved — same input always yields the same SCAD output.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { intentToScad, type IntentInput } from '@/lib/openscad-render/intentToScad';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const body = await req.json().catch(() => ({}));
  const intent = body as Partial<IntentInput>;

  if (!intent.shapeId || typeof intent.shapeId !== 'string') {
    return NextResponse.json({ error: 'shapeId is required' }, { status: 400 });
  }
  if (!intent.params || typeof intent.params !== 'object') {
    return NextResponse.json({ error: 'params object is required' }, { status: 400 });
  }

  const result = intentToScad(intent as IntentInput);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, code: 'UNSUPPORTED' }, { status: 422 });
  }

  return NextResponse.json({
    scad: result.scad,
    warnings: result.warnings,
    bytes: Buffer.byteLength(result.scad, 'utf8'),
  });
}
