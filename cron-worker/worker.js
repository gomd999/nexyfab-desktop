/**
 * nexyfab-cron — Cloudflare Worker that drives all /api/cron/* jobs on
 * nexyfab.com (Railway has no native HTTP-cron, so this worker is the
 * scheduler of record).
 *
 * Auth: the app's GET cron routes expect `Authorization: Bearer ${CRON_SECRET}`,
 * the POST ones expect `x-cron-secret: ${CRON_SECRET}`. We always send both.
 *
 * Schedules (UTC):
 *   - *​/5 * * * *  → cost breaker + stuck-payment recovery (5-min sweeps)
 *   - 0 18 * * *   → 03:00 KST housekeeping (prunes, expiries, burn-ins, billing)
 *   - 0 0 * * *    → 09:00 KST human-facing (digests, reminders, SLA emails)
 *   - 0 1 * * 1    → Monday 10:00 KST weekly anti-poach sweep
 *
 * Worker secret: CRON_SECRET (wrangler secret put CRON_SECRET) — must equal
 * the Railway service variable of the same name.
 */

const BASE = 'https://nexyfab.com/api/cron';

// Routes implemented as POST (they read x-cron-secret); everything else is GET.
const POST_ROUTES = new Set(['trial-reminders', 'cancel-winback', 'fx-rates', 'metered-billing']);

const EVERY_5_MIN = ['cost-breaker-check', 'payment-stuck-recovery'];

// 03:00 KST — machine housekeeping. No human-facing email in this batch
// except rfq 7-day reminders, which moved to the morning batch instead.
const NIGHTLY_18_UTC = [
  'audit-prune',
  'webhook-prune',
  'budget-warning-prune',
  'demo-session-prune',
  'billing-grace-prune',
  'quote-expire',
  'prompt-cost-budget',
  'prompt-variant-burnin',
  'burnin-step-corpus',
  'fx-rates',
  'metered-billing',
];

// 09:00 KST — anything that emails customers/partners lands in the morning.
const MORNING_0_UTC = [
  'trial-reminders',
  'ops-digest',
  'concierge-digest',
  'cancel-winback',
  'order-delays',
  'partner-nonresponse-sla',
  'pro-grace-expiry',
  'rfq-expire',
];

const WEEKLY_MON_1_UTC = ['anti-poach-signals'];

async function runJob(name, env) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/${name}`, {
      method: POST_ROUTES.has(name) ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        'x-cron-secret': env.CRON_SECRET,
        'user-agent': 'nexyfab-cron-worker',
      },
    });
    const ms = Date.now() - started;
    const body = res.ok ? '' : ` ${(await res.text()).slice(0, 200)}`;
    console.log(`[cron] ${name} → ${res.status} (${ms}ms)${body}`);
    return { name, status: res.status, ms };
  } catch (err) {
    console.log(`[cron] ${name} → FETCH ERROR ${err.message}`);
    return { name, status: 0, error: err.message };
  }
}

export default {
  async scheduled(event, env, ctx) {
    // Single */5 trigger (account cron-trigger limit); batches are routed
    // from the tick timestamp. The :00 tick of the matching hour carries
    // the daily/weekly batches on top of the 5-min sweeps.
    const t = new Date(event.scheduledTime);
    const jobs = [...EVERY_5_MIN];
    if (t.getUTCMinutes() === 0) {
      if (t.getUTCHours() === 18) jobs.push(...NIGHTLY_18_UTC);
      if (t.getUTCHours() === 0) jobs.push(...MORNING_0_UTC);
      if (t.getUTCHours() === 1 && t.getUTCDay() === 1) jobs.push(...WEEKLY_MON_1_UTC);
    }
    ctx.waitUntil(Promise.allSettled(jobs.map((j) => runJob(j, env))));
  },

  // Manual smoke: GET /run/<job-name> with x-admin-key matching CRON_SECRET
  // (lets us trigger any single job once without waiting for the schedule).
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/run\/([a-z0-9-]+)$/);
    if (!m) return new Response('nexyfab-cron ok', { status: 200 });
    if (req.headers.get('x-admin-key') !== env.CRON_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const result = await runJob(m[1], env);
    return Response.json(result);
  },
};
