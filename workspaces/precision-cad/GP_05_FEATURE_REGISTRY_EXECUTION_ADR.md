# GP-05 commercial feature registry and execution ADR

- Status: `IMPLEMENTED_INTERNAL / RELEASE_HOLD`
- Date: `2026-08-24`
- Owner: `scope/precision-cad`
- Depends on: `GP_02_CANONICAL_V2_ADR.md`, `GP_04_NATIVE_XCAF_ADR.md`
- Release effect: none; exact execution evidence is necessary but not sufficient
  for commercial release or domain qualification.

## Decision

Every feature exposed to authoritative execution is resolved through the
versioned `nexyfab.precision-cad.feature-registry.v1` registry. Its canonical
SHA-256, the trusted Node OCCT runtime identity, the concrete handler, required
verifiers, execution intent, and terminal result are evaluated before geometry
execution. Unknown, malformed, preview-only, unsupported, stubbed, unverified,
or ambiguously mapped features fail closed.

An authoritative request may return only `ALLOW_EXACT` or `BLOCK`; it never
silently becomes a mesh or approximate result. Preview is available only when
the caller explicitly requests `PREVIEW` and the runtime advertises a real
`MESH_PREVIEW` path.

## Graduated exact surface

The first exact registry surface consists of bounded commands already backed by
the real OCCT bridge and actual verification axes:

- extrusion, revolution, hole, fillet, chamfer and explicit open shell;
- explicit boolean union, subtraction and intersection;
- exact B-Rep production and STEP round-trip verification where required.

The generic `shell` and generic `boolean` aliases remain preview-only because
they do not encode enough intent for authoritative dispatch. Candidate feature
names, catalog entries, UI buttons, payload fields, and a successful plan build
do not imply exactness.

## Trusted runtime identity

`loadOcctNode()` loads the verified glue source bytes through a content-bound
data URL and supplies the same verified WASM buffer to Emscripten. The runtime
identity binds package name/version and manifest, glue and WASM SHA-256/size,
Node/V8 versions, platform, and architecture.

Reads are bounded and descriptor-based with no-follow behavior where supported,
pre/post file identity checks, minimum/maximum sizes, overflow probes, and
dist-directory cache separation. The commercial runtime derives handlers and
verifiers from the constructed bridge; a request cannot self-assert them.

## Commercial preflight and consumers

The pure preflight validates a bounded active feature tree, skips suppressed
nodes without executing them, checks dependencies, rejects embedded child
snapshots, requires one unconsumed terminal, verifies command-to-handler
correspondence and numeric command limits, and produces only `PRECHECK_PASS` or
`HOLD`.

The Precision-owned exact single-part drawing handoff and precise assembly
interference path now consume this trusted preflight before calling the kernel.
Their evidence includes the current registry hash, runtime identity hash, glue
hash, WASM hash, and preflight status. Unsupported and tampered cases remain
`NOT_RUN`/`BLOCKED` rather than falling back to AABB or mesh while claiming exact
results.

Focused verification on 2026-08-24 passed 36 tests, including real OCCT STEP
write/read, exact drawing generation, deterministic evidence, boolean execution,
hole cutting, unsupported-feature blocking, tamper detection, and precise
interference behavior. Typecheck also passed.

## Remaining HOLD boundary

The following are not promoted by this ADR:

- candidate mechanical features outside the explicitly graduated registry rows;
- browser preview, SCAD, mesh, AABB, UI metadata, or synthetic fixtures;
- independent accuracy, topology survival, exchange conformance, manufacturing
  correctness, domain authority, safety, or pilot evidence;
- AI-owned exact consumers until integration adopts the same loaded runtime
  identity and registry/preflight receipt contract recorded in
  `INTEGRATION_ACTIONS.md`;
- security, dependency, SBOM, notice, tenant, backup, performance, localization,
  external review, and commercial release gates.

## Clean-room and rights rule

Registry semantics and execution policy are original contracts derived from
general CAD concepts and the repository's own bridge APIs. No external manual
expression, proprietary feature taxonomy, parameter table, source code, test
fixture, or product behavior is copied. A public concept may guide an invariant,
but implementation, wording, IDs, bounds, evidence and tests must be independently
authored and traceable to this repository.
