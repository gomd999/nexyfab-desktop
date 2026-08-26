# NexyFab Scope workspaces

NexyFab uses one integration branch and three permanent Git worktrees. Each
worktree is a complete checkout, while `workspaces/registry.json` assigns every
tracked path to one Scope or to the shared integration boundary.

`integration/nexyfab` is the canonical editable integration line.
`release/web-public-2026-08-26` is a clean deployment mirror and must not receive
standalone fixes. A release is eligible for deployment only when its commit is
identical to the integration commit.

| Scope | Branch | Worktree from `new/` | Primary target |
| --- | --- | --- | --- |
| Backend + Frontend | `scope/platform` | `../worktrees/platform` | `apps/` |
| Precision CAD | `scope/precision-cad` | `../worktrees/precision-cad` | `capabilities/precision-cad`, `domains/` |
| AI Design | `scope/ai-design` | `../worktrees/ai-design` | `capabilities/ai-design` |

## Start or resume a Scope session

1. Open the Scope worktree, not the integration checkout.
2. Run `npm run workspace:sync -- <scope> --apply`. This fast-forwards only a
   clean Scope that is behind integration; it refuses dirty, ahead, or diverged
   worktrees instead of merging implicitly.
3. Run `npm run workspace:load -- <scope>` to load `AGENTS.md`, `CURRENT.md`,
   and `DECISIONS.md`.
4. Confirm ownership with `npm run workspace:status -- <scope>`.
5. Keep shared contract or root configuration changes for a separate integration
   commit.

### Run three sessions without local collisions

Run each command inside its matching Scope worktree:

| Scope | Command | URL | Default local state |
| --- | --- | --- | --- |
| Platform | `npm run dev:platform` | `http://127.0.0.1:3100` | `.runtime/scopes/platform` |
| Precision CAD | `npm run dev:precision-cad` | `http://127.0.0.1:3200` | `.runtime/scopes/precision-cad` |
| AI Design | `npm run dev:ai-design` | `http://127.0.0.1:3300` | `.runtime/scopes/ai-design` |

The launcher refuses a mismatched branch and isolates `NEXYFAB_DB_PATH`,
`DATA_ROOT`, `NEXT_DIST_DIR`, site origin, and port. It clears an inherited
`DATABASE_URL` by default so three sessions cannot accidentally share a mutable
database. Inspect a profile without starting Next with
`npm run workspace:dev -- <scope> --print`. Use `--inherit-database` only for an
intentional shared integration test; it is not the normal Scope workflow.

## Save and hand off

1. Update the Scope's `CURRENT.md`.
2. Run `npm run workspace:check -- <scope>`.
3. Run `npm run workspace:handoff -- <scope> <slug>`, complete the generated
   verification and risk sections, then run
   `npm run workspace:handoff:check -- <scope>` and commit on the Scope branch.

## Integrate completed Scope work

From `new/` on `integration/nexyfab`:

1. Run `npm run workspace:integration-status` and inspect the Scope handoff.
2. Merge one Scope branch at a time with `git merge --no-ff scope/<name>`.
3. Run `npm run workspace:audit`, `npm run platform:architecture:check`, and the
   checks named by the merged handoff.
4. Run `npm run workspace:sync -- all --apply` to fast-forward every clean Scope
   and the release mirror to the validated integration head. The command refuses
   to move anything if a selected worktree is dirty, ahead, or diverged.
5. Run `npm run workspace:sync:check` before deployment. This requires all three
   Scope branches and the release mirror to equal the integration commit.

During active work, an ahead Scope is expected until its handoff is integrated.
It must be merged through the integration workflow; the sync command never
silently promotes Scope commits or resolves divergence.

`releaseGates` in the registry remain fail-closed release evidence checks. They
may be pending during ordinary development, but must never be reported as passed
without their required external evidence.
