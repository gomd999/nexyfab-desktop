# 012 — Wire CRDT into the production editor and add direct edit as a second modeling modality (Wave 2 Phase 3)

**Status:** accepted
**Date:** 2026-05-28
**Author:** wave-2 phase-3 architecture
**Risk tier:** P0 (CRDT integration is the load-bearing decision of Wave 2; direct edit is a second-modality bet on the same B-Rep substrate)
**Supersedes:** none
**Superseded by:** none
**Related:**
- ADR-010 (Wave 2 = B-Full + collab; 12-month Onshape-parity target; $53–122K budget envelope) — operationalises the Phase 3 scope ADR-010 committed.
- ADR-011 (`docs/adr/011-crdt-architecture-and-phase-2-scope.md`) — CRDT Y.Doc shape locked; Phase 2 scope (consolidation, not greenfield). This ADR extends ADR-011 §2 to Phase 3.
- `docs/wave-2-crdt-architecture.md` (1,105-line design spike) — the architecture this ADR consumes.
- `docs/wave-2-phase-2-master-task-tracker.md` — Phase 2 (the five modeling features being wired here).
- `docs/wave-2-phase-3-master-task-tracker.md` — the operational complement to this ADR.
- `docs/wave-2-phase-2-configurations-spec.md` (A5 already ships Y.Map-backed ConfigStore)
- `docs/wave-2-phase-2-reference-geometry-spec.md` (D3b ref-geom CRDT subtree is Phase 3 Z4)
- `docs/wave-2-soak-runbook.md` — Q1 burn-in procedure.
- `docs/wave-1-compat-matrix.md` — Q1 STEP round-trip target.
- `docs/wave-2-cad-advisor-jd.md` — CAD-domain QA capacity that this ADR assumes for Q1.

---

## Context

ADR-010 committed Wave 2 to a 12-month horizon split across five phases:
Phase 1 (CRDT spike + primitives), Phase 2 (commercial-CAD parity
modeling features), **Phase 3 (CRDT 전체 통합 + Direct edit)**, Phase 4
(AI / CAM / FEA), Phase 5 (polish + go-to-market). Phase 1 closed with
a working CRDT prototype: `sketchYjs.ts` (725 LoC), `featureTreeYjs.ts`
(615 LoC), `offlinePersistence.ts` (137 LoC), `useOfflineSync.ts`
(162 LoC), `AwarenessCursors.tsx`, `AwarenessPresencePanel.tsx`, 161
green tests, and the `occt-collab-worker/` Cloudflare Worker + Durable
Object scaffolded behind PR #35 (not yet deployed). Phase 2 closed with
five modeling features at commercial-CAD parity (sheet metal, hole
wizard, threads, ref-geom, configurations) and one CRDT subtree wired
end-to-end (configurations, via A5 in Phase 2 W5).

The shape of Phase 3 work is then **two parallel deliverables on top of
the Phase 1-2 substrate**:

1. **CRDT integration:** the Phase 1 primitives are CRDT data structures
   in isolation — the production editor still uses `React.useState`
   for sketch entities and `Map<string, HistoryNode>` for the feature
   tree. Phase 3 replaces the local state with Y.Doc-backed state
   behind a `?crdt=v2` feature flag. The integration touches three
   subtrees: sketches (Y.Map keyed by sketchId), feature tree (Y.Array
   of Y.Map nodes), and ref-geom (Y.Map keyed by ReferenceNode id).
   Configurations is already wired (A5 Phase 2 W5). The Yjs Provider
   in the host component is the foundation; everything else hangs off
   it.
2. **Direct edit:** a SolidWorks-style synchronous direct-modeling
   layer that operates on the *current resolved B-Rep* — face picks,
   push/pull math, fillet/chamfer dynamic, body-level booleans —
   without modifying the parametric tree. Direct edits compose at the
   geometry level, not the history level. They are a **session-only
   stack** by default; an opt-in "Promote direct edits to history"
   button flushes the stack into parametric feature-tree nodes (the
   E5 work in the tracker).

A second piece of context — **the editor latency contract is now P0**.
Sketch-entity insertion and feature-tree reorder are the highest-touch
editor operations. Phase 2 measured both at p95 ≤ 16ms (sketch entity
add) and ≤ 50ms (feature tree reorder) in single-user mode. Phase 3's
job is to preserve those budgets after the CRDT envelope adds ~30%
encoding overhead per write (architecture §5.1). The performance
budgets baked into Phase 3 acceptance gates (§8 below) are
non-negotiable; if the CRDT overhead pushes either past 1.5× the
single-user budget, the reversal path in ADR-011 §Reversal B is
invoked.

A third piece of context — **awareness scope is bounded narrowly**.
Wave 2 collab UX competes against Onshape's "see your teammate's
camera position in 3D" demo. We have explicit room in our roadmap
(P5) to ship that, but it's not Phase 3 work. Phase 3 awareness ships
in sketch + feature-tree + modal-form scope only; the 3D viewport
camera-position broadcast is deferred. The reason is mechanical: the
3D viewport touches every render frame at 60Hz; awareness broadcasts
at that frequency saturate Durable Object CPU budget for trivial UX
gain (peers rarely look at the same camera position simultaneously).
Phase 3 ships the awareness that *matters for collaborative editing*,
not the awareness that *looks impressive in a demo*.

A fourth piece of context — **direct edit's relationship to parametric
history is a load-bearing decision and easy to get wrong**. The naive
approach ("direct edits become permanent feature-tree nodes
immediately") was rejected because it produces a corrupt parametric
tree whenever the user re-runs history from an earlier point (the
direct-edit nodes assume a specific resolved geometry; re-running
history changes that geometry; the direct-edit nodes silently apply
to the wrong B-Rep). The opposite ("direct edits never touch history")
loses user work on session close. The compromise — session-only stack
with opt-in flush — is what this ADR locks. Decision §6 has the full
treatment.

---

## Decision

We adopt the **CRDT-wired editor** as the production editing layer of
NexyFab Wave 2 from Phase 3 onward, behind a `?crdt=v2` feature flag
default-OFF until W11 burn-in clears. The integration uses the Phase 1
Y.Doc shape (Y.Map per sketch + Y.Array<Y.Map> feature tree + Y.Map
configurations + new Y.Map ref-geom subtree) under one top-level Y.Doc
per `.nfab` document, transported over Cloudflare Durable Objects via
WebSocket on `wss://collab.nexyfab.com` with BroadcastChannel for
local multi-tab and y-indexeddb for offline persistence. Awareness
ships in sketch + feature-tree + modal-form scope (NOT the 3D
viewport). Branching is fork-on-write per-doc, named, with manual
merge only (no auto-merge UI in Phase 3). Permissions enforce on the
server with 404-not-403 anti-enumeration; client trusts the server
response.

We adopt **direct edit** as a second modeling modality behind a
`?direct-edit=v1` feature flag default-OFF until W11 burn-in clears.
Direct edits are a session-only stack stored in a Y.Doc subtree
(`directEdits` Y.Array). The stack does not persist on file save (the
parametric tree is the only persisted modeling state); it is dropped
on session close unless the user clicks "Commit to history" (E5),
which flushes each stack entry into a parametric feature-tree node and
clears the stack. Re-running history from earlier in the tree
invalidates the stack (the resolved geometry the stack assumes has
changed); the user is warned and the stack is dropped.

Both flags graduate to default-ON in a separate follow-up PR after the
W12 exit gate clears, not in the Phase 3 close PR itself.

### Detailed sub-decisions

1. **CRDT topology for the editor — confirmed Y.Doc-per-document.**
   Per ADR-011 §2, each `.nfab` project maps to one `Y.Doc` with
   top-level keys per architecture §2.1: `tree`, `sketches`, `bodies`,
   `bodyOrder`, `assembly`, `mates`, `scene`, `manufacturing`, `meta`,
   `configurations`, `aiHistory`. Phase 3 adds `referenceGeometry`
   (Y.Map keyed by ReferenceNode id) and `directEdits` (Y.Array of
   direct-edit ops, **session-only**, dropped on save) to that list.
   The three integration weeks (Z2 sketch, Z3 tree, Z4 ref-geom) each
   wire one subtree to the corresponding React surface; configurations
   is already wired via A5 Phase 2 W5. Sub-decision §1 confirms that
   we do NOT split the Y.Doc into per-subtree separate Y.Docs — the
   single-Y.Doc model is what the test suite validates (161 tests
   green) and what the offline persistence layer expects (one
   IndexedDB row per doc id).

2. **Transport — WebSocket to occt-collab-worker (Cloudflare DO).**
   The production transport is `wss://collab.nexyfab.com`, hosted by
   the Cloudflare Worker + Durable Object scaffolded in PR #35. The
   worker uses `y-websocket` for sync + awareness frames, with KV
   snapshots every 30s and 30-minute idle eviction (architecture §3.2).
   BroadcastChannel handles **local multi-tab** (peers in the same
   browser sync to each other without round-tripping the DO).
   y-indexeddb handles **offline persistence** (the Y.Doc persists to
   IndexedDB on every transact; on reload it rehydrates from
   IndexedDB and then catches up via WebSocket if online). The three
   transport layers are stacked: writes go to all three; reads come
   from the local Y.Doc which is the merge of all three sources. The
   Z1 deliverable (W1) wires all three layers. Sub-decision §2
   confirms that we do NOT roll our own WebSocket transport — the
   `y-websocket` reference implementation is the load-bearing piece
   architecture §3.2 priced into the budget.

3. **Awareness scope — sketch + feature tree + modal forms; NOT 3D
   viewport.** Phase 3 awareness ships in three places: (a) **sketch
   canvas** — peer cursors with peer username badge + peer selection
   highlight (selected segments / constraints / dimensions outlined
   in peer color); (b) **feature tree** — peer-pinned active node
   shown by a colored side-strip on the row; (c) **modal forms** —
   peer-edited input field shown by a colored border + peer username
   tooltip. Awareness is NOT in the **3D viewport** — peer camera
   position broadcast is a P5 deliverable per §12 of the tracker.
   Awareness color palette is 8 colors, color-blind-safe, assigned
   deterministically from a hash of the user id (so the same peer is
   the same color across sessions). Awareness propagation budget
   p95 ≤ 200ms. Sub-decision §3 confirms that 3D-viewport awareness
   is the **single largest deferred Phase 3 item** and is captured in
   tracker §12 explicitly. The reason: 3D viewport touches every
   render frame at 60Hz; broadcasting camera position at 60Hz to N
   peers via Durable Object saturates DO CPU budget for marginal UX
   gain.

4. **Branching model — per-doc, named, fork-on-write; manual merge
   only.** A user clicks "Create branch" on a document; the system
   clones the entire Y.Doc into a new doc-id with `parentBranchId`
   metadata. Branches are listed in a per-doc branches panel. Branch
   switch loads the new doc-id (the editor unmounts the current
   Y.Doc, mounts the new one). Branch merge is **manual only in Phase
   3** — the user views a diff between branches and chooses which
   changes to bring forward, typically by re-doing the edit on the
   target branch (no auto-merge UI). Reason: CRDT auto-merge across
   forked Y.Docs is a research-grade problem (each Y.Doc is a separate
   replica set after fork; merging requires either op-replay across
   forks or a custom 3-way merge UI, both of which exceed Phase 3
   capacity). Sub-decision §4 acknowledges that "branches without
   auto-merge" is a degraded version of branching; the value
   proposition in Phase 3 is "safely explore a design alternative
   without breaking the master branch," not "merge branches like git."
   Auto-merge UI lands in Phase 4 or Wave 3 candidate per tracker §12.

5. **Permissions enforcement — server-side, 404-not-403 anti-
   enumeration.** Per ADR-011 §2.4, the server enforces permissions
   on every WebSocket connection: a peer attempting to connect to a
   doc-id they don't have permission to access receives a **404
   response**, not a 403 (the 403 would leak the doc's existence).
   Read/write gates apply: doc-perm > workspace-perm. A user with
   "viewer" role on a workspace but "editor" on a specific doc gets
   editor access. A user with "editor" role on a workspace but
   "viewer" override on a specific doc gets viewer access. Roles are
   three-tier: owner (full control + delete), editor (read + write),
   viewer (read only). Sub-decision §5 confirms that the **client
   trusts the server's response** — there is no client-side check that
   could be bypassed by a malicious peer. The Z8 deliverable (W8)
   wires the UI; the server-side enforcement is a precondition (if
   the server is not ready, Risk R-6 path applies — ship Phase 3
   client-side-display-only, server-enforcement → Phase 4 mandatory).

6. **Direct edit semantics — session-only stack with opt-in
   commit-to-history.** Direct edits are a Y.Array stored under the
   Y.Doc key `directEdits`. Each entry is `{op: 'pushPull' | 'fillet'
   | 'chamfer' | 'moveBody' | 'rotateBody' | 'subtractBody', faceIds:
   string[], params: ..., timestamp: number, userId: string}`. The
   editor applies the stack on top of the parametric pipeline output
   during the current session (the resolved B-Rep at the active
   history node, with each direct edit applied in order). The stack
   is **NOT persisted on save** — the `nfabFormat.serializeProject`
   call drops the `directEdits` subtree. This is the load-bearing
   decision and is locked here:

   - **Why session-only by default:** the parametric tree is the
     canonical modeling state. Persisting direct edits as a
     "shadow stack" creates two sources of truth (the parametric
     tree and the direct-edit stack); reconciling them on file open
     requires re-applying every direct edit to the resolved
     geometry, which fails if the parametric tree has changed since
     the stack was recorded.
   - **Why opt-in commit-to-history:** users sometimes want direct
     edits to be permanent (e.g., "I push-pulled this face to round
     it, and I want that to be part of the part's history forever").
     The opt-in flush handles this: each stack entry becomes one
     feature-tree node of type `DirectEditPushPull` (or `Fillet`,
     etc.), the stack clears, and the parametric pipeline regenerates
     with the new tree. The user reviews the resulting tree before
     committing.
   - **Why invalidate on history-rerun:** if the user re-runs the
     parametric tree from earlier than where the stack was recorded,
     the resolved geometry the stack assumes has changed. The stack
     entries reference face-ids that may no longer exist or may
     reference different faces. The system detects this (compare the
     resolved B-Rep face-id set at stack-record time to current
     resolved B-Rep face-id set) and drops the stack with a warning
     toast: "Your direct edits were invalidated by a history change."
   - **Why not persist + re-apply on open:** considered and rejected.
     Re-applying direct edits across `.nfab` save / open boundaries
     hits the same invalidation problem as history-rerun but without
     the user being aware. A file saved on one machine, opened on
     another with a slightly different OCCT version, might
     re-resolve face-ids differently and silently apply direct edits
     to the wrong faces. Session-only avoids this entire class of
     bug.

   Sub-decision §6 also confirms that direct edits do NOT participate
   in CRDT collab in Phase 3 — peers do not see each other's
   session-only direct-edit stacks. The `directEdits` subtree is
   stored in Y.Doc for offline-persistence convenience (rehydrate the
   stack on tab reload within the same session) and for the E5
   commit-to-history path, but it is per-user (each peer has their
   own stack, broadcast through awareness if at all, not through
   shared Y.Doc data). Collab direct edit is tracker §12 Wave 3
   candidate.

7. **Conflict resolution UI — none; LWW deterministic with non-
   blocking toast.** When two peers concurrently perform the same
   operation on the same entity (e.g., both fillet the same edge),
   Yjs LWW (last-write-wins) deterministically converges to one of
   the two ops. The loser's UI receives the convergence update and
   the loser sees a **non-blocking toast** ("Your fillet was
   overridden by @peer"). No manual-resolve UI is shipped in Phase 3
   — LWW is the policy, and the policy is consistent across the
   entire app (Yjs default). Sub-decision §7 acknowledges that this
   is less rich than a Figma-style "Your changes vs theirs — pick
   one" UI; the cost-benefit at Phase 3 capacity does not justify
   building it. If user research after Phase 3 shows manual-resolve
   is needed, it's a Phase 4 / Wave 3 candidate.

8. **Performance budgets — per-op latency targets.** Phase 3
   acceptance gates require:
   - **Sketch entity add** p95 ≤ 16ms (per-keystroke target; Phase 2
     baseline).
   - **Feature tree reorder** p95 ≤ 50ms (drag-drop in tree; Phase 2
     baseline).
   - **Direct-edit push-pull preview** p95 ≤ 30ms (live drag).
   - **Awareness propagation** p95 ≤ 200ms (peer cursor lag).
   - **Y.Doc snapshot encode (50 sketches × 200 segments + 500
     features)** ≤ 5MB in-memory.
   - **Sync RTT** p95 ≤ 200ms between peers on same continent;
     ≤ 500ms cross-continent.
   - **Branch create** ≤ 2s on 5MB Y.Doc.
   - **CRDT-induced perf regression vs single-user baseline** ≤ 50%
     on any of the above (architecture §5.1 noted ~30% encoding
     overhead; we budget 50% to absorb runtime cost on top of
     encoding).
   Sub-decision §8 ties each budget to a fixture in the Q1 burn-in
   (`docs/wave-2-soak-runbook.md` extension). Failing any single
   budget triggers Phase 3.5 buffer.

9. **Reversal — flag-gated, default-OFF, graduates after W11 burn-
   in.** Both `?crdt=v2` and `?direct-edit=v1` ship default-OFF
   throughout Phase 3. The W11 burn-in is the gate that determines
   graduation. If burn-in is clean (0 unhandled crashes, < 2 edit-
   lost incidents in 3-user × 3-hour soak, all perf budgets green),
   the flags graduate to default-ON in a follow-up PR (separate from
   the Phase 3 close PR; deliberately separated to keep the close PR
   at low risk). If burn-in is dirty, the flags stay default-OFF and
   the dirty subset enters Phase 3.5 buffer for fix. If burn-in
   reveals corruption (any edit-lost incident, any CRDT divergence
   that doesn't heal in ≤ 10s), invoke ADR-011 Reversal B (flip
   `?crdt=*` off in production, keep the codebase but disabled,
   debug post-mortem). Direct-edit reversal is independent —
   `?direct-edit=v1` can stay default-OFF without affecting CRDT
   graduation.

10. **Out of scope for Phase 3 — AI / CAM / FEA (Phase 4); mobile
    (Phase 5 or Year 2); Plugin SDK (Year 2).** Per ADR-010 phase
    structure. The boundary is firm: any task that fits in
    "modeling collab" or "direct editing modality" is Phase 3; any
    task in "AI assists the designer" or "manufacturing prep" or
    "FEA analysis" is Phase 4. Specifically:
    - AI features (NL → CAD, design-assist, generative design) →
      Phase 4. Not Phase 3 even if conceptually related to direct
      edit (AI-assisted direct edit is Wave 3 candidate).
    - CAM export beyond what Phase 2 ships → Phase 4.
    - FEA pre-processor / mesh / boundary conditions → Phase 4.
    - Mobile / tablet UX → Phase 5 candidate or Year 2.
    - Plugin SDK (3rd-party apps consume the Y.Doc) → Year 2.
    - Wave 3 candidates (auto-merge UI, collab direct edit, native
      B-Rep face-pick if Risk R-4 triggers, sub-cell direct edit) →
      tracker §12.

    Sub-decision §10 is the explicit boundary because each of these
    has been raised at some point in Phase 1-2 planning as
    "could we squeeze this in?" The answer for Phase 3 is no.

---

## Consequences

### Positive

- **CRDT-first commitment from ADR-010 is operationalised in
  production.** Phase 1 had the primitives; Phase 2 had the
  modeling features; Phase 3 makes them composable in the editor.
  After Phase 3, every modeling feature shipped from Phase 4 onward
  composes cleanly with multi-user editing — no retrofit tax on AI /
  CAM / FEA work in Phase 4.
- **Direct edit ships as a second modality with bounded risk.** The
  session-only stack design means direct edit cannot corrupt the
  parametric tree by accident; the worst-case (E5 commit-to-history
  fails) is a UX degradation (user must rebuild direct edits in
  parametric form), not data loss.
- **Awareness scope is bounded narrowly, preserving Durable Object
  cost envelope.** Architecture §3.2 priced DO cost at < $0.10 /
  active doc / day. 3D-viewport camera-position broadcast would push
  that to $1-5 / active doc / day (60Hz broadcast × N peers). Phase
  3's sketch + tree + form awareness scope is < $0.20 / doc / day
  at expected traffic.
- **Branching enables design exploration without master-branch risk.**
  Users can fork a doc, try a design alternative, discard the branch
  if it doesn't work. The deferred auto-merge UI is the one feature
  that "looks like git" but isn't; users will need workarounds
  (re-do the edit on master) for now. Acceptable trade.
- **Permissions ship with the right security posture from day one.**
  404-not-403 anti-enumeration, server-side enforcement, trust the
  server. No client-side bypass surface. Phase 4's 2FA / SSO work
  layers on top of a working permission model.
- **Perf budgets enforced via Q1 burn-in fixture.** Phase 3 cannot
  exit on a regressed perf profile. If CRDT overhead pushes sketch
  entity add past 24ms (16ms × 1.5), the flag stays default-OFF and
  Phase 3.5 absorbs the perf fix.
- **Direct-edit semantics rule out the corruption class.** The
  session-only-with-opt-in-flush design closes the "direct edit
  silently applied to wrong geometry" bug class. Compare to
  SolidWorks (mixes direct + parametric in a way that bites users on
  history rerun) — NexyFab's explicit invalidate-on-rerun is a
  cleaner UX.
- **161-test Phase 1 prototype's risky assumptions are validated by
  Phase 2 W5 production wire-up** (A5 configurations subtree
  end-to-end). Phase 3 extends a pattern that's proven in production
  for one subtree to two more (sketches + tree). The risk of "CRDT
  doesn't work in production" is retired by Phase 2 A5 evidence.

### Negative

- **12-week budget is 94% utilised against 360h capacity.** Slack
  is real (~20h) but small. Any unforeseen blocker (Wave 1 task #31
  closure timing, OCCT face-id binding fragility, permissions
  server-side endpoint not ready by W8) consumes slack fast. Phase
  3.5 buffer (2 weeks) is the planned absorber.
- **Branching without auto-merge ships a half-feature.** Users will
  see "Create branch" and reasonably expect "Merge branch" — Phase 3
  ships only the "view diff + manually replicate" path. UX writing
  has to manage the expectation gap clearly.
- **Direct edit operates on a degraded face-pick model in the worst
  case.** If E1's OCCT B-Rep face-id correspondence fails on > 20%
  of test geometries (Risk R-4), the fallback is mesh-level direct
  edit — pick on the rendered mesh face, OCCT reconstructs the B-Rep
  operation. This is degraded UX (the face-pick is less precise on
  curved surfaces) and may need rework in Wave 3.
- **No 3D-viewport awareness in Phase 3.** A class of customer demo
  ("look, you can see my teammate's camera!") is not available
  until P5. Sales / GTM messaging has to set the expectation
  ("collaborative modeling, with the camera-sharing-in-3D demo
  coming in late Wave 2 / early Wave 3").
- **CRDT 30% encoding overhead is real and persistent.** Sketches
  encode ~55KB Yjs vs ~32KB JSON; feature trees similar. For very
  large files (50+ sketches × 200+ segments + 500+ features + 50+
  bodies + 200+ mates) the in-memory Y.Doc sits at ~5MB. Within
  budget but not free; memory pressure may surface in Wave 3 on
  enterprise customer files (10x larger).
- **Direct-edit stack drop on save is a user-visible UX choice that
  some users will dislike.** Customers from a CATIA / NX background
  expect direct edits to persist. The opt-in flush is documented
  prominently; the first onboarding tour step covers it.
- **Yjs 1.x pin from ADR-011 §1 is now 6 months into the migration;
  upstream security CVE risk grows.** The CVE backport budget from
  ADR-011 (one iteration) is consumed by Phase 3 if any 1.x CVE
  ships during W1-W12. If two 1.x CVEs ship, Phase 3.5 absorbs the
  second.

### Neutral

- **Phase 3 close is two artifacts (this ADR + the tracker) plus the
  W12 exit memo.** The exit memo (`docs/wave-2-phase-3-exit.md`)
  records actuals vs estimates and triggers either Phase 4 entry or
  Phase 3.5 buffer. Same structure as Phase 2 exit (W8 gate per
  Phase 2 tracker §7).
- **Configurations CRDT subtree (A5 Phase 2 W5) is now the
  canonical reference for Phase 3 integration.** The Z2 / Z3 / Z4
  integration weeks follow the A5 pattern: introduce the hook,
  wire it under a flag, run a divergence test, run a soak. Phase 3
  is fundamentally "do for sketches + tree + ref-geom what A5 did
  for configurations, on a tighter timeline because the pattern is
  known."
- **Wave 1 GA gate evidence procedure preserved unchanged.**
  `docs/wave-2-soak-runbook.md` (542 LoC) and `docs/wave-1-compat-
  matrix.md` (450 LoC) are the Q1 burn-in canonicals; Phase 3
  extends them with CRDT-specific fixtures (F-Z-01..05 and
  F-DE-01..05) but does not modify the existing procedure.
- **CAD advisor capacity from `docs/wave-2-cad-advisor-jd.md` is
  used for Q1 only.** Phase 3 direct-edit work doesn't need KS B
  0201-style numerics audit (that was Phase 2 threads / hole-wizard
  scope). The advisor reviews the burn-in fixture coverage for
  CAD-conventional sanity in W11.

---

## Alternatives considered

- **Per-subtree separate Y.Docs instead of single-Y.Doc.** Rejected.
  Phase 1 prototype + Phase 2 A5 production evidence both use
  single-Y.Doc; offline persistence layer expects one IndexedDB row
  per doc id; splitting would require parallel transport per
  subtree (3× WebSocket connections per peer per doc). The
  architecture §3.2 cost envelope assumes single-Y.Doc.
- **CRDT integration in Phase 4 instead of Phase 3** (i.e., flip
  Phase 3 = direct edit only, Phase 4 = CRDT integration). Rejected.
  ADR-010 commits Phase 3 to CRDT 전체 통합; Phase 4 is AI / CAM /
  FEA. Pushing CRDT into Phase 4 either cancels Phase 4 or breaks
  ADR-010. The Phase 1-2 evidence (161 tests + A5 production wire)
  says the integration is feasible in Phase 3; the failure mode is
  not "can it ship" but "what's the perf profile under load," which
  the W11 burn-in directly addresses.
- **Direct edit as a permanent first-class history feature (every
  direct edit becomes a feature-tree node immediately).** Rejected
  per Decision §6. Re-running history from earlier than the direct
  edit silently corrupts the parametric tree. The session-only-with-
  opt-in-flush design closes this bug class.
- **Direct edit persisted across save with re-apply on open.**
  Rejected per Decision §6. Cross-machine / cross-OCCT-version
  re-resolution of face-ids is too fragile. Session-only is the
  conservative choice.
- **3D-viewport peer-camera-broadcast in Phase 3.** Rejected per
  Decision §3. DO CPU cost at 60Hz × N peers saturates budget for
  marginal UX gain. Deferred to P5.
- **Auto-merge UI for branches in Phase 3.** Rejected per Decision
  §4. Research-grade problem; exceeds Phase 3 capacity. Manual-
  replicate is the Phase 3 workaround. Auto-merge → Phase 4 / Wave 3
  candidate.
- **Client-side permission enforcement (no server-side check).**
  Rejected per Decision §5. Security posture is non-negotiable;
  client-side checks are bypassable by malicious peers. If the
  server endpoint isn't ready by W8, the Risk R-6 fallback is
  "client-side display only" but with a clear Phase 4 mandatory
  follow-up.
- **Stronger conflict resolution UI (Figma-style "your changes vs
  theirs — pick one").** Rejected per Decision §7. Cost-benefit at
  Phase 3 capacity does not justify; LWW + non-blocking toast is
  the policy. Manual-resolve → Phase 4 candidate if user research
  demands it.
- **Yjs 2.x upgrade mid-Phase-3.** Rejected per ADR-011 §1 (Yjs 1.x
  pin holds through the migration). Yjs 2.x is not GA; pinning a
  moving target during the integration adds upstream-breakage risk
  the architecture explicitly flagged.

---

## Rollout

Phase 3 calendar: **Weeks 1–12 of Wave 2 Phase 3** (starting
2026-07-13 per Phase 2 close + 1-week handover; specific kickoff
date depends on Phase 2 exit memo). Each item is owned by the same
single-founder + Claude max-parallel pair as Phases 1-2. Acceptance
checkboxes mirror the tracker §3 weekly breakdown and gate criteria
at §7.

### Month 4 (W1-W4) — CRDT foundation + direct-edit start

- [ ] **W1 — Z1 Yjs Provider in host.** `useYDocProvider({docId})`
  hook in `ShapeGeneratorInner`. BroadcastChannel transport.
  y-indexeddb wire-up. WebSocket stub (worker live by EOD if Wave 1
  task #31 closes; otherwise local-only stub). Awareness scaffolding
  in place (no UI). 2-tab BroadcastChannel divergence test green.
- [ ] **W2 — Z2 Sketch editor CRDT integration.** Replace
  `useState<SketchSegment[]>` etc. in `SketchCanvas.tsx` with
  `useSketchYjs(docId, sketchId)`. Atomic op application via
  `applySketchOp`. Flag `?crdt=v2`. F-Z-01 (2-tab sketch divergence)
  green.
- [ ] **W3 — Z3 Feature tree CRDT integration + E1 direct-edit
  foundation.** Z3: replace `useFeatureStack`'s `Map<id, HistoryNode>`
  with `useFeatureTreeYjs(docId)`. Atomic addNode inside one
  `doc.transact()`. F-Z-02 (2-tab tree concurrent insert) green. E1:
  face-pick + push-pull math. Worker `/occt/op/direct/pushPull`.
  Flag `?direct-edit=v1`. F-DE-01 green.
- [ ] **W4 — Z4 Ref-geom CRDT subtree + E2 direct-edit fillet
  dynamic.** Z4: `ReferenceNode` storage in Y.Doc subtree. F-Z-03
  (2-peer ref-geom add) green. E2: face-pair pick → variable-radius
  fillet preview. Worker `/occt/op/direct/fillet`. F-DE-02 green.
- [ ] **Gate (W4 exit):** §7 mid-Phase-3 gate. Z1-Z4 + E1-E2 done;
  occt-collab-worker on `wss://collab.nexyfab.com`; awareness
  scaffolding wired; perf budgets within 1.5× single-user baseline.

### Month 5 (W5-W8) — Collab UX + direct-edit complete + permissions

- [ ] **W5 — Z5 Awareness UI + E3 direct-edit move/rotate body.**
  Z5: peer cursors in sketch canvas, peer-pinned active node in
  feature tree, peer-edited input-field highlight in modal forms.
  8-color color-blind-safe palette. NOT 3D viewport. E3: body-level
  transform with live drag. F-DE-03 green.
- [ ] **W6 — Z6 Branching + branches UI + E4 direct-edit boolean
  subtract.** Z6: per-doc branches, fork-on-write, named, list /
  create / switch / rename / delete UI. Manual merge only. F-Z-04
  (3-branch fork) green. E4: body B subtracted from A by face-pick.
  F-DE-04 green.
- [ ] **W7 — Z7 Activity feed + presence panel + E5 direct-edit
  commit-to-history.** Z7: per-doc op log (last 100 ops, Y.Array
  storage), presence panel (peer list + last-seen + current
  selection). E5: "Commit to history" button flushes session-only
  stack into N parametric feature-tree nodes. F-DE-05 (round-trip
  diff = 0) green.
- [ ] **W8 — Z8 Permissions UI + server-side enforcement.**
  Workspace-level (owner / editor / viewer) + doc-level override.
  Server returns 404-not-403 for unauthorized doc access. F-Z-05
  (perm denial test) green.
- [ ] **Gate (W8 exit):** §7 mid-Phase-3 gate. Z5-Z8 + E3-E5 done;
  permissions enforced server-side; perf budgets within Phase 3
  acceptance.

### Month 6 (W9-W12) — Polish + burn-in + exit gate

- [ ] **W9 — Track P heavy week.** End-to-end i18n sweep across Z +
  E new strings. JA / ZH / ES / AR translations land.
- [ ] **W10 — Track P.** Sentry breadcrumb tuning for CRDT + direct-
  edit failure channels. Perf-budget regression run on all §8
  budgets.
- [ ] **W11 — Q1 Full Wave 2 burn-in.** 3 users × full pipeline ×
  3-hour soak. 20 × 5 STEP round-trip matrix re-run. All Phase 2
  features regression-tested in `?crdt=v2` mode and `?direct-edit=v1`
  mode. Sentry < 5% failure rate on each `*.failure_rate` channel.
  Onboarding tour update for collab + direct-edit.
- [ ] **W12 — Q2 Phase 3 exit gate.** Green / Yellow / Red decision.
  4-page exit memo at `docs/wave-2-phase-3-exit.md`. Flag-graduation
  PR drafted (separate; not in this close PR).

### Cross-cutting (parallel throughout)

- **Daily standup** at `docs/wave-2-phase-3-standup.md` per tracker
  §10 template. Burn-out signals + CRDT health line per day.
- **CRDT envelope** for each new feature: tracker §3 weekly
  breakdown ties each task to its Y.Doc subtree.
- **Test coverage parity:** every fixture in F-Z-01..05 + F-DE-01..05
  has Vitest unit coverage; F-Z-01 / F-Z-02 / F-DE-01 / F-DE-05 also
  have Playwright E2E coverage.
- **Decision review:** after W11 burn-in ships, hold the architecture
  §7.4 "continue / pivot / reverse" checkpoint. Signals: sync RTT
  P95 < 200ms, doc size growth < 10× per week, ≤ 2 "edit lost"
  incidents per phase, solver re-run < 5Hz, DO cost < $0.10 / active
  doc / day.

### Decision review

**~2026-10-05** (Phase 3 close) — did we hit the 12-week budget on
two parallel deliverables (CRDT integration + direct edit)? Did the
perf budgets hold under CRDT envelope? Did burn-in clear without
edit-loss? Update this section with pass / pivot / reverse outcome
in the exit memo.

---

## Reversal

This decision has **two independent reversal paths**, one per major
sub-decision.

### Reversal A — CRDT integration fails W11 burn-in

If the W11 burn-in shows any of: > 2 "edit lost" incidents in 3-user
× 3-hour soak; CRDT divergence that doesn't heal in ≤ 10s; sketch /
tree / direct-edit p95 > 1.5× single-user baseline; sync RTT p95 >
500ms in any test region:

- **Yellow (small regression, fixable in 1-2 weeks):** Phase 3.5
  buffer absorbs. Flags `?crdt=v2` / `?direct-edit=v1` stay default-
  OFF. Fix lands at end of buffer. Re-run burn-in. Graduate flags
  if clean.
- **Red (corruption, structural perf cliff):** Invoke ADR-011
  Reversal B. Flip `?crdt=*` off in production. Keep the CRDT
  codebase but disabled. Direct-edit may still graduate
  independently (`?direct-edit=v1` does not require CRDT). Phase 4
  re-opens CRDT integration with deeper review.
- Cost: Yellow ~2 weeks; Red ~6 weeks (Phase 3.5 + Phase 4 entry
  reshuffle).
- Customer impact: Yellow zero (flags off, no UX change); Red
  zero (flags off, no UX change), but Phase 4 timeline shifts.

### Reversal B — Direct-edit fails W11 burn-in independent of CRDT

If F-DE-01..05 burn-in shows: any commit-to-history round-trip
diff > 0; any face-id mapping failure not handled by mesh-level
fallback; live-drag preview p95 > 60ms:

- Disable "Commit to history" button (E5). Direct edits stay
  session-only.
- If face-id mapping is fundamentally broken: ship Phase 3 with
  **mesh-level direct edit only** (degraded UX but works). Native
  B-Rep face-pick → Phase 4 / Wave 3 candidate.
- If live-drag perf is the issue: ship direct edit with "preview on
  release" mode instead of live drag (user sees preview after
  releasing the mouse, not during). Worse UX but acceptable.
- Cost: ~1 week to wire the degraded modes; no Phase 3.5 trigger if
  reversal A is clean.
- Customer impact: visible UX degradation in the worst case; flag
  `?direct-edit=v1` stays default-OFF, opt-in for early adopters.

Total reversal cost from end of Phase 3: ~2-6 weeks depending on
path. Acceptable ceiling per ADR-010 budget.

---

## References

### Code

- `src/app/[lang]/shape-generator/collab/sketchYjs.ts` — sketch CRDT
  shape per architecture §2.2; consumed by Z2 hook.
- `src/app/[lang]/shape-generator/collab/featureTreeYjs.ts` — feature
  tree CRDT per §2.4; consumed by Z3 hook.
- `src/app/[lang]/shape-generator/collab/offlinePersistence.ts` +
  `useOfflineSync.ts` — local persist + sync recovery; consumed by Z1.
- `src/app/[lang]/shape-generator/collab/AwarenessCursors.tsx` +
  `AwarenessPresencePanel.tsx` — Phase 1 awareness scaffolding;
  wired by Z5.
- `src/app/[lang]/shape-generator/collab/__tests__/` — 161 `it(...)`
  cases across 11 files, all green; the test foundation Z2/Z3/Z4
  extend.
- `src/app/[lang]/shape-generator/configurations/ConfigStore.ts` +
  `configStoreYjs.ts` — A5 Phase 2 W5 production wire; the canonical
  reference pattern for Phase 3 integration.
- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx` — host;
  Z1 wires the Yjs Provider here.
- `src/app/[lang]/shape-generator/sketch/SketchCanvas.tsx` — sketch
  surface; Z2 replaces local useState.
- `src/app/[lang]/shape-generator/useFeatureStack.ts` — feature tree
  hook; Z3 replaces internals while preserving public API.
- `src/app/[lang]/shape-generator/referenceGeometry/` — ref-geom
  Phase 2 module; Z4 adds Y.Doc subtree to existing data model.
- `occt-collab-worker/src/` — Cloudflare DO transport
  (`wss://collab.nexyfab.com`), KV snapshots, idle eviction. Deploy
  blocker per Wave 1 task #31.
- `src/app/[lang]/shape-generator/io/nfabFormat.ts` — schema; Phase
  3 does not bump version (the v3 envelope from Phase 2 stays). Save
  drops `directEdits` subtree per Decision §6.

### Docs

- `docs/wave-2-crdt-architecture.md` — full 1,105-line design, this
  ADR's foundation.
- `docs/wave-2-phase-2-master-task-tracker.md` — Phase 2 structure
  this tracker mirrors.
- `docs/wave-2-phase-3-master-task-tracker.md` — operational
  complement to this ADR.
- `docs/wave-2-phase-2-configurations-spec.md` (825 LoC) — A5
  shipped Y-backed ConfigStore; canonical reference pattern.
- `docs/wave-2-phase-2-reference-geometry-spec.md` (767 LoC) — D4
  Phase 2 shipped ref-geom module; D3b CRDT subtree is Phase 3 Z4.
- `docs/wave-2-phase-2-sheet-metal-spec.md` (1,014 LoC) — B5 Phase 2
  shipped Korean UI + bend table; CRDT integration via Z3 tree wire.
- `docs/wave-2-phase-2-hole-wizard-spec.md` (1,301 LoC) — C6 Phase 2
  shipped V2 flag flip; CRDT integration via Z3 tree wire.
- `docs/wave-2-phase-2-threads-spec.md` (921 LoC) — D8 Phase 2
  shipped drawing-callout prep; CRDT integration via Z3 tree wire.
- `docs/wave-2-soak-runbook.md` (542 LoC) — Q1 burn-in canonical;
  extended by F-Z-01..05 and F-DE-01..05 fixtures.
- `docs/wave-1-compat-matrix.md` (450 LoC) — 20 × 5 STEP gate;
  re-run target for Q1.
- `docs/wave-2-cad-advisor-jd.md` — CAD-domain QA capacity assumed
  by Q1 burn-in fixture review.
- `docs/adr/000-template.md` — template followed by this ADR.

### Prior decisions

- ADR-010 (Wave 2 = B-Full + collab; 12-month horizon; $53–122K
  cash envelope; Phase 3 = "CRDT 전체 통합 + Direct edit") —
  superset commitment this ADR operationalises.
- ADR-011 (CRDT Y.Doc shape + Phase 2 scope) — direct parent of
  this ADR; this ADR extends ADR-011 §2 to Phase 3 integration
  and adds direct-edit modality.

### External

- Yjs documentation: https://docs.yjs.dev/
- y-websocket reference implementation:
  https://github.com/yjs/y-websocket
- y-indexeddb reference:
  https://github.com/yjs/y-indexeddb
- Cloudflare Durable Objects docs (transport host).
- SolidWorks direct-edit (FeatureWorks) reference — UX pattern
  Phase 3 follows, with explicit invalidate-on-rerun improvement
  (Decision §6).

---

*End of ADR-012. Update the "Decision review" section at Phase 3
close with actuals vs. predicted consequences.*
