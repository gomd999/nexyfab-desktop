# Non-destructive workspace cleanup policy

This repository is cleaned by preservation and quarantine, not deletion.

## Protected items

- Never delete `integration/nexyfab`, `scope/platform`, `scope/precision-cad`, or
  `scope/ai-design` branches or their permanent worktrees.
- Treat any dirty worktree as protected until its patch and ignored runtime data
  have a verified checkpoint.
- Do not delete or move `.env*`, `data/`, databases, uploads, `.codex-runtime`,
  or evidence artifacts without an explicit data-owner decision.
- Preserve all Git refs in a verified bundle before any worktree metadata change.

## Allowed organization actions

- Move regenerable caches such as `.next/` into a dated quarantine directory only
  after confirming no process or lock file is using them.
- Move empty, unregistered directories into quarantine after recording their
  original path.
- Keep dormant worktrees and branches in place when their ownership is unknown;
  record their path, branch, HEAD, dirty state, and ignored data instead.
- Run `git worktree prune` only after its dry-run output has been reviewed and
  the user has explicitly approved metadata cleanup.

## Required evidence

Before and after cleanup, record:

- `git worktree list --porcelain`
- branch, HEAD, and `git status --short` for every protected worktree
- `npm run workspace:integration-status`
- `npm run workspace:audit`
- bundle verification and checkpoint SHA256 values
- quarantine paths and file counts

Cleanup is complete only when the four operating worktrees are clean and at the
same integration HEAD, the dirty worktree checkpoint exists, private runtime
data remains recoverable, and the restore instructions are present.

Current preservation package: `../nexyfab-cleanup-20260823-001/`.
