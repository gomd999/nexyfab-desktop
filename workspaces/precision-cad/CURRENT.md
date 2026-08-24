# Precision CAD current session

## 2026-08-25 commercial worker v3 immutable I/O closure

- Status: `SOURCE_CLOSED_LOOP_PASS / EXTERNAL_RUNTIME_NOT_RUN / RELEASE_HOLD`.
- Integration foundation: `8673bd45` versions the execution contract to
  `nexyfab.precision-cad-commercial-execution.v3` and migration `2026082502`.
- A commercial request now stages one canonical, content-addressed private
  input object and persists its exact identity in the same PostgreSQL
  transaction as approval, journal, claim, and outbox. Exact replay includes
  that input row and fails closed on absence or substitution.
- The authenticated claim route rechecks the immutable input row and object
  hash before returning an HMAC-bound transport. A lease-scoped artifact
  gateway serves the input and accepts only fixed-identity, content-verified
  `model`, `report`, and `verification` output commits.
- `scripts/drawing-to-3d/commercial-precision-worker.mjs` is a deployable Node
  client for claim, input readback, an explicitly configured native executable,
  three immutable output commits, Ed25519 receipt signing, callback HMAC, and a
  fail-closed health contract. It never substitutes a JavaScript geometry
  fallback for the configured native executable.
- Verification: TypeScript PASS; platform architecture PASS; focused worker
  client, contract, route, transaction, and Precision regressions `216/216`
  PASS. The worker test executes a separate native-process fixture, uploads
  exactly three outputs, and independently verifies its Ed25519 PASS receipt.
- Boundary: no real production-class native CAD executable, worker service,
  registry key, or self-test job has been deployed or evidenced. Independent
  STEP/native-CAD interoperability, topology/XCAF/GD&T review, sustained
  recovery evidence, experts, and manufacturing pilots remain required.
- Immutable handoff:
  `HANDOFFS/20260824T202926Z-commercial-worker-v3-immutable-io.md`.

## 2026-08-25 commercial migration compatibility closure

- Status: `CURRENT_MIGRATION_COMPATIBLE / RELEASE_HOLD`.
- Source implementation commit: `06ef2d63` (`[P0] fix(cad): accept current
  commercial migrations`).
- All six commercial generation and verifier entry points now use the shared,
  ordered PostgreSQL migration contract. They still fail closed below required
  migration `2026082208` and for unknown versions, while accepting registered
  later authority migrations through the current target `2026082403`.
- This removes the production incompatibility where a correctly upgraded
  service advertised `2026082403` but Precision routes required literal
  equality with the older `2026082208` value and returned HTTP 503.
- Verification: focused commercial readiness and Precision route regression
  `43/43` PASS, including real OCCT STEP writes; `workspace:check --
  precision-cad` PASS with TypeScript, architecture, ownership, and
  classification checks clean.
- Boundary: the source path is migration-compatible, but commercial release
  remains `HOLD` until staging is migrated, configured, deployed, and proven by
  authenticated multi-instance and recovery exercises plus independent CAD
  interoperability, expert review, and manufacturing pilots.
- Immutable handoff:
  `HANDOFFS/20260824T154924Z-commercial-migration-compatibility.md`.

## 2026-08-24 AP242 semantic identity re-export closure

- Status: `LOCAL_AP242_SEMANTIC_ROUNDTRIP_PASS / RELEASE_HOLD`.
- Source implementation commit: `f727a3dc` (`[P0] fix(cad): preserve STEP assembly identity on re-export`).
- Imported STEP PRODUCT, part number, PRODUCT_DEFINITION, and NAUO occurrence
  identity is now captured independently from the OCCT shape handle. Re-export
  rebinds those fields only when the returned product tree has the identical
  fail-closed structure; unsupported or changed trees block export instead of
  silently replacing product identity with translator defaults.
- The implementation changes no geometry or placement entities. It ignores
  comment-contained fake entities, escapes STEP strings, and verifies the
  rebound semantic graph before returning bytes.
- Verification: pure parser/rebinder tests `4/4`, actual OCCT WASM AP242
  open-export semantic roundtrip `1/1`, existing STEP hierarchy regression
  `32 PASS / 6 conditional skip`, TypeScript PASS, ESLint PASS, and Precision
  workspace ownership/architecture PASS at the source tree.
- Boundary: this closes the previously observed local name/part-number/
  occurrence-label loss. It does not claim XCAF reader availability,
  independent native CAD interoperability, signed external operation, or
  commercial release.
- Immutable handoff:
  `HANDOFFS/20260824T145321Z-ap242-semantic-identity-reexport.md`.

## 2026-08-24 AI exact bridge execution closure

- Status: `EXACT_BRIDGE_RUNTIME_CONNECTED_LOCAL / RELEASE_HOLD`.
- Integrated implementation base: `920e660d` on both `scope/precision-cad` and
  `integration/nexyfab` before this documentation handoff.
- The stable-reference prerequisite now continues through a durable bridge
  worker that rechecks the current canonical head, executes the actual Node OCCT
  current-head artifact bundle, stores STEP/HLR/dimensions/BOM/verification and
  the canonical manifest immutably, and issues a revision-bound signed receipt.
- Dispatch uncertainty does not cause automatic CAD replay. Expired sent work is
  quarantined as `VERIFIED_UNKNOWN` and can close only from an already persisted
  signed receipt and matching AI aggregate reference.
- Verification: actual OCCT STEP bundle regression, bridge tamper/crash/reconcile
  tests, TypeScript, production build, workspace audit, and all three scope
  checks passed at the integrated source baseline.
- Immutable handoff:
  `HANDOFFS/20260824T134514Z-ai-precision-exact-round-trip.md`.
- Remaining: live staging database/object store/Redis/Railway execution,
  authenticated browser round trip, third-party STEP review, topology campaign,
  experts, manufacturing pilots, and release authority. Exact bundle PASS still
  does not imply authoritative CAD commit or manufacturing approval.

## 2026-08-24 commercial-readiness continuation

- Source implementation commit: `5670cb85` (`[P0] feat(cad): bind AI stable refs to canonical head`).
- Added `nexyfab.precision-cad.mechanical-stable-reference-binding.v1` as the
  fail-closed bridge prerequisite for the AI Design V1 handoff. Precision now
  discovers the matching document from server-owned canonical heads and binds
  the exact revision ID, content SHA-256, rights receipt, FeatureTree, part, and
  every requested stable feature ID. The browser/AI does not supply a document,
  sequence, exact receipt, runtime identity, or PASS state.
- Ambiguous document matches, stale/corrupt heads, unknown feature references,
  malformed/extended contracts, and migration absence remain machine-coded
  `HOLD` outcomes.
- Verification: `workspace:check -- precision-cad` PASS (TypeScript and platform
  architecture); focused stable-binding tests `2/2` PASS; canonical revision and
  current-head bundle regression `13/13` PASS including a real OCCT STEP write.
- Remaining bridge work is integration-owned: durable dispatch/outbox, exact
  bundle execution after rebind, Precision signing, immutable receipt storage,
  AI aggregate CAS update, and read-model refresh. Those integration-owned
  items are now implemented locally at `920e660d`; this historical source entry
  still records the earlier `NOT_RUN` boundary and commercial release remains
  `HOLD`.

- Status: `SOURCE_FREEZE_READY / INTERNAL_30_OF_30_BOUNDED / RELEASE_HOLD`
- Source branch: `scope/precision-cad`
- Integration target: `integration/nexyfab`
- Baseline: `baseline/pre-scope-20260823`
- Current integration base: `bd200378` on `integration/nexyfab`; the preserved GP-02 through GP-11 work reapplied without conflicts after the AI V3-V10 merge and awaits its implementation commit.
- Delivered boundary: the clean-room mechanical candidate set is implemented as 30/30 bounded exact handlers. The closing slices are the topology-preserving bounded blind-hole delete/cap repair, the versioned three-point orthogonal rectangular sweep path, and the two-member unfused weldment compound with a hash-bound millimetre cut list. These contracts do not claim general delete-face, sweep, weldment, manufacturing, or commercial completeness.
- Source verification: fixed Node.js 22.23.2/npm 10.9.8 `workspace:check -- precision-cad` passed with zero ownership/classification violations, TypeScript PASS, and architecture PASS. The focused native/registry/sketch/sheet-metal/weldment suite passed 93 tests with one conditional external-corpus skip. The earlier production build result remains pre-integration and must be rerun at the final integrated HEAD.
- Scope preflight: the platform-owned legacy PHP changes are now committed on integration. A generated `mechanical-core-internal-verification.json` containing only sandbox `EPERM` failures was excluded from the source freeze and retained in recovery checkpoints; it is not success evidence.
- Immediate action: freeze and commit only the intended Precision-owned tree, generate a canonical UTC handoff pointing to that implementation commit, validate it, then merge the clean Scope branch once with `--no-ff`.
- Integration acceptance: retain literal v1/v2 schema routing, server-loaded current-head and rights bindings, stable machine tokens, fail-closed unsupported forms, and `authoritativeCommit: false`/`commercialReleaseReady: false`. AI Design may emit only versioned intent and provenance references; it may not manufacture Precision receipts, revisions, artifacts, runtime identity, XCAF results, or release state.
- CI sequencing: run focused Precision tests after the Scope merge, then workspace audit, architecture, type, build, security and database gates. Run the full GitHub CI/E2E only after all planned integration edits are complete. The previously cancelled E2E is not completion evidence.
- Deferred Precision action: begin GP-12 authority-owned CAS commit, stable topology edit/replay survival, and expanded XCAF provenance only after this GP-10 integration intake is frozen and verified; do not mix those new semantics into the GP-10 merge.
- Release: `HOLD` (`authoritativeCommit: false`, `commercialReleaseReady: false`). Integration is development `GO`, but immediate PR merge, staging promotion, production deployment, and Git history rewrite remain `NO-GO` until their independent gates pass.
