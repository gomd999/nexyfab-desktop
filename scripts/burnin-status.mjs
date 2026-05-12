#!/usr/bin/env node
/**
 * Track C decision support — pretty-prints the current A/B variant burn-in
 * verdicts so the 2026-06-19 cost-copilot:tighter go/no-go decision has
 * data to look at.
 *
 * Usage (from repo root):
 *   BURNIN_URL=https://nexyfab.com/api/cron/prompt-variant-burnin \
 *   CRON_SECRET=$CRON_SECRET \
 *   node scripts/burnin-status.mjs
 *
 *   # Or focus on one variant:
 *   FILTER=cost-copilot:tighter node scripts/burnin-status.mjs
 *
 * Exit codes:
 *   0  — every variant in scope is `ok` or `insufficient_data`
 *   1  — at least one variant is `warn` (review needed)
 *   2  — at least one variant is `regress` (consider disabling)
 *   3  — fetch failed
 *
 * Notes:
 *   - The cron endpoint requires `Authorization: Bearer $CRON_SECRET`. Reuse
 *     the same secret you set on Railway.
 *   - The endpoint is a *read-mostly* GET — it still sends ops alerts as a
 *     side-effect, so don't poll it tighter than once per minute.
 *   - The decision matrix in docs/strategy/track-c-gate-decision.md spells
 *     out what each verdict means for the ramp call.
 */

const url = process.env.BURNIN_URL ?? 'http://localhost:3000/api/cron/prompt-variant-burnin';
const secret = process.env.CRON_SECRET;
const filter = process.env.FILTER ?? '';

if (!secret) {
  console.error('CRON_SECRET env var is required.');
  process.exit(3);
}

const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } }).catch(err => {
  console.error('Fetch failed:', err.message);
  return null;
});
if (!res) process.exit(3);
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  process.exit(3);
}

/** @type {{ summary: Record<string, number>, verdicts: Array<Record<string, unknown>>, windowMs: number, sampleSize: number, autoDisabled: Array<{variantId: string, reason: string}> }} */
const body = await res.json();

const verdicts = filter
  ? body.verdicts.filter(v => String(v.variantId).includes(filter))
  : body.verdicts;

if (verdicts.length === 0) {
  console.log(`No verdicts${filter ? ` matching "${filter}"` : ''} in the last ${Math.round(body.windowMs / 3600_000)}h window.`);
  console.log(`Sample size: ${body.sampleSize}. Cron may not have collected enough traffic yet.`);
  process.exit(0);
}

const widths = { id: 32, calls: 8, err: 10, p95: 9, ratio: 8, verdict: 18 };
const headerCols = ['variantId', 'calls', 'errRate', 'p95(ms)', 'eRatio', 'verdict'];
const widthList = [widths.id, widths.calls, widths.err, widths.p95, widths.ratio, widths.verdict];

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length);
}

console.log(`Burn-in window: last ${Math.round(body.windowMs / 3600_000)}h | sample: ${body.sampleSize}`);
console.log(`Summary: ${JSON.stringify(body.summary)}`);
if (body.autoDisabled?.length) {
  console.log(`Auto-disabled this run:`);
  for (const a of body.autoDisabled) console.log(`  • ${a.variantId}: ${a.reason}`);
}
console.log('');
console.log(headerCols.map((c, i) => pad(c, widthList[i])).join('  '));
console.log(widthList.map(w => '-'.repeat(w)).join('  '));

let worst = 'ok';
const rank = { ok: 0, insufficient_data: 0, warn: 1, regress: 2 };
for (const v of verdicts) {
  const errRate = `${(Number(v.variantErrorRate) * 100).toFixed(1)}%`;
  const p95 = String(v.variantP95);
  const ratio = Number.isFinite(Number(v.errorRatio)) ? Number(v.errorRatio).toFixed(2) : '∞';
  const cols = [v.variantId, v.variantCount, errRate, p95, ratio, v.verdict];
  console.log(cols.map((c, i) => pad(c, widthList[i])).join('  '));
  if (v.reason) console.log(`  ↳ ${v.reason}`);
  if (rank[String(v.verdict)] > rank[worst]) worst = String(v.verdict);
}

if (worst === 'regress') process.exit(2);
if (worst === 'warn') process.exit(1);
process.exit(0);
