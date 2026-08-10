/**
 * design_brief — MCP tool bridge (Wave A · WA-D3, 3면 표면의 MCP 면).
 *
 * The design driver is TypeScript over the own-CAD `@/lib/**` graph; this
 * server is plain `.mjs`. Rather than re-implement (and drift from) the driver,
 * we shell out to `design-brief-runner.ts` via tsx — the SAME shared runner the
 * API route calls — so the same brief yields the same package (동일 계약,
 * 결정론 플래너 기준). No fabricated values: a package is returned only when
 * every gate passed; otherwise an explicit refusal IR (stage/reason/게이트).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'design-brief-runner.ts');
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const RESULT_PREFIX = '@@NEXYFAB_DESIGN_BRIEF_JSON@@';

/**
 * Run a design brief through the real TS driver and return the shared payload.
 * @param {{id?:string,text:string,params?:object}|{brief?:object,text?:string,fixture?:string,params?:object}} brief
 * @returns {Promise<object>} { ok:true, planId, package } | { ok:false, refusal, gates } | { ok:false, error }
 */
export function runDesignBriefTool(brief) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', RUNNER], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => resolve({ ok: false, error: `spawn failed: ${e.message}` }));
    child.on('close', () => {
      const trimmed = out.trim();
      if (!trimmed) {
        resolve({ ok: false, error: `design-brief runner produced no output${err ? `: ${err.trim().slice(0, 300)}` : ''}` });
        return;
      }
      // OCCT/STEP writers emit native transfer statistics directly to stdout.
      // Read only the runner's explicitly framed final payload so those logs
      // cannot corrupt the MCP JSON contract.
      const marker = out.lastIndexOf(RESULT_PREFIX);
      const framed = marker >= 0
        ? out.slice(marker + RESULT_PREFIX.length).split(/\r?\n/, 1)[0].trim()
        : trimmed;
      try {
        resolve(JSON.parse(framed));
      } catch {
        resolve({ ok: false, error: `design-brief runner returned non-JSON: ${framed.slice(0, 300)}` });
      }
    });
    // The runner reads the brief JSON from stdin.
    child.stdin.write(JSON.stringify(brief ?? {}));
    child.stdin.end();
  });
}
