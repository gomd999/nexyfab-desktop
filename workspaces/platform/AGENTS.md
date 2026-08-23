# Platform workspace

Own the backend and frontend platform that remains after Precision CAD and AI
Design paths are carved out by `workspaces/registry.json`.

- Work only on `scope/platform`.
- Treat shared paths as integration-owned.
- Do not edit Precision CAD or AI Design implementations directly.
- Use versioned contracts in `packages/` for cross-scope changes.
- Run `npm run workspace:check -- platform` before handoff.
- Update `CURRENT.md` and create an immutable file under `HANDOFFS/` at handoff.
