# NexyFab Scope workspaces

NexyFab uses one integration branch and three permanent Git worktrees. Each
worktree is a complete checkout, while `workspaces/registry.json` assigns every
tracked path to one Scope or to the shared integration boundary.

| Scope | Branch | Worktree from `new/` | Primary target |
| --- | --- | --- | --- |
| Backend + Frontend | `scope/platform` | `../worktrees/platform` | `apps/` |
| Precision CAD | `scope/precision-cad` | `../worktrees/precision-cad` | `capabilities/precision-cad`, `domains/` |
| AI Design | `scope/ai-design` | `../worktrees/ai-design` | `capabilities/ai-design` |

## Start or resume a Scope session

1. Open the Scope worktree, not the integration checkout.
2. Run `npm run workspace:load -- <scope>` to load `AGENTS.md`, `CURRENT.md`,
   and `DECISIONS.md`.
3. Confirm ownership with `npm run workspace:status -- <scope>`.
4. Keep shared contract or root configuration changes for a separate integration
   commit.

## Save and hand off

1. Update the Scope's `CURRENT.md`.
2. Run `npm run workspace:check -- <scope>`.
3. Run `npm run workspace:handoff -- <scope> <slug>`, complete the generated
   verification and risk sections, then commit on the Scope branch.

## Integrate completed Scope work

From `new/` on `integration/nexyfab`:

1. Run `npm run workspace:integration-status` and inspect the Scope handoff.
2. Merge one Scope branch at a time with `git merge --no-ff scope/<name>`.
3. Run `npm run workspace:audit`, `npm run platform:architecture:check`, and the
   checks named by the merged handoff.
4. Fast-forward each clean Scope branch to the validated integration head before
   starting its next task.

`releaseGates` in the registry remain fail-closed release evidence checks. They
may be pending during ordinary development, but must never be reported as passed
without their required external evidence.
