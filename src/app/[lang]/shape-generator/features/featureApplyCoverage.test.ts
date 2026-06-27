/**
 * Verification-at-scale harness (run-once, not a CI assertion). Applies every
 * registered feature's mesh `apply` to a base box with its DEFAULT params and
 * triages the outcome: OK / EMPTY / THREW. Surfaces which of the many features
 * actually produce geometry standalone vs need selection-context vs are broken —
 * the systematic version of "does it work" across the whole catalog.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FEATURE_MAP } from './index';

// Features that legitimately cannot apply standalone (need a prior feature, a
// selection, or the OCCT engine) — they report a clear error, by design.
const CONTEXT_GATED = new Set(['bendRelief', 'deleteFace', 'offsetFace']);

function boxNonIndexed(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(40, 20, 30).toNonIndexed();
}
function boxIndexed(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(40, 20, 30); // manifold, indexed
}
// Try indexed first (shell/variable* need manifold), then non-indexed.
function tryApply(d: { apply: (g: THREE.BufferGeometry, p: Record<string, number>, c: object) => THREE.BufferGeometry }, params: Record<string, number>): { cnt: number; err?: string } {
  let err: string | undefined;
  for (const make of [boxIndexed, boxNonIndexed]) {
    try {
      const out = d.apply(make(), params, {});
      const cnt = out?.attributes?.position?.count ?? 0;
      if (cnt > 0) return { cnt };
    } catch (e) { err = (e instanceof Error ? e.message : String(e)).slice(0, 70); }
  }
  return { cnt: 0, err };
}

describe('feature verification at scale', () => {
  it('applies every feature def with default params on a box', () => {
    const rows: { status: string; type: string; detail: string }[] = [];
    for (const [type, def] of Object.entries(FEATURE_MAP)) {
       
      const d = def as any;
      const params: Record<string, number> = {};
      (d.params ?? []).forEach((p: { key: string; default: number }) => { params[p.key] = p.default; });
      let status = '?', detail = '';
      if (typeof d.apply !== 'function') { status = 'NO-APPLY'; }
      else {
        const { cnt, err } = tryApply(d, params);
        if (cnt > 0) { status = 'OK'; detail = cnt + ' verts'; }
        else if (err) { status = 'NEEDS-CTX'; detail = err; }
        else { status = 'EMPTY'; }
      }
      rows.push({ status, type, detail });
    }
    const by = (s: string) => rows.filter(r => r.status === s);
    const fmt = (r: { status: string; type: string; detail: string }) => `  ${r.type.padEnd(20)} ${r.detail}`;
    const out = [
      `\n===== FEATURE VERIFICATION (${rows.length} features) =====`,
      `OK: ${by('OK').length} | NEEDS-CTX: ${by('NEEDS-CTX').length} | EMPTY: ${by('EMPTY').length} | NO-APPLY: ${by('NO-APPLY').length}`,
      `\n--- OK (${by('OK').length}) — produces geometry standalone ---`, ...by('OK').map(fmt),
      `\n--- NEEDS-CTX (${by('NEEDS-CTX').length}) — needs selection / prior feature / OCCT (not a bug) ---`, ...by('NEEDS-CTX').map(r => `  ${r.type.padEnd(20)} ${r.detail}`),
      `\n--- EMPTY (${by('EMPTY').length}) — silently produced nothing (investigate) ---`, ...by('EMPTY').map(fmt),
      `\n--- NO-APPLY (${by('NO-APPLY').length}) — applyAsync-only (OCCT) ---`, ...by('NO-APPLY').map(fmt),
    ].join('\n');
    console.log(out);

    // Regression guards: no feature silently produces nothing, and nothing
    // unexpectedly needs context (a new context-gate must be added knowingly).
    const empty = by('EMPTY').map(r => r.type);
    expect(empty, `features silently producing no geometry: ${empty.join(', ')}`).toEqual([]);
    const unexpectedCtx = by('NEEDS-CTX').map(r => r.type).filter(t => !CONTEXT_GATED.has(t));
    expect(unexpectedCtx, `features newly failing to apply standalone: ${unexpectedCtx.join(', ')}`).toEqual([]);
    expect(by('OK').length).toBeGreaterThanOrEqual(33);
  });
});
