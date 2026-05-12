# Track C — 2026-06-19 Gate Decision Matrix

Track C of the 3D roadmap (`docs/strategy/...` and the
`project_nexyfab_3d_roadmap.md` memory) joins the road 6 weeks after the
2026-05-08 kickoff — that is, 2026-06-19. Between now and then the work
is **data collection, not feature build**. The `cost-copilot:tighter`
A/B variant introduced in commit 98ef6d0 is the test signal for the
ramp decision.

This document tells you how to read the data on 2026-06-19 and what to do.

## What we're measuring

The variant cuts `cost-copilot` temperature 0.4 → 0.2 and `maxTokens`
2048 → 1200. Hypothesis: this preserves suggestion quality while reducing
per-call cost ~30-40%. The burn-in cron
(`/api/cron/prompt-variant-burnin`) compares the variant's traffic
against the baseline every 24h and emits a verdict per variant:

- `ok` — no regression observed
- `warn` — error rate or p95 latency is ≥1.5× baseline but <3×
- `regress` — error rate or p95 latency is ≥3× baseline (auto-disable
  trips here when `BURNIN_AUTO_DISABLE=1`)
- `insufficient_data` — too little traffic to call (`<200` variant calls)

## How to read the data on gate day

Run, from a shell with `CRON_SECRET` set:

```bash
BURNIN_URL=https://nexyfab.com/api/cron/prompt-variant-burnin \
CRON_SECRET=$CRON_SECRET \
FILTER=cost-copilot \
node scripts/burnin-status.mjs
```

This prints the variant's verdict, call volume, error rate, and p95
latency vs baseline. Exit code reflects worst verdict
(0 ok / 1 warn / 2 regress / 3 fetch fail).

## Decision matrix

| Variant verdict | Variant call volume | Decision |
|---|---|---|
| `ok` | ≥ 1,000 calls | **Ramp** — raise `AI_PROMPT_VARIANTS=cost-copilot:tighter@0.5` for one week, then `@1.0` if still `ok`. Begin Track C feature work. |
| `ok` | 200-999 calls | **Hold ramp, expand sample** — bump rollout to `@0.3` for another two weeks; revisit. Don't start Track C work yet. |
| `ok` | < 200 calls | **Likely AI usage is too low for the gate to be meaningful** — investigate why traffic is light before reading the burn-in result. Cost-copilot might just be unloved; that's also a Track C signal. |
| `warn` | any | **Investigate the warning reason** (the `reason` field on the verdict). Most common cause: a few outlier latency spikes from cold-start. Inspect the underlying `nf_usage_events` rows; if the spikes are real provider hiccups, leave the rollout at the current fraction and re-evaluate weekly. Do **not** start Track C work until verdict moves back to `ok`. |
| `regress` (auto-disabled) | any | **Variant is dead, hypothesis falsified.** Read the auto-disable reason. Write a postmortem in `docs/strategy/`. Track C still ramps, but on a different lever — likely chat-to-CAD UX (no temperature change) or a different prompt revision. |
| `regress` (auto-disable off) | any | **Manually disable** via the admin disabled-variants table, then treat as the regress case above. |
| `insufficient_data` | any | **Wait at least 2 more weeks**. AI feature usage may have been low. Re-check the cron output; if the situation persists past 2026-07-03, treat as the third row of this table. |

## What "begin Track C work" actually means

Per the prior memory (`project_nexyfab_3d_roadmap.md`), Track C is:

1. **Chat-to-CAD strengthening** — feed CAD model state into shape-chat
   prompts as compact context instead of the current full geometry dump.
2. **Real-time cost re-estimation** — after the user accepts an AI
   suggestion in `cost-copilot`, immediately rerun the cost helper with
   the new params and surface delta vs. previous estimate (closes the
   "AI says this saves 25% — does it actually?" loop).
3. **AI manufacturing match expansion** — extend `AISupplierPanel` from
   current static Top-3 to per-process suggestions with confidence
   scoring.

Sequencing: 1 → 2 → 3, because each unlocks the previous one's quality
measurement.

## What if the gate slips

If 2026-06-19 arrives and the variant verdict is still
`insufficient_data`, the gate doesn't move — slip the start by however
long it takes to accumulate signal. Do **not** start Track C feature
work in the dark; the whole point of the variant is to confirm cost
sensitivity is the right lever before betting weeks of work on it.
