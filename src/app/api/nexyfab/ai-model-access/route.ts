import { NextResponse } from 'next/server';
import { aiModelBetaAccessEnabled } from '@/lib/ai/aiModelBetaAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const enabled = aiModelBetaAccessEnabled();
  return NextResponse.json({
    schema: 'nexyfab.ai-model-access.v1',
    enabled,
    mode: enabled ? 'no_payment_beta_all_models' : 'plan_entitlement',
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
