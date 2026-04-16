import { NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();

  try {
    const db = getDbAdapter();
    await db.queryOne('SELECT 1');
    const dbMs = Date.now() - start;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: {
        status: 'ok',
        responseMs: dbMs,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[health] DB check failed:', errMsg, err instanceof Error ? err.stack : '');
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        db: { status: 'error', error: errMsg },
      },
      { status: 503 },
    );
  }
}
