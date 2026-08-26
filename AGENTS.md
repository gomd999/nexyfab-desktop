<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nexyfab-workspace-rules -->

# NexyFab workspace routing

This repository uses three persistent scope branches. At the start of a coding
session, run `git branch --show-current` and load the matching workspace files:

- `scope/platform` -> `workspaces/platform/AGENTS.md` and `CURRENT.md`
- `scope/precision-cad` -> `workspaces/precision-cad/AGENTS.md` and `CURRENT.md`
- `scope/ai-design` -> `workspaces/ai-design/AGENTS.md` and `CURRENT.md`
- `integration/nexyfab` -> integration and verification only

Run `npm run workspace:check -- <scope-id>` before handing off scope work.
Before starting a Scope session, run
`npm run workspace:sync -- <scope-id> --apply`; it only fast-forwards a clean,
behind worktree and refuses dirty, ahead, or diverged branches. The
`integration/nexyfab` branch is the canonical editable integration line and
`release/web-public-2026-08-26` is a deploy-only mirror. Never implement a fix
only on the release branch. Run `npm run workspace:sync:check` before a release.
Shared paths in `workspaces/registry.json` are integration-owned and must not be
changed from a scope branch without an explicit integration decision.

<!-- END:nexyfab-workspace-rules -->
