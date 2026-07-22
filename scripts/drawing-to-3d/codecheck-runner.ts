/**
 * code_check MCP/CLI runner — spawned by codecheck.mjs (which the MCP server's
 * `code_check` tool and the CLI `codecheck` command delegate to). Reads a JSON
 * body on stdin, runs the SHARED deterministic codecheck ruleset (the exact same
 * pure module the API route uses), and prints the report JSON on stdout.
 *
 * Why a subprocess: the ruleset is TypeScript under `src/lib/eng-domain/**`; the
 * MCP server / CLI are plain `.mjs` under Node. Shelling out to tsx runs the REAL
 * module (not a re-implementation), so code_check on the CLI/MCP is byte-identical
 * to POST /api/nexyfab/codecheck for the same features (동일 계약). Unlike FEA /
 * reconstruction this needs NO hosted server binaries — the rules are pure, so
 * code_check works fully OFFLINE. The project is CJS, so this uses an async IIFE.
 *
 * Contract (mirrors the route):
 *   stdin { list:true }            -> { ok:true, rules[] } (static catalog)
 *   stdin { features:{...} }       -> { ok:true, results[], passCount, failCount,
 *                                       naCount, violations[], disclaimer }
 * Values are sanitized exactly like the route (finite numbers / booleans / strings
 * only — never fabricate; a dropped field yields NA, never assumed compliance).
 */

import {
  CODECHECK_RULES,
  runCodeCheck,
  type CodeCheckFeatures,
} from '../../src/lib/eng-domain/codecheck';

function catalog() {
  return CODECHECK_RULES.map((r) => ({
    id: r.id,
    category: r.category,
    clause: r.clause,
    source: r.source,
    requirement: r.requirement,
  }));
}

(async () => {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  let body: { list?: boolean; features?: unknown } = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    body = {};
  }

  if (body.list) {
    process.stdout.write(JSON.stringify({ ok: true, rules: catalog() }));
    return;
  }

  const features = body.features;
  if (!features || typeof features !== 'object') {
    process.stdout.write(JSON.stringify({ ok: false, error: 'features 객체가 필요합니다. (룰 목록은 { list:true })' }));
    process.exitCode = 1;
    return;
  }

  // sanitize: only accept finite numbers / known enums / booleans (never fabricate).
  const clean: CodeCheckFeatures = {};
  for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) (clean as Record<string, unknown>)[k] = v;
    else if (typeof v === 'boolean' || typeof v === 'string') (clean as Record<string, unknown>)[k] = v;
    // undefined / null / NaN -> dropped -> rule returns NA (honest)
  }

  const report = runCodeCheck(clean);
  process.stdout.write(JSON.stringify({ ok: true, ...report }));
})().catch((e: unknown) => {
  process.stdout.write(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
});
