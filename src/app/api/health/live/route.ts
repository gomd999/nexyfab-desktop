import { NextResponse } from 'next/server';
import { buildLiveHealthPayload } from '../../../../../apps/core-api/src/health/live';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(buildLiveHealthPayload(process.env));
}
