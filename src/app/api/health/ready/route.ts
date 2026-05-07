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
      uptime: process.uptime(),
      db: { backend: db.backend, status: 'ok', responseMs: dbMs },
    });
  } catch {
    return NextResponse.json(
      { status: 'error', timestamp: new Date().toISOString(), db: { status: 'error', error: 'Database unavailable' } },
      { status: 503 },
    );
  }
}
