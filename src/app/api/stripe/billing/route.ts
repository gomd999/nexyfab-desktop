// Deprecated: Use /api/billing/portal instead
import { NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({ error: 'This endpoint has been deprecated. Use /api/billing/portal.' }, { status: 410 });
}
