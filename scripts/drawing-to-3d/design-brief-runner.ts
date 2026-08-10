/**
 * design_brief MCP runner — spawned by design-brief.mjs (which the MCP server's
 * `design_brief` tool delegates to). Reads a brief JSON on stdin, runs the
 * SHARED design-brief runner (the exact same code path as the API route), and
 * prints the surface-shared payload JSON on stdout.
 *
 * Why a subprocess: the design driver is TypeScript that pulls the own-CAD
 * `@/lib/**` graph; the MCP server is a plain `.mjs` under Node. Shelling out
 * to tsx runs the REAL driver (not a re-implementation), so MCP/API/web are
 * byte-identical for the same brief (동일 계약). The project is CJS, so this
 * uses an async IIFE — no top-level await.
 */

import { parseBrief, runDesignBrief } from '../../src/app/api/nexyfab/design-brief/runner';

const RESULT_PREFIX = '@@NEXYFAB_DESIGN_BRIEF_JSON@@';
const writeResult = (value: unknown) => {
  process.stdout.write(`\n${RESULT_PREFIX}${JSON.stringify(value)}\n`);
};

(async () => {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  let body: unknown = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    body = {};
  }
  const parsed = parseBrief(body);
  if ('error' in parsed) {
    writeResult({ ok: false, error: parsed.error });
    return;
  }
  const payload = await runDesignBrief(parsed.brief);
  writeResult(payload);
})().catch((e: unknown) => {
  writeResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});
