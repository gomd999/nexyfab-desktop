# Native CAD worker host deployment contract

## Boundary

Nexyfab does not treat exchange-format parsing as proof of native CAD semantics. SolidWorks, Inventor, CATIA, Creo and Revit jobs require a licensed Windows worker. Parasolid and exact DWG jobs require a licensed or otherwise authorized exact engine on Windows or Linux. Missing engines remain `not_run`.

## Process protocol

The configured executable receives:

```text
worker.exe --request request.json --source source.<ext> --output result.json
```

The request is a single `nexyfab.native-worker-routing-job.v1` object. The result must satisfy `nexyfab.native-worker-execution-result.v1`. Standard output is diagnostic only; the runner accepts only the declared result file.

For health probing, each worker must support:

```text
worker.exe --health --output health.json
```

`health.json` must satisfy `nexyfab.native-worker-health.v1`. A configured command is only `ready_to_probe`; it is not ready until executable identity, OS, license and required capability checks pass.

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
- Worker name, version and native CAD system must be non-empty.
- Every part definition needs native body membership.
- Every occurrence needs a valid definition and rigid local transform.
- Assembly roots, parent references and joint occurrence references must be valid.
- Native-format jobs requiring semantics must declare recovered hierarchy and constraints.
- Approximate mesh or bounding-box output cannot be promoted to exact native evidence.

## Deployment order

1. Parasolid and exact DWG isolated translators.
2. SolidWorks and Inventor Windows hosts.
3. Revit Windows host for architectural hierarchy and constraints.
4. Creo and CATIA hosts.
5. Three consecutive health passes, then one canary job per worker.
6. Resume the 108-job batch; never rerun already accepted hash-bound results.

Run `npm run evidence:native-worker-health` before selecting a canary. Build the deterministic gate with `npm run evidence:native-worker-canary-gate`, then execute only its declared job using `npm run evidence:native-worker-execute -- --job=<job-id>`. A full worker family can be selected with `--worker=<worker-kind>` only after its canary is accepted.

## Current preflight

Run `npm run evidence:native-worker-preflight`. The current workstation has no configured external worker command, so all seven worker types are `not_run`, not failed and not release-ready.
