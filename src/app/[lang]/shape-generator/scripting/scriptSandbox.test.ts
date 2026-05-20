import { describe, it, expect, vi } from 'vitest';
import { runScript, lintScript } from './scriptSandbox';
import type { ScriptApiHost } from './scriptApi';

function emptyHost(): ScriptApiHost {
  return {
    listFeatures: () => [],
    dispatchAdd: () => 'f_0',
    dispatchExtrude: () => 'f_0',
    dispatchUpdateParam: vi.fn(),
    dispatchRemove: vi.fn(),
    dispatchReorder: vi.fn(),
    dispatchToggle: vi.fn(),
    dispatchClearAll: vi.fn(),
    getBbox: () => null,
    getMeshStats: () => null,
    exportStl: async () => 'blob:fake',
    logSink: vi.fn(),
  };
}

describe('lintScript', () => {
  it('rejects fetch calls', () => {
    expect(lintScript('fetch("https://evil.com")').length).toBeGreaterThan(0);
  });

  it('rejects eval', () => {
    expect(lintScript('eval("alert(1)")').length).toBeGreaterThan(0);
  });

  it('rejects document access', () => {
    expect(lintScript('document.body.innerHTML = ""').length).toBeGreaterThan(0);
  });

  it('accepts a normal script', () => {
    expect(lintScript('nf.addFeature("fillet", { radius: 3 })')).toEqual([]);
  });
});

describe('runScript', () => {
  it('executes a basic addFeature call', async () => {
    const host = emptyHost();
    const r = await runScript(`return nf.addFeature('fillet', { radius: 3 });`, host);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('f_0');
  });

  it('captures log entries', async () => {
    const host = emptyHost();
    const r = await runScript(`nf.log('hello'); return 1;`, host);
    expect(r.ok).toBe(true);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]!.level).toBe('info');
  });

  it('rejects forbidden patterns before execution', async () => {
    const r = await runScript(`fetch('/api/evil')`, emptyHost());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/forbidden/i);
  });

  it('catches runtime errors', async () => {
    const r = await runScript(`throw new Error('boom')`, emptyHost());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
  });

  it('times out async-yielding long scripts', async () => {
    // Pure sync infinite loops block the timer (would need a Worker
    // to abort). Sandbox's documented contract is yield-friendly
    // scripts — test an awaiting loop, which the timer can interrupt.
    const r = await runScript(
      `while (true) { await new Promise(r => setTimeout(r, 5)); }`,
      emptyHost(),
      { timeoutMs: 80 },
    );
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  }, 5000);

  it('supports await inside the script', async () => {
    const r = await runScript(`
      const url = await nf.exportStl();
      return url;
    `, emptyHost());
    expect(r.ok).toBe(true);
    expect(r.value).toBe('blob:fake');
  });

  it('records duration', async () => {
    const r = await runScript(`return 1;`, emptyHost());
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('script cannot access window or document', async () => {
    const r = await runScript(`return typeof window;`, emptyHost());
    // lintScript rejects 'window' reference outright.
    expect(r.ok).toBe(false);
  });

  it('Math is available', async () => {
    const r = await runScript(`return Math.PI;`, emptyHost());
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(Math.PI);
  });
});
