# GP-04 native XCAF import and canonical binding ADR

- Status: `IMPLEMENTED_INTERNAL / RELEASE_HOLD`
- Date: `2026-08-24`
- Owner: `scope/precision-cad`
- Depends on: `GP_02_CANONICAL_V2_ADR.md`, `GP_03_REVISION_JOURNAL_ADR.md`
- Release effect: none; projected documents remain `CONSUMER_DRAFT`,
  verification remains `NOT_RUN`, and release remains `HOLD`.

## Decision

STEP assembly inspection uses the native Open CASCADE XCAF path. The worker
must bind the exact input SHA-256, executable SHA-256, invocation SHA-256,
program identity, kernel claim, and a complete versioned inspection receipt.
The canonical adapter consumes only that strict current receipt and never
promotes a name, label, aggregate metric, mock result, or native `PASS` into an
authoritative canonical revision.

The implementation is bounded to 128 products and 64 occurrence-path segments.
It rejects future/legacy program versions, unknown or missing fields, cycles,
duplicate paths, invalid transforms, non-finite metrics, physically inconsistent
mass properties, oversized output, timeouts, and input/hash substitution.

## Native measurements

The native producer reports deterministic XCAF traversal and the following
kernel-derived values for each product or occurrence:

- role, occurrence path, referred label and local-to-parent transform;
- name, source label, optional color, and explicit unavailable part number;
- solid, shell, face, edge, and non-manifold edge counts;
- B-Rep validity, volume, surface area, maximum tolerance and bounding box;
- centroid, mass-property basis, inertia tensor, and inertia unit.

Source labels remain provenance only. Canonical object IDs are bounded,
domain-separated hashes and are not inferred from display names. Geometry
identity remains `NOT_EXPOSED_BY_BINDING` because counts and mass properties are
not a B-Rep identity.

## Current-head server binding

The application now has a read-only current-head path that rebuilds the
validated mechanical artifact bundle, re-hashes its server-generated STEP
bytes, calls the configured XCAF worker, and emits one strict root occurrence
envelope. It does not accept a client STEP, inspection result, bundle, revision,
worker URL, or credential. The envelope binds the canonical revision triplet,
rights receipt, bundle manifest, STEP hash, native executable hash, invocation
hash, XCAF revision-binding hash, occurrence identity, B-Rep validity, and
single-solid summary while keeping `release: HOLD`.

The server client uses only `OCCT_XCAF_SERVICE_URL` and
`OCCT_XCAF_SERVICE_TOKEN`, refuses redirects, bounds request/response/time, and
validates the complete worker receipt. The worker requires the same bounded
bearer token for `/capabilities` and `/v1/inspect`; production startup fails
closed without it. `/health/live` remains unauthenticated for orchestration
liveness. Application access still requires authenticated project membership
and a separate rate limit before any current-head rebuild or native call.

## Reproducible native evidence

The Dockerfile now has one unambiguous build contract: repository-root context.
On 2026-08-24 the current source built successfully as image:

```text
sha256:d00a91b545e7264c67ce4ba22a648b58cb2e08b38f7f84178634abecfa1e63e9
```

The current native binary then inspected the existing geometry fixture
`docs/evidence/cad-independent/local/mechanical-step-c4-260814/source.step`,
whose SHA-256 is:

```text
94b47f150be6086d4817ac23983f9267e72c6eb0714093bb985d6c49025f144f
```

The result was `PASS_NATIVE` from `occt-xcaf-inspect/2-GNU-12.2.0` with the
OpenCASCADE `7.6.3` kernel claim. It exposed one assembly and two occurrences,
including two solids, 12 faces, 48 edges, zero non-manifold edges, valid B-Rep,
57,600 mm3 aggregate volume, 17,600 mm2 surface area, per-occurrence transforms,
centroids, and inertia tensors.

The three `step-body-membership` minimal fixtures also passed byte-bound native
parsing, but expose only a root product and no geometry. They are not treated as
assembly traversal, topology, or commercial qualification evidence.

## Remaining HOLD boundary

`nativeBinarySha256` and `nativeInvocationSha256` bind the executable and
invocation tuple. Dynamically loaded OCCT libraries and the immutable deployment
image digest are not yet included in the runtime receipt, so the adapter records
`NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND`. A local image ID written in this ADR is
diagnostic evidence, not a signed production provenance receipt.

Release therefore still requires:

- immutable image digest plus executable and dynamic-library manifest binding;
- SBOM, dependency/license/notice evidence and signed deployment provenance;
- actual deployed current-head worker tests on rights-cleared repeated-part,
  nested-transform, color, name, invalid-B-Rep, and limit-boundary STEP corpora;
- independent STEP/XCAF comparison, tolerance policy, reviewer and field pilot;
- production isolation, timeout, memory, concurrency, recovery and observability
  evidence.

## Clean-room and rights rule

This implementation uses general concepts and public OCCT API behavior. No
manual, encyclopedia, proprietary product UI, sample implementation, wording,
fixture, or code is copied into the implementation. Existing repository fixtures
are used only as internal diagnostics unless their provenance and commercial
reuse rights are separately established. External documentation and screenshots
must never be converted into source code or a compatibility claim by imitation.
