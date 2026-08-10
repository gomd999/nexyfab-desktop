import type { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';

/** Authenticated ownership is authoritative. Guest sessions remain isolated
 * by their trusted network identity plus an unguessable run id. */
export async function generationRequestOwner(req: NextRequest, trustedIp: string): Promise<string> {
  const user = await getAuthUser(req);
  return user ? `user:${user.userId}` : `guest:${trustedIp}`;
}
