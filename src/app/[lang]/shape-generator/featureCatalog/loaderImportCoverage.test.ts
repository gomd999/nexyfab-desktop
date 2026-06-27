/**
 * Loader import coverage — the next level beyond _coverageAudit (which only
 * checks the module FILE exists). Here we actually invoke every auto-wired
 * catalog loader and confirm the module IMPORTS and exposes exports. Catches
 * "registered but broken" features — a module that exists but fails to import
 * (bad dependency, runtime-only import) or exports nothing — across all ~308
 * catalog entries (CAM, drawing, assembly, inspection, …), grouped by domain.
 */
import { describe, it, expect } from 'vitest';
import { AUTO_WIRED_LOADERS } from './featureLoaders.auto';

describe('catalog loader import coverage', () => {
  it('every auto-wired loader imports and exposes exports', async () => {
    const ok: string[] = [];
    const fails: { id: string; reason: string }[] = [];
    for (const [id, loader] of Object.entries(AUTO_WIRED_LOADERS)) {
      try {
        const mod = await loader();
        const n = mod && typeof mod === 'object' ? Object.keys(mod).length : 0;
        if (n === 0) fails.push({ id, reason: 'no exports' });
        else ok.push(id);
      } catch (e) {
        fails.push({ id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 80) });
      }
    }
    const domain = (id: string) => id.split('.')[0];
    const byDomain: Record<string, { ok: number; fail: number }> = {};
    for (const id of ok) { const d = domain(id); (byDomain[d] ??= { ok: 0, fail: 0 }).ok++; }
    for (const f of fails) { const d = domain(f.id); (byDomain[d] ??= { ok: 0, fail: 0 }).fail++; }

    console.log(`\n===== LOADER IMPORT COVERAGE: ${ok.length} OK / ${fails.length} FAIL of ${ok.length + fails.length} =====`);
    console.log('by domain: ' + Object.entries(byDomain).sort().map(([d, c]) => `${d}=${c.ok}${c.fail ? '/' + c.fail + 'fail' : ''}`).join('  '));
    if (fails.length) console.log('\nFAILS:\n' + fails.map(f => `  ${f.id} — ${f.reason}`).join('\n'));

    expect(fails.map(f => `${f.id}: ${f.reason}`), 'catalog loaders that fail to import').toEqual([]);
  }, 120_000);
});
