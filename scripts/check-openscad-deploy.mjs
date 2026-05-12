#!/usr/bin/env node
/**
 * Post-deploy OpenSCAD health probe.
 *
 * Hits /api/health/openscad on the target host and pretty-prints the result.
 * Exits 0 on green, 1 on degraded (BOSL2 missing — agent still works for
 * primitives but not gear/thread), 2 on error (binary or render failure).
 *
 * Usage:
 *   node scripts/check-openscad-deploy.mjs
 *     → uses NEXYFAB_HEALTH_URL or https://nexyfab.com
 *
 *   node scripts/check-openscad-deploy.mjs --url=https://staging.nexyfab.com
 *
 *   node scripts/check-openscad-deploy.mjs --secret=$ADMIN_SECRET
 *     → required if production has ADMIN_SECRET set
 */

const args = process.argv.slice(2);
const urlArg = args.find(a => a.startsWith('--url='));
const secretArg = args.find(a => a.startsWith('--secret='));

const baseUrl = urlArg ? urlArg.slice('--url='.length) : (process.env.NEXYFAB_HEALTH_URL || 'https://nexyfab.com');
const secret = secretArg ? secretArg.slice('--secret='.length) : (process.env.ADMIN_SECRET || '');

const url = `${baseUrl.replace(/\/+$/, '')}/api/health/openscad`;

console.log(`🔍 Probing ${url}\n`);

try {
  const headers = secret ? { 'x-admin-secret': secret } : {};
  const resp = await fetch(url, { headers });
  const body = await resp.json();

  console.log(`HTTP ${resp.status}`);
  console.log(`Status: ${statusIcon(body.status)} ${body.status}\n`);

  console.log(`Binary  ${checkLine(body.binary)}`);
  console.log(`BOSL2   ${checkLine(body.bosl2)}`);
  console.log(`Render  ${checkLine(body.render)}\n`);

  console.log(`Env:`);
  console.log(`  OPENSCAD_BIN     = ${body.env?.OPENSCAD_BIN ?? '(unset)'}`);
  console.log(`  OPENSCADPATH     = ${body.env?.OPENSCADPATH ?? '(unset)'}`);
  console.log(`  OPENSCAD_USE_DOCKER = ${body.env?.OPENSCAD_USE_DOCKER ?? '(unset)'}`);

  if (body.status === 'ok') process.exit(0);
  if (body.status === 'degraded') process.exit(1);
  process.exit(2);
} catch (e) {
  console.error(`💥 ${e.message}`);
  if (resp && resp.status === 401) {
    console.error('   Hint: pass --secret=$ADMIN_SECRET if the deploy has it set.');
  }
  process.exit(3);
}

function statusIcon(s) {
  if (s === 'ok') return '✅';
  if (s === 'degraded') return '⚠️';
  return '❌';
}
function checkLine(c) {
  if (!c) return '— (no result)';
  const icon = c.ok ? '✅' : '❌';
  const detail = c.detail || c.error || '';
  return `${icon} ${c.ms}ms  ${detail}`;
}
