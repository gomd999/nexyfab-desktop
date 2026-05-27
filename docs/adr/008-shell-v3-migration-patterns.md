# 008 — Four migration patterns for shell-v3 panel wiring

**Status:** accepted
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P2 (docs; captures conventions used in ADR-006 work)

## Context

ADR-006 + the 2026-05-27 reality survey planned the shell-v3 migration
in 6 phases (A-G). Executing Phases B-F in W6 Day 1 surfaced four
distinct wiring patterns. Each fits a different category of widget /
data ownership, and choosing the wrong one creates churn:

- The Bodies-tab work (commit 8265b64) reached for the bridge by
  default because that's how the Features-tab template worked. Halfway
  through the UserParts work (commit 2d8ced8) it became obvious
  localStorage-backed data shouldn't pass through the bridge at all.
- The Inspector ANALYZE rows (no commit — already wired) used pure
  events without any state at all, simpler than expected.
- The Render / Sketch / Drawing knobs (commits 08d1140, 276daf3,
  050d0ad) needed UI-responsive state without renderer/engine wiring,
  so a hybrid local-plus-event pattern emerged.

Documenting all four now so the remaining Wave 1 work (Phase G dead-
code removal) and Wave 2+ panel additions don't re-derive these.

## The four patterns

### Pattern 1 — Bridge

**Use when:** Inner.tsx (or another shared store) owns the
source-of-truth mutable state for the widget.

**Shape:**
1. Add `ShellXxxItem` type + `xxxItems[]` + `setXxxItems()` to
   `_shell/shellBridgeStore.ts`.
2. Pane reads via `useShellBridge(s => s.xxxItems)`. On user action,
   dispatches a `CustomEvent('nexyfab:xxx-action', { detail })`.
3. Inner.tsx `useEffect` publishes its source state to
   `bridgeXxxItems(transformed)`. A second `useEffect` listens for
   the action events and calls Inner's existing setters.
4. No setter exposure across the shell/Inner boundary — pane writes
   nothing directly, just emits events.

**Used by:** Bodies tab (`ShellBodyItem`, commit 8265b64),
Material chip (`materialId`, commit fe791f4), Assembly mates
(`assemblyMatesList`, commit 9c78022).

### Pattern 2 — Direct read

**Use when:** the data lives in `localStorage`, a static catalog, or
otherwise outside Inner's render tree.

**Shape:**
1. Pane imports the catalog / store loader directly. Example:
   `import { loadUserParts } from '../../library/userPartsStore'`.
2. `useEffect` runs the loader on mount and again on `storage` /
   custom refresh events.
3. User actions still dispatch `CustomEvent` so Inner can react
   (e.g. open the management modal).

**Used by:** UserParts section (commit 2d8ced8), StandardPartsGrid
(pre-existing).

**Anti-pattern:** routing localStorage through the bridge adds
indirection for no benefit; you lose the storage-event listener
(cross-tab sync) and gain nothing.

### Pattern 3 — Event-only

**Use when:** the widget is a pure trigger — it has no read state of
its own, just an action to dispatch.

**Shape:**
1. Pane component renders a button or row.
2. `onClick` dispatches `CustomEvent('nexyfab:xxx', { detail })`.
3. A higher-level component (ModelerShell, Inner) listens and routes
   the action to the relevant subsystem.

**Used by:** Inspector ANALYZE rows (DFM / FEA / Cost / Variants /
Motion drawer triggers). Already wired pre-Wave-1.

### Pattern 4 — Local + event

**Use when:** the widget needs immediate UI responsiveness but the
backend wiring (renderer, sketch solver, drawing emitter) doesn't
exist yet. UI is functional today; integration is deferred polish.

**Shape:**
1. `useState` per knob in the pane, defaults match the mockup so the
   pane looks alive at zero-config.
2. `emitXxxSet(key, value)` helper dispatches
   `CustomEvent('nexyfab:set-xxx', { detail: { key, value } })`.
3. Inner (or a future bridge) can subscribe to the event later
   without the pane changing.

**Used by:** RenderRightPane 7 knobs (commit 08d1140), SketchRightPane
8 knobs (commit 276daf3), DrawingRightPane 5 + 3 knobs (commit
050d0ad).

**Trade-off:** if two panes need to read each other's local state, the
pattern breaks — promote to bridge. Today no such cross-pane read
exists.

## Decision rule

When adding a new widget to a shell-v3 panel, pick by data ownership:

```
Is the data localStorage / static catalog?
  YES → Pattern 2 (Direct read)
  NO ↓
Does Inner / sceneStore / a shared store own the state today?
  YES → Pattern 1 (Bridge)
  NO ↓
Is the widget a pure action trigger (no read state)?
  YES → Pattern 3 (Event-only)
  NO → Pattern 4 (Local + event)
```

The pre-W6 ad-hoc choice was "always Pattern 1" because that's how the
Features tab was wired. Following this decision rule would have saved
two re-derivations during W6.

## Consequences

### Positive

- Future panel additions (Wave 2 polish, Phase G integrations) pick
  the right pattern in 5 seconds instead of working through 3 wrong
  shapes first.
- Reviewers can flag mis-pattern PRs ("you used Bridge for a
  localStorage source — promote to Direct read") with a doc to cite.

### Negative

- Four patterns is more surface than one. New contributors have to
  read this doc instead of grepping for a single template. Mitigation:
  the decision rule above is small.

### Neutral

- The patterns themselves were emergent — no greenfield design. They
  match what worked in practice; alternatives weren't seriously
  considered because the constraints (one-way data flow, no shell-to-
  Inner setter sharing, cleanup-on-unmount) ruled out cross-cutting
  shapes early.

## Alternatives considered

- **Always Bridge** — rejected. localStorage + static catalog cases
  paid indirection cost for no benefit.
- **Always direct setter import** — rejected. Creates circular
  dependencies between `_shell/sidebars/*` and `ShapeGeneratorInner`.
  Shell-v3's whole point was to break that coupling.
- **Single mega-state store wrapping bridge + Inner** — rejected as
  speculative. The current bridge has 3 narrow shapes (features,
  bodies, materialId etc.); a mega-store would balloon.

## Rollout

- [x] Patterns documented here.
- [ ] Update `_shell/MIGRATION.md` to reference this ADR as the
  template for any future widget moved into v3.
- [ ] When Phase G dead-code removal lands, cite this ADR in the
  commit body so the rationale survives the diff.

## Reversal

This ADR is descriptive of code already shipped. Reversal would mean
deleting the four pattern commits (8265b64, 2d8ced8, fe791f4,
276daf3, 050d0ad, 08d1140, 9c78022) — see those commits for their
own reversal sections. Reverting the ADR alone is a no-op.

## References

- ADR-006 + addendum: `docs/adr/006-monolith-split-via-shell-v3-migration.md`
- Survey: `docs/strategy/shell-v3-migration-survey-2026-05-27.md`
- Migration map: `src/app/[lang]/shape-generator/_shell/MIGRATION.md`
- Pattern 1 commits: 8265b64, fe791f4, 9c78022
- Pattern 2 commit: 2d8ced8
- Pattern 3: pre-existing in InspectorTab / ModelerShell
- Pattern 4 commits: 08d1140, 276daf3, 050d0ad
