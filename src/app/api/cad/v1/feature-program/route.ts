import type { NextRequest } from 'next/server';
import { POST as legacyPost } from '@/app/api/nexyfab/cad-feature-program/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stable alias; the legacy URL remains supported for existing web clients. */
export async function POST(req: NextRequest) {
  return legacyPost(req);
}
