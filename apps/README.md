# Backend + frontend platform

`apps/` is the stable target boundary for the NexyFab web application and core
API. The current runtime remains in the legacy root while migration proceeds in
small, compatibility-safe slices.

- `studio-web/` describes the frontend deployable unit.
- `core-api/` describes the backend API deployable unit.
- `workspaces/registry.json` remains the source of truth for file ownership.
- Cross-Scope data must pass through versioned contracts in `packages/`.

Do not move route trees in bulk. Each migration slice must retain its legacy
adapter, pass `npm run platform:architecture:check`, and have an explicit
rollback path before the old location is removed.
