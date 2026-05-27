# 003 — Auto-init OCCT WASM kernel on shape-generator mount

**Status:** accepted
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P1 (UX default change; no API/code path change)

## Context

Wave 1 W3 (ADR-001) requires "OCCT 기본 ON + 자동 mesh-CSG 폴백" with
DoD "사용자 인지 없이 B-rep 발현" (users get B-rep without knowing).

Reading the code:

- **Mode flag** — `src/app/[lang]/shape-generator/features/occtEngine.ts:109-117`
  exposes `setOcctGlobalMode(on)` / `isOcctGlobalMode()`. The flag is
  consulted by every OCCT-capable feature (boolean, fillet, chamfer,
  pattern, mirror, loft, mold, hole — 10 files via grep) before it
  decides whether to use the OCCT path or the legacy mesh-CSG path.
- **Per-feature fallback** — each feature site does
  `if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) { try
  { ... } catch { /* fall through to mesh */ } }`. So **automatic
  mesh-CSG fallback already exists** at every OCCT call site; W3's
  "auto fallback" requirement is satisfied at the code level.
- **Store action** — `uiStore.ts:748-782` `setOcctMode(true)` triggers
  `ensureOcctReady()` (WASM kernel init, ~5 MB), then sets
  `occtMode=true`, `occtReady=true`. On failure: `occtMode=false`,
  `occtInitError=<msg>`.
- **UI toggle** — `panels/StatusFooter.tsx` renders a bottom-right pill
  ("OCCT: OFF" / "ON" / "..." / "OFF ⚠") that calls `setOcctMode(!occtMode)`.
  Visible only when `viewMode === 'workspace'`.
- **Initial state** — `uiStore.ts:434` ships `occtMode: false`. The
  WASM is never loaded until a user clicks the pill.

The gap: OCCT is fully wired, automatic fallback is fully wired, but the
WASM kernel never initializes unless the user discovers and clicks the
bottom-right pill. Effectively the entire B-rep work product is
opt-in via an obscure toggle.

## Decision

Auto-call `setOcctMode(true)` once per shape-generator mount when no
prior init has been attempted. Specifically: when
`occtMode === false && occtInitPending === false && occtInitError === null`.

Implementation: a `React.useEffect` in `ShapeGeneratorInner.tsx` right
after the occt-related store hooks (line ~1597 after this commit). The
guard prevents:
- Re-init loop (effect fires after `occtMode` flips true).
- Re-init after user explicitly disabled OCCT (`occtInitError` set means
  prior init failed; we keep the user's "off" state until they re-enable).

**We do not change the initial store state** (`occtMode: false`)
because that would lie about the ready state — features checking
`isOcctReady()` would see false until WASM actually loaded, and we don't
want the store to lead them on.

**We do not remove the StatusFooter pill.** Power users and devs need a
visible toggle to disable OCCT for A/B testing the mesh path. The pill
becomes a debug indicator post-W3, not a discovery surface.

## Consequences

### Positive

- Every shape-generator user gets B-rep features without any action.
  The recent Wave 0 B-rep work (Phase 1+2 — 15 primitives, sweep, loft,
  fillet, chamfer, pattern, mirror) becomes the default experience.
- STEP Route A (ADR-002) lights up by default — `exportToStepAsync`
  finds a real OCCT handle on most geometries instead of going through
  the mesh-bridge fallback every time.
- Existing fallback chain handles the failure mode: if the 5 MB WASM
  fails to download (network blocked, CDN issue), features silently
  use mesh-CSG. User sees `OFF ⚠` on the pill if they look.

### Negative

- **5 MB WASM eagerly downloaded** on every shape-generator visit.
  Acceptable because this route is the heavy-CAD page; landing /
  marketplace pages are unaffected. Browsers cache it after first load.
- **Init latency** — `ensureOcctReady()` takes ~2-5 s on first load.
  During that window, features fall back to mesh; the pill shows
  `OCCT: ...`. No user action needed; the upgrade is silent.
- **Telemetry signal loss** — until W3, "users on OCCT" was a manual
  opt-in metric (Wave 0 Sentry alert rule #1 baseline). Post-W3,
  essentially 100% of shape-generator users are on OCCT. The metric
  must be re-baselined; the rule #1 threshold (fallback rate > 1 %)
  becomes more meaningful, not less.

### Neutral

- StatusFooter pill remains. We may hide it behind a dev flag in a
  future ADR if it visually clutters the workspace footer.

## Alternatives considered

- **Set `occtMode: true` in initial store state** — rejected because it
  asserts ready state before WASM is loaded. Features would attempt
  OCCT calls before init completes; the try-catch fallback handles it,
  but the state lies. The auto-init effect is honest: pending → ready,
  observable by `occtInitPending`.
- **Lazy-init on first OCCT feature use** — rejected because the
  init blocks the user's first boolean/fillet for ~2-5 s. Eager init
  hides the cost behind page load (already includes other large JS).
- **Remove the StatusFooter pill entirely** — deferred. Power users
  may need to disable OCCT to A/B-compare against the mesh path during
  Wave 1 W4-5 viewer matrix work.

## Rollout

- [x] Add the `useEffect` to `ShapeGeneratorInner.tsx` after the
  `setOcctMode` hook.
- [x] Verify `tsc --noEmit` clean and lint clean.
- [ ] Manual smoke (next dev session): load shape-generator, watch the
  StatusFooter pill go `OFF → ... → ON` within 5 s on a fresh load.
- [ ] After PR #2 (this branch) merges, monitor Sentry rule #1 for the
  new fallback-rate baseline. Tune the alert threshold if needed.

## Reversal

`git revert <this commit>` removes the `useEffect`. OCCT goes back to
opt-in via the StatusFooter pill. No state schema change; no migration.

## References

- Code: `src/app/[lang]/shape-generator/features/occtEngine.ts:109`
- Code: `src/app/[lang]/shape-generator/store/uiStore.ts:748`
- Code: `src/app/[lang]/shape-generator/panels/StatusFooter.tsx`
- Code: `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx:1593`
- Linked ADRs: `001-marketplace-freeze-cad-focus.md`,
  `002-step-export-route-a-validation.md`
- Wave 0 Sentry alert rule #1: `docs/process/sentry-alert-rules.md`
