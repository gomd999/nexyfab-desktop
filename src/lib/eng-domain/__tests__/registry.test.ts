/**
 * registry.test.ts — 다분야 확장 #3 표면 노출 (dispatcher).
 *
 * The unified `runDomainDesign(domain, brief)` dispatches ANY non-mechanical
 * domain through the same `runDomainDriver` spine. This is the reusable core the
 * API / MCP surface calls — one entry point, four domains, identical refusal IR.
 */
import { describe, it, expect } from 'vitest';
import { DOMAIN_NAMES, isKnownDomain, runDomainDesign } from '../registry';

const FIXTURE_BY_DOMAIN: Record<string, string> = {
  civil: 'steel-beam',
  interior: 'office-floor',
  construction: 'rc-frame',
  landscape: 'park-plaza',
};

describe('eng-domain registry — unified domain dispatcher', () => {
  it('registers exactly the four non-mechanical domains', () => {
    expect(DOMAIN_NAMES.sort()).toEqual(['civil', 'construction', 'interior', 'landscape']);
    for (const d of DOMAIN_NAMES) expect(isKnownDomain(d)).toBe(true);
    expect(isKnownDomain('mechanical')).toBe(false);
  });

  it('dispatches every domain to a verified package via the shared spine', async () => {
    for (const domain of DOMAIN_NAMES) {
      const fixture = FIXTURE_BY_DOMAIN[domain]!;
      const res = await runDomainDesign(domain, { id: `${domain}-smoke`, params: { fixture } });
      expect(res.ok, `${domain}: ${res.ok ? '' : res.refusal.reason}`).toBe(true);
      if (!res.ok) continue;
      expect(res.domain).toBe(domain);
      expect(res.gates.length).toBeGreaterThan(0);
      expect(res.gates.every((g) => g.pass)).toBe(true);
    }
  });

  it('a refused brief comes back as { ok:false } (not a throw)', async () => {
    const res = await runDomainDesign('civil', { id: 'nope', params: { fixture: 'nonexistent' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
  });

  it('an unknown domain THROWS (caller maps to 404)', () => {
    expect(() => runDomainDesign('aerospace', { id: 'x' })).toThrow('unknown domain');
  });
});
