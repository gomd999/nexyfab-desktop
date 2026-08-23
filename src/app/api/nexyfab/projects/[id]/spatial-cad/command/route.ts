import { NextRequest } from 'next/server';
import { POST as postSpatialCad } from '../route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Revision-bound reviewed command endpoint. The parent route performs the
 * existing origin, auth, project-access and server CAS checks. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return postSpatialCad(req, context);
}
