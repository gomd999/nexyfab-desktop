# Native CAD worker host deployment contract

## Boundary

Nexyfab does not treat exchange-format parsing as proof of native CAD semantics. SolidWorks, Inventor, CATIA, Creo and Revit jobs require a licensed Windows worker. Parasolid and exact DWG jobs require a licensed or otherwise authorized exact engine on Windows or Linux. Missing engines remain `not_run`.

## Process protocol

The configured executable receives:

```text
worker.exe --request request.json --source source.<ext> --output result.json
```

The request is a single `nexyfab.native-worker-routing-job.v1` object. The result must satisfy `nexyfab.native-worker-execution-result.v1.1`. Standard output is diagnostic only; the runner accepts only the declared result file. Version 1.1 requires an explicit right-handed row-major/local-to-parent coordinate convention, complete occurrence state (including declared mirrors), and world-frame joint axis/origin/limits so accepted output can enter the governed precision-joint pipeline without assumptions.

For health probing, each worker must support:

```text
worker.exe --health --output health.json
```

`health.json` must satisfy `nexyfab.native-worker-health.v1` and declare `protocol.executionResultSchema = nexyfab.native-worker-execution-result.v1.1`. A configured command is only `ready_to_probe`; it is not ready until executable identity, protocol, OS, license and required capability checks pass.

The batch health and canary artifacts include their own `generatedAt` timestamp. The canary gate also carries `healthGeneratedAt` and `validUntil`, so rebuilding a gate cannot extend expired health evidence. The admin runtime accepts evidence for at most 24 hours and does not use filesystem modification time as proof of freshness. Set `NEXYFAB_NATIVE_WORKER_HEALTH_EVIDENCE` and `NEXYFAB_NATIVE_WORKER_CANARY_EVIDENCE` to the operator-controlled read-only artifact paths.

## Required isolation

- Use a dedicated non-administrator service account.
- Give each job a new temporary directory and no access to unrelated corpus files.
- Disable macros, external references, update links and arbitrary embedded scripts by default.
- Allow only the input file, request JSON and output JSON across the worker boundary.
- Apply a wall-clock timeout and terminate the worker process tree on expiry.
- Delete temporary source material after the validated result is persisted.
- Do not place license tokens, credentials or customer paths in result artifacts.

## Evidence requirements

- Outer source and ZIP member SHA-256 must match the routing manifest.
- The execution runner must match the current routing-manifest SHA-256 to the canary gate before reading corpus source bytes or starting a worker.
- Worker name, version and native CAD system must be non-empty.
- Every part definition needs native body membership.
- Every occurrence needs a valid definition and rigid local transform.
- Mirrored transforms are accepted only when the occurrence state explicitly declares `mirrored`; undeclared reflections fail.
- Assembly roots, parent references and joint occurrence references must be valid.
- Every movable joint needs a finite non-zero axis, finite origin, world frame and ordered native limits (nullable only when the source truly has no governed range).
- Native-format jobs requiring semantics must declare recovered hierarchy and constraints.
- Approximate mesh or bounding-box output cannot be promoted to exact native evidence.

Accepted v1.1 assembly output is converted by `promoteNativeWorkerResultToAssemblyEvidence` into one immutable, atomically linked `nexyfab.native-assembly-evidence.v1.1` file per job under the runner's `--assembly-output-dir`. Its non-identifying filename binds both job ID and accepted result SHA-256, so a changed rerun cannot overwrite prior evidence. The execution report records only its relative artifact name, result SHA-256 and artifact SHA-256, avoiding one unbounded duplicate JSON batch. That governed evidence must still pass bundle source/hash validation before the existing native-joint adapter and motion/clearance certificate run. Promotion never grants reviewer approval or manufacturing release by itself.

Raw accepted worker results follow the same pattern under the sibling `native-worker-results` store. The `nexyfab.native-worker-execution-batch.v1.1` report contains a small job/result-artifact index rather than inline geometry arrays; resume and canary loaders rehydrate only after validating store name, artifact filename, file-size ceiling, artifact SHA-256, canonical result SHA-256 and the complete v1.1 result contract. Legacy inline `execution-batch.v1` reports remain readable only through the same validation path during migration; indexed entries under a v1 label are rejected.

## Expert review and edit invalidation

Manufacturing release does not accept a browser-supplied approval boolean. A `nexyfab.native-cad-expert-review.v1` artifact must contain exactly two approved Ed25519 signoffs from different reviewer IDs trusted by the server through `NEXYFAB_CAD_REVIEWER_KEYS`. Each public-key registration explicitly lists its allowed reviewer role; a valid signature under an unauthorized role is rejected. The two IDs must also resolve to different normalized public-key fingerprints, so duplicating one key under two names cannot satisfy independence. Keep private keys outside Nexyfab and outside the evidence store.

Each signature is bound to the source SHA-256, the complete sorted artifact SHA-256 set, the joint-definition SHA-256, the review revision, and a canonical SHA-256 of the exact assembly state, animation, collision boxes, and feature trees being verified. Any CAD edit, joint change, motion change, collision-geometry change, artifact replacement, or revision change invalidates the old approval. Rejected, changes-requested, malformed, future-dated, untrusted, duplicate-reviewer, mismatched, or unsigned evidence remains release-blocking. The animation verification API recomputes the verification-input hash server-side, preventing approval replay onto another product or motion.

Generate the immutable unsigned packet with `npm run evidence:native-cad-review-packet -- <joint-evidence.json> <verification-input.json> [output-dir]`. It deliberately contains null reviewer fields and grants no approval. Reviewers sign the canonical payload shown by `nativeCadSignoffPayload` using their offline Ed25519 tooling; Nexyfab never receives a private key. Combine exactly one domain and one independent signoff into `nexyfab.native-cad-expert-review.v1`, then run `npm run evidence:native-cad-review-validate -- <packet.json> <signed-review.json> [validation.json]`. The validation command exits nonzero unless both signatures and the immutable target match.

The administrator UI at `/admin/native-cad-workers/expert-review` downloads the exact compact signing payload bytes. Do not reformat or add a trailing newline before signing. After the external tool produces a standard Base64 Ed25519 signature, wrap it with `npm run evidence:native-cad-signature-wrap -- <signing-payload.json> <base64-signature.txt> [output-dir]`. The wrapper validates only response shape and byte canonicality (`cryptographicallyVerified: false`); cryptographic trust is granted only by the authenticated server validator. Import the resulting `nexyfab.native-cad-expert-signature-response.v1` file in the administrator UI. Manual Base64 paste remains a fallback, not the preferred workflow.

## Deployment order

1. Parasolid and exact DWG isolated translators.
2. SolidWorks and Inventor Windows hosts.
3. Revit Windows host for architectural hierarchy and constraints.
4. Creo and CATIA hosts.
5. Three consecutive health passes, then one canary job per worker.
6. Resume the 108-job batch; never rerun already accepted hash-bound results.

Set the operator-local `NEXYFAB_REFERENCE_CORPUS_ROOT` (or pass the documented root argument) before building or executing routing evidence; no personal/customer absolute path is stored in source defaults. Run `npm run evidence:native-worker-health` before selecting a canary. Build the deterministic gate with `npm run evidence:native-worker-canary-gate`, then execute only its declared job using `npm run evidence:native-worker-execute -- --job=<job-id>`. The runner mechanically enforces a fresh gate, current manifest hash, declared canary ID and health-bound worker identity before it reads source bytes. A full worker family can be selected with `--worker=<worker-kind>` only after its canary is accepted and the gate is rebuilt to `pass`.

## Current preflight

Run `npm run evidence:native-worker-preflight`. The current workstation has no configured external worker command, so all seven worker types are `not_run`, not failed and not release-ready.
