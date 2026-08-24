# Precision CAD decisions

- 2026-08-23: Precision CAD spans engineering disciplines; domain implementations remain under `domains/` and communicate through shared contracts.
- 2026-08-24: The isolated single-part readiness contract binds to the shipping `occt-exact` and `job-orchestrator` identities and verifies dependency tokens with side-effect-free contract-rejection canaries. Integration-owned security, CI, and root-runtime remediations are tracked in `INTEGRATION_ACTIONS.md`.
- 2026-08-24: Shape Generator keeps one explicit Client boundary while its `next/dynamic` component registry lives in `_shell/lazyShapeGeneratorComponents.tsx`; stateful behavior continues moving into focused hooks with direct tests.
