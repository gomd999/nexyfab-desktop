# Backend + Frontend Platform handoff: v150-artifact-trace-adoption

- Created: `2026-08-26T15:51:57Z`
- Branch: `scope/platform`
- Head: `19986c727bdf3b2c1be1af7179ffac1d68cd6e2c`
- Integration target: `integration/nexyfab`

## Summary

Selectively adopted the V150 reference gallery's strongest applicable pattern:
a compact, domain-native trace from generated design to governed artifact. The
existing three-row share tray and canvas-first split workspace remain intact.
Each result row now reports truthful generation-gate state and exposes actual
revision and SHA-256 bindings after generation.

This UI consumes a companion Precision CAD API contract at source commit
`384ee856a6c899a8b6cbeb09b7d009a682a72bfc`. The two scope commits must be
integrated together before release.

## Changed paths

- `src/components/nexyfab/ChatResultShareTray.tsx`
- `src/components/nexyfab/ChatResultShareTray.test.tsx`
- `docs/evidence/security/secret-scan-260810.json`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260826T155157Z-v150-artifact-trace-adoption.md`

## Verification

- [x] Focused chat, trust, i18n, and receipt regression: 4 files / 36 tests PASS.
- [x] The tray still exposes exactly three artifact rows with `GA_3D.html`
  first and default.
- [x] Six product locales are complete with no Hangul leakage in non-Korean
  copy, including the default and trace states.
- [x] Missing gate evidence renders `not run`; artifact identity never promotes
  a manufacturing-release claim.
- [x] `npm run lint:ci` — full source PASS (233.5s).
- [x] `npm run typecheck` — project TypeScript PASS (30.5s).
- [x] `npm run workspace:check -- platform`: ownership and classification
  clean with zero violations.
- [x] Current secret scan: 10,317 candidates / 325,466,130 bytes / zero
  findings.

## V150 decisions

- Adopted: conversation + artifact + trace, canvas-first result mode, explicit
  ready/running/error/review states, compact professional vocabulary.
- Already present: inline CAD results, persistent side-by-side 3D workspace,
  deterministic gate status, revision-bound STEP manifests, responsive result
  actions.
- Deferred: a mobile bottom sheet for result actions. The requested visible
  three rows remain more discoverable and now fit correctly in two lines.
- Rejected: importing the gallery's generic card catalog, decorative glow as
  product identity, fake agent timelines, or a parallel CAD shell disconnected
  from real project state.

## Remaining work and risks

- Integrate the companion Precision CAD API handoff before deployment so the
  GA row receives the same server-bound receipt as STEP and package outputs.
- Browser-level visual review remains required at the final integrated release
  head, including narrow mobile, Arabic RTL, and long translated strings.
- Manufacturing approval remains explicitly unavailable without the governed
  external qualification and signed G0-G9 evidence.
