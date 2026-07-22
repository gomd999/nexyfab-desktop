/**
 * code_check — MCP tool / CLI command bridge (감리·코드체크, LOCAL/offline).
 *
 * The codecheck ruleset is TypeScript over `src/lib/eng-domain/codecheck`; this
 * server is plain `.mjs`. Rather than re-implement (and drift from) the rules,
 * we shell out to `codecheck-runner.ts` via tsx — the SAME pure module the API
 * route (POST /api/nexyfab/codecheck) calls — so the same features yield the same
 * report (동일 계약). Unlike analyze_fea / reconstruct_* this needs NO hosted
 * server binaries; the rules are pure/deterministic, so code_check runs fully
 * OFFLINE (no NEXYFAB_API_KEY required). Each rule cites a real public 법령/기준
 * clause; a missing feature is NA (never assumed compliant); the non-statutory
 * disclaimer is always returned.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'codecheck-runner.ts');
const PROJECT_ROOT = path.resolve(HERE, '..', '..');

/**
 * Run the deterministic codecheck ruleset over measured features (LOCAL, pure).
 * @param {{features?:object, list?:boolean}} input
 * @returns {Promise<object>} { ok:true, results[], passCount, failCount, naCount, violations[], disclaimer }
 *                            | { ok:true, rules[] } (list) | { ok:false, error }
 */
export function runCodeCheckTool(input) {
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
        resolve({ ok: false, error: `codecheck runner produced no output${err ? `: ${err.trim().slice(0, 300)}` : ''}` });
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        resolve({ ok: false, error: `codecheck runner returned non-JSON: ${trimmed.slice(0, 300)}` });
      }
    });
    child.stdin.write(JSON.stringify(input ?? {}));
    child.stdin.end();
  });
}
