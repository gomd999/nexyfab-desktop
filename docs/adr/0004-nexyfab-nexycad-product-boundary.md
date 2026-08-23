# ADR 0004: NexyFab and NEXYCAD product boundary

- Status: Accepted
- Date: 2026-08-16

## Decision

Keep NexyFab and NEXYCAD commercial as separate repositories and deployables while presenting one product journey.

NexyFab owns identity entry, organizations, plans, billing, orders, RFQ, suppliers, projects, spatial/AEC CAD, and top-level design-intent routing. NEXYCAD commercial owns mechanical Sketch, Part, Assembly, Drawing, Sheet Metal, STEP, Exact B-Rep, and mechanical AI planning/validation.

The mechanical implementation currently under NexyFab is migration/reference code, not the commercial mechanical source of truth. NexyFab platform and spatial/AEC development remain active.

## Integration

- No runtime source import, shared database, copied browser session, or shared release artifact between repositories.
- NexyFab rechecks verified-email interactive authentication, explicit organization context, and current project membership before issuing a handoff.
- The Ed25519 `nexysys.nexycad-handoff.v1` token lasts at most 60 seconds, is one-time, and carries only a pseudonymous user ID, project/organization scope, and project role.
- The token is passed in the Studio URL fragment so it is not sent in the initial HTTP request. Studio removes the fragment and exchanges it through its same-origin Core proxy.
- NEXYCAD collects and records its own current legal and AI/cloud processing acceptances. NexyFab acceptance is never silently reused.
- NEXYCAD creates project-scoped pseudonymous tenants, issues a revocable 15-minute session, and never grants federation users the independent `AI_REVIEWER` role.

## Migration rule

Do not copy the old mechanical tree wholesale. Move only reviewed behavior that is missing from NEXYCAD, through typed contracts, tests, provenance, and an explicit owner. Exact failure stays failed; it never falls back to mesh or the old mechanical runtime.

Route and production traffic cutover requires configured rotated keys, preview smoke evidence, rollback evidence, and a separately approved migration inventory. Until then, both current production behavior and manufacturing-authoritative NEXYCAD release status remain unchanged.
