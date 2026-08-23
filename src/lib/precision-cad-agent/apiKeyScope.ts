import type { AuthUser } from '@/lib/auth-middleware';

export type PrecisionCadProjectScope = 'read:projects' | 'write:projects';

/**
 * Cookie/JWT sessions are already authorized by the project ACL. API keys
 * need an explicit project scope as well; accepting a bearer key without this
 * check would make the route matrix's auth claim materially misleading.
 */
export function hasPrecisionCadProjectScope(auth: Pick<AuthUser, 'apiKey'>, required: PrecisionCadProjectScope): boolean {
  return !auth.apiKey || auth.apiKey.scopes.includes(required);
}
