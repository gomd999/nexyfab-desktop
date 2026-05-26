# Commit Policy

**Status:** active · **Adopted:** 2026-05-26 (Wave 0 Day 1.5)

Single source of truth for **how to commit and PR** in this repo. Builds
on [risk-policy.md](./risk-policy.md) (which tier to label) and
[self-review-policy.md](./self-review-policy.md) (24h delay).

## Why this exists

Solo development without an explicit commit policy degenerates into:
- 4-day accumulated working trees that get squashed into one mega-commit
- Different commit conventions per session ("this time conventional,
  next time imperative + scope, next time emoji")
- Bisect that fails because each commit doesn't independently work
- PRs without rollback plans because the format never asked

The policy answers these questions **once**, then automation enforces it.

## The format

### Commit subject

```
[P0|P1|P2] type(scope?): subject
```

- **Risk tier** in brackets (required) — see [risk-policy.md](./risk-policy.md)
- **Type**: `feat | fix | chore | docs | refactor | test | style | perf | build | ci | revert`
- **Scope** (optional): `(cad)`, `(auth)`, `(rfq)`, etc.
- **Subject**: imperative, present tense, ≤ 72 chars total (header)

Examples:

```
[P0] feat(cad): B-rep boolean for non-convex polygons
[P1] refactor(ui): split ShapeGeneratorInner into 3 route chunks
[P2] docs(process): commit-policy quick reference
[P0] fix(auth): clear nf_access_token cookie on logout
[P1] chore(deps): bump three to 0.184 for WebGL2 fixes
```

### Commit body (optional but encouraged for P0/P1)

- Wrap at 100 chars
- Explain **why**, not what (diff already shows what)
- Reference ADR / issue / customer report if relevant
- For P0: state the reversal mechanism explicitly

```
[P0] feat(payment): switch invoice generator to Airwallex

Stripe's KR tax invoice path was rejecting payloads >5MB after the
2026-05 API change. Airwallex accepts the same shape with no size
limit and we already have the integration.

Reversal: env flag PAYMENT_PROVIDER=stripe rolls back without code.
Tested on staging with the 8MB historical max invoice.

Ref: ADR-007, customer-report #1432
```

### What is NOT allowed

- ❌ `wip: ...` or `[WIP] ...` — never reach `main`. Stay on branch.
- ❌ `Fix typo` — no tier, no type. Will be rejected by hook.
- ❌ `[P3]` or `[P4]` — only three tiers exist.
- ❌ Empty body when subject promises detail (`see body`)

## Enforcement (automated)

| Where | What | Bypass |
|---|---|---|
| `.husky/commit-msg` → `commitlint` | Subject format | `git commit --no-verify` (log reason in next body) |
| `.husky/pre-commit` size gate | ≤ 800 lines, ≤ 15 files | `ALLOW_BIG=1 git commit ...` (log reason in body) |
| `.husky/pre-commit` lint-staged | eslint on staged files | `--no-verify` |
| `.husky/pre-commit` typecheck | `tsc --noEmit` project-wide | `--no-verify` |
| `.husky/pre-commit` vitest related | Tests for staged code | `--no-verify` |
| `.github/workflows/pr-title-lint.yml` | PR title same format | Edit title; cannot bypass |
| GitHub branch protection on `main` | Linear history, no force push | `enforce_admins: false` (you can override; logged in API audit) |

## Bypass discipline

Every `--no-verify` or `ALLOW_BIG=1` use:

1. **Must be explained** in the next commit body (or in this commit's
   body if the bypass is for this commit):
   ```
   [P2] chore: regenerate i18n schema (autogen)

   ALLOW_BIG=1 used: schema codegen produces 47 files / 2.3k lines in
   one atomic emission. Splitting breaks the schema atomicity guarantee.
   ```
2. Counted in quarterly review. > 1 bypass per month = process problem,
   not policy problem.

## PR structure

### Size

- ≤ 10 commits per PR
- ≤ 2000 lines total diff (excluding lockfiles, generated, snapshots)
- ≥ 800 lines? Add a "why this isn't split" line to PR description

### Commit ordering inside a PR

**P0 commits come LAST.** Rationale: if the PR's prod-affecting commit
breaks, you revert that one commit and keep the safe earlier work. If
P0 is in the middle, every revert above it is collateral.

Typical Wave-scale PR ordering:

```
1. [P2] docs(...): policy / runbook updates
2. [P1] chore(...): build / lint / type tightening
3. [P1] feat(...): new tooling / infra (no prod path)
4. [P0] feat(...): user-facing change
```

### PR title

Same format as commit subject:

```
[P1] feat(cad): wave-1 STEP export route A
```

This becomes the squash-merge commit message, so it must pass commitlint
too (enforced by `.github/workflows/pr-title-lint.yml`).

### PR description

Use `.github/pull_request_template.md`. Every field has a purpose:

- **Summary** — what + why, 1-3 sentences
- **Risk tier** — checkbox, must match commits
- **Reversal plan** — explicit. "I'll figure it out" is not a plan.
- **Blast radius** — list affected files/features
- **Test plan** — checked items, not free text promises
- **Commits** — for multi-commit PRs, list in order

## Cadence policy

To prevent 4-day-accumulated-working-tree:

- **Commit at end of every work session.** Even WIP locally — squash
  later. No working tree should survive overnight without a commit
  unless you flagged it (`[stash] ...` branch).
- **Push to remote daily.** Local commits aren't backups.
- **Open PR within 24h of starting a Wave-scale work block.** Stale
  branches drift; review fresh diffs catch more bugs than ancient ones.

## What about hotfixes?

- Subject: `[P0] fix(scope): <terse description> [hotfix]`
- `[hotfix]` tag waives 24h self-review delay
- Body MUST include: postmortem link or commitment to write one in
  ≤ 1 week
- Still goes through commitlint, size gate, lint-staged, typecheck

## When to update this policy

- After every incident where commit hygiene was a contributing factor
- Quarterly review (catch policy decay)
- When tooling changes (commitlint version, husky version) and changes
  the enforcement surface

Each policy change is itself a `[P1] docs(process): ...` commit with an
ADR if the change is structural (not just wording).

## Quick reference card

```
                    NexyFab commit policy
                    ─────────────────────
  Subject:    [P0|P1|P2] type(scope?): ≤72 chars imperative
  Body:       why, not what. Wrap @100. P0 includes reversal mechanism.
  Size:       ≤800 lines, ≤15 files (ALLOW_BIG=1 to bypass with reason)
  PR title:   same format as commit subject (becomes squash message)
  PR size:    ≤10 commits, ≤2000 lines diff
  PR order:   P2 → P1 → P0 (P0 LAST)
  PR delay:   24h self-review (waived for [hotfix])
  Bypass:     --no-verify only when justified; log reason in next body
```
