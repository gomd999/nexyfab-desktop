/**
 * eng-domain/registry — the unified domain dispatcher (다분야 확장 #3 표면 노출).
 *
 * Maps a domain name to its `DomainModule` and runs it through the shared
 * `runDomainDriver` spine. One entry point (`runDomainDesign`) that the API / MCP
 * surface calls for ANY non-mechanical domain — civil / interior / construction /
 * landscape. Mechanical keeps its own specialized surface (design-brief).
 *
 * All four domain briefs are structurally identical ({ id, text?, params? }), so
 * they share the `DomainBrief` shape; the modules' specific Plan/Artifacts/Package
 * types are erased at the registry boundary (the runner only uses the module's
 * methods generically — no fabrication, just dispatch).
 */

import { runDomainDriver, type DomainDriverResult, type DomainModule } from '@/lib/domain-driver';
import { civilModule } from './civil/module';
import { interiorModule } from './interior/module';
import { constructionModule } from './construction/module';
import { landscapeModule } from './landscape/module';

export interface DomainBrief {
  id: string;
  text?: string;
  params?: Record<string, number | string>;
}

type AnyDomainModule = DomainModule<DomainBrief, unknown, unknown, unknown>;

/** The registered non-mechanical domains. */
export const DOMAIN_MODULES: Record<string, AnyDomainModule> = {
  civil: civilModule as unknown as AnyDomainModule,
  interior: interiorModule as unknown as AnyDomainModule,
  construction: constructionModule as unknown as AnyDomainModule,
  landscape: landscapeModule as unknown as AnyDomainModule,
};

export const DOMAIN_NAMES = Object.keys(DOMAIN_MODULES);

export function isKnownDomain(domain: string): boolean {
  return Object.prototype.hasOwnProperty.call(DOMAIN_MODULES, domain);
}

/**
 * Dispatch a brief to a domain's module and run the full driver. Throws on an
 * unknown domain (the caller maps that to a 404); a planner/gate refusal is a
 * normal `{ ok: false }` result (패키지 미산출), NOT a throw.
 */
export function runDomainDesign(
  domain: string,
  brief: DomainBrief,
): Promise<DomainDriverResult<unknown, unknown>> {
  const mod = DOMAIN_MODULES[domain];
  if (!mod) {
    throw new Error(`unknown domain '${domain}' (known: ${DOMAIN_NAMES.join(', ')})`);
  }
  return runDomainDriver(brief, mod);
}
