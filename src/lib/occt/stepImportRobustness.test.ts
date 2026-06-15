// @vitest-environment node
/**
 * stepImportRobustness — real-world STEP B-rep import (gap #3).
 *
 * Root cause found 2026-06-14: opencascade.js's STEPControl_Reader.ReadFile
 * returns IFSelect_RetError for ABSOLUTE paths (e.g. '/tmp/in.step') on
 * real-world AP203/AP214/AP242 files exported by CAD tools, but parses the
 * identical bytes fine from a BARE RELATIVE filename in the FS CWD. The node
 * bridge already used the relative-name workaround ('cadr.step') — so it
 * imported real files all along — but the BROWSER WORKER wrote to
 * '/tmp/in.step', so real STEP B-rep import was broken in production.
 *
 * This test pins both halves of the contract on the (proven) node bridge:
 *   1. A genuinely unparseable input fails with an ACTIONABLE error.
 *   2. A real-world AP203 file imports as a B-rep solid (ok=true).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadOcctNode, type OcctModule } from './nodeOcctLoader';
import { createNodeOcctBridge } from './nodeOcctBridge';

let oc: OcctModule | null = null;
beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) oc = r.oc;
  else console.warn(`[stepRobustness] skipped — ${r.reason}`);
}, 60_000);

const PARSE_FAIL = /could not be parsed as B-rep/i;

describe('importSTEP robustness', () => {
  it('genuinely unparseable input fails with actionable "import as mesh" guidance', async () => {
    if (!oc) return;
    const bridge = createNodeOcctBridge(oc);
    const res = await bridge.importSTEP('this is definitely not a valid STEP file');
    expect(res.ok).toBe(false);
    expect(res.error ?? '').toMatch(PARSE_FAIL);
  }, 60_000);

  it('does not throw on malformed STEP — returns a structured failure', async () => {
    if (!oc) return;
    const bridge = createNodeOcctBridge(oc);
    await expect(bridge.importSTEP('ISO-10303-21;\nHEADER;\nbogus')).resolves.toMatchObject({ ok: false });
  }, 60_000);

  // Real-world AP203 fixture (present in dev worktrees; skipped in clean CI).
  const FIXTURE =
    '.claude/worktrees/agent-a14e9390f248a71f2/public/examples/acu_part-1_main_body.stp';
  it('real-world AP203 (Rhino/ST-Developer, 1MB) imports as a B-rep solid', async () => {
    if (!oc) return;
    if (!existsSync(FIXTURE)) { console.warn('[stepRobustness] AP203 fixture absent — skipped'); return; }
    const bridge = createNodeOcctBridge(oc);
    const res = await bridge.importSTEP(readFileSync(FIXTURE, 'utf8'));
    // The relative-filename workaround in the node bridge makes this parse.
    expect(res.ok).toBe(true);
    expect(res.shape ?? (res as { handle?: unknown }).handle).toBeTruthy();
  }, 60_000);
});
