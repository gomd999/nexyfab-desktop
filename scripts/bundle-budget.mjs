#!/usr/bin/env node
// bundle-budget — guards against client-bundle bloat regressions.
//
// Reads `.next/build-manifest.json` + `.next/static/chunks/*` after a build
// and compares total + per-route initial JS against budgets declared in
// `bundle-budget.json` (next to this script).
//
// Exit code 0 = within budget, 1 = over budget (fail CI),
//          2 = build artefacts missing (no build run).
//
// Usage:
//   node scripts/bundle-budget.mjs            — enforce budgets, fail on excess
//   node scripts/bundle-budget.mjs --update   — overwrite budgets with current sizes
//   node scripts/bundle-budget.mjs --json     — machine-readable output

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAppRouteBundles } from './app-route-bundle-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const nextDir = join(root, process.env.NEXT_DIST_DIR || '.next');
const manifestPath = join(nextDir, 'build-manifest.json');
const budgetPath = join(__dirname, 'bundle-budget.json');

const args = process.argv.slice(2);
const flagUpdate = args.includes('--update');
const flagJson = args.includes('--json');
const existingBudget = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf-8')) : null;

if (!existsSync(manifestPath)) {
  console.error('✗ .next/build-manifest.json not found — run `npm run build` first.');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

/** chunk file path (relative to .next) → size in bytes (gzipped estimate ≈ raw × 0.32) */
const fileBytes = new Map();
function sizeOf(relPath) {
  if (fileBytes.has(relPath)) return fileBytes.get(relPath);
  const direct = join(nextDir, relPath);
  const abs = existsSync(direct) ? direct : join(nextDir, decodeURIComponent(relPath));
  if (!existsSync(abs)) return 0;
  const s = statSync(abs).size;
  fileBytes.set(relPath, s);
  return s;
}

function sumChunks(chunks) {
  return chunks.reduce((acc, f) => acc + sizeOf(f), 0);
}

const sharedChunks = manifest.rootMainFiles ?? [];
const sharedBytes = sumChunks(sharedChunks);

const perPage = {};
for (const [route, chunks] of Object.entries(manifest.pages ?? {})) {
  if (route === '/_app' || route === '/_error') continue;
  perPage[route] = sumChunks(chunks);
}

const appRouteBundles = collectAppRouteBundles(nextDir);
for (const route of appRouteBundles) {
  if (route.measured) perPage[route.route] = route.initialJsBytes;
}

const totals = {
  shared: sharedBytes,
  routes: perPage,
  appRoutesMeasured: appRouteBundles.filter(route => route.measured).length,
  appRouteCss: Object.fromEntries(appRouteBundles.filter(route => route.measured).map(route => [route.route, route.cssBytes])),
  // Total = shared + max(route). Rough proxy for "first-paint JS".
  worstFirstPaint:
    sharedBytes + Math.max(0, ...Object.values(perPage)),
};

// Budget file: { shared: bytes, worstFirstPaint: bytes, routes: { '/x': bytes } }
const trackedRoutes = [...new Set([
  ...Object.keys(existingBudget?.routes ?? {}),
  ...(existingBudget?.requiredAppRoutes ?? []),
])];
const defaultBudget = {
  shared: Math.round(sharedBytes * 1.1),
  worstFirstPaint: Math.round(totals.worstFirstPaint * 1.1),
  routes: Object.fromEntries(
    trackedRoutes.filter(route => typeof perPage[route] === 'number').map(route => [route, Math.round(perPage[route] * 1.1)]),
  ),
  requiredAppRoutes: existingBudget?.requiredAppRoutes ?? [],
  note:
    '10% headroom over the build that created this file. Run `npm run bundle:budget -- --update` after intentional growth.',
};

if (flagUpdate || !existsSync(budgetPath)) {
  writeFileSync(budgetPath, JSON.stringify(defaultBudget, null, 2) + '\n');
  console.log(`✓ wrote budget snapshot to ${budgetPath}`);
  if (!flagUpdate) {
    console.log('  (first run — no enforcement this time)');
    process.exit(0);
  }
  process.exit(0);
}

const budget = existingBudget;
const violations = [];
const fmt = (n) => `${(n / 1024).toFixed(1)} KB`;

function check(label, actual, limit) {
  if (typeof limit !== 'number' || limit <= 0) return;
  if (actual > limit) {
    violations.push({
      label,
      actual,
      limit,
      overBy: actual - limit,
    });
  }
}

check('shared', totals.shared, budget.shared);
check('worstFirstPaint', totals.worstFirstPaint, budget.worstFirstPaint);
for (const [route, bytes] of Object.entries(perPage)) {
  if (budget.routes?.[route]) check(`route:${route}`, bytes, budget.routes[route]);
}
for (const route of budget.requiredAppRoutes ?? []) {
  if (!appRouteBundles.some(candidate => candidate.route === route && candidate.measured)) {
    violations.push({ label: `app-route-unmeasured:${route}`, actual: 0, limit: 1, overBy: 1 });
  }
}

if (flagJson) {
  console.log(JSON.stringify({ totals, budget, violations }, null, 2));
  process.exit(violations.length ? 1 : 0);
}

console.log('Bundle size report');
console.log('──────────────────');
console.log(`Shared chunks: ${fmt(totals.shared)}  (budget ${fmt(budget.shared)})`);
console.log(`Worst first-paint: ${fmt(totals.worstFirstPaint)}  (budget ${fmt(budget.worstFirstPaint)})`);
console.log(`Measured App Router entries: ${totals.appRoutesMeasured}`);
console.log('');
const topRoutes = Object.entries(perPage)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
console.log('Top 10 routes by initial JS:');
for (const [route, bytes] of topRoutes) {
  const lim = budget.routes?.[route];
  const flag = lim && bytes > lim ? ' ✗ OVER' : '';
  console.log(`  ${fmt(bytes).padStart(9)}  ${route}${flag}`);
}

if (violations.length === 0) {
  console.log('\n✓ within budget');
  process.exit(0);
}

console.error('\n✗ Bundle size budget exceeded:');
for (const v of violations) {
  console.error(`  ${v.label}: ${fmt(v.actual)} (budget ${fmt(v.limit)}, over by ${fmt(v.overBy)})`);
}
console.error('\nIf this growth is intentional, run:  npm run bundle:budget -- --update');
process.exit(1);
