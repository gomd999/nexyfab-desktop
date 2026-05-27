# Self-Review Policy

**Status:** active · **Adopted:** 2026-05-26 (Wave 0)

NexyFab development is currently solo. Without a peer reviewer the easiest
class of regression — the one you *would* have caught in someone else's
code in 15 seconds — slips into `main`. This policy puts the gap back.

## The three rules

### Rule 1 — `main` is protected

GitHub-enforced (applied 2026-05-26 via `gh api repos/.../branches/main/protection`):

- `required_linear_history: true` — no merge commits; rebase or squash only
- `allow_force_pushes: false` — `git push --force` to main is blocked
- `allow_deletions: false` — main cannot be deleted
- `enforce_admins: false` — repo admin (you) can override in emergencies

Policy-enforced (not via GitHub, solo self-discipline):

- No direct pushes to `main`. Every change lands via a PR (even your own).
- Required status checks on the PR: `TypeScript Check`, `ESLint`, `Unit Tests`
  from `.github/workflows/ci.yml`. (Add via `gh api .../required_status_checks`
  once Wave 0 stable.)

Exception: revert commits during an active incident (use `git revert`,
not `--force`).

### Rule 2 — 24 hour self-review delay

After opening your own PR, **wait at least 24h before merging**. Re-read
the diff with fresh eyes the next morning. This is the single most
effective bug-catching technique a solo developer has, and it costs
nothing but patience.

If the work is genuinely urgent (production incident, security fix):

- Mark the PR `[hotfix]` in the title.
- The 24h rule is waived.
- Write a short note in the PR: "skipping 24h delay because …".
- File a follow-up issue to revisit within a week.

Don't abuse the hotfix path. If you reach for it more than once a month,
the underlying problem is process, not the bug at hand.

### Rule 3 — The fresh-eyes checklist

When you come back to your own PR for self-review, run through this list
out loud:

- [ ] **Risk tier**: did I label this `[P0]` / `[P1]` / `[P2]` in the
      commit message? (See `risk-policy.md`.)
- [ ] **What's the blast radius?** Open the dependency graph — does any
      file outside the diff import a symbol I renamed / removed?
- [ ] **What's the reversal plan?** Feature flag, `git revert`, DB
      migration `down` — one of these must exist. State it in the PR
      description.
- [ ] **Did I read the diff right to left?** Easier to spot omissions
      that way.
- [ ] **Do the tests cover the failure mode**, not just the happy path?
- [ ] **Is anything in the PR that wasn't in the original DoD?** If yes,
      either remove it or split into a separate PR.
- [ ] **Does the change drift toward "while I'm here" cleanup?** Same
      answer: split.

## When the delay is genuinely painful

If you find yourself wishing the 24h rule away, it usually means one of:

- The PR is too big. Split it.
- You're stacking work that depends on this PR being merged. Stack on
  the branch instead (`git switch -c next-branch && git rebase …`).
- The work is exploratory and you're not actually ready to merge. Mark
  it `[draft]` and remove the merge button from your mental model.

## What this policy does NOT replace

- **CI gates** (Layer 3 in `error-prevention-plan.md`). The hook and CI
  run *every* time regardless of how you reviewed.
- **Staging deploys**. 24h on a PR is not a substitute for watching the
  canary roll out.
- **Postmortems**. When a `main` push causes an incident, write one. The
  policy is a filter, not a guarantee.
