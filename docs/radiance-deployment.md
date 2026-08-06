# Radiance deployment and release gate

NexyFab adopts the official Radiance 6.0 distribution as its daylight engine.
Radiance remains a separate server process; it is not linked into the NexyFab
application binary.

Pinned source artifact:

- URL: `https://radsite.lbl.gov/radiance/dist/rad6R0P1.tar.gz`
- Size: `41,003,064` bytes
- SHA-256: `b720d39e43fcf2ea09ab1699b62418836dfad8316743727761d29e85f82585cf`
- Upstream release date: 2025-07-22; upstream file updated 2025-08-22

The upstream download page does not publish a checksum alongside the archive.
The value above was calculated from the official artifact and is enforced by
the Docker build. A changed upstream byte stream must fail the build and be
reviewed rather than silently updating the pin.

## Supply-chain requirements

1. Download source or binaries only from the official Radiance distribution.
2. Pin the exact release and SHA-256 in the deployment artifact or image lock.
3. Preserve the Radiance Software License 2.0 notice in the shipped `NOTICE`.
4. Do not describe NexyFab as certified or endorsed by LBNL, the University of
   California, or the U.S. Department of Energy.
5. Audit third-party installers, weather files, BSDF libraries, and IES data
   separately; the Radiance license does not automatically cover them.

The Docker image compiles a headless Release build in a separate
`radiance-builder` stage and copies only `/opt/radiance` into the application
runtime. The image build fails unless all six required tools are executable and
`rtrace -features` succeeds.

## Required executables

Point-in-time calculations require `oconv` and `rtrace`. Annual calculations
also require `rfluxmtx`, `gendaymtx`, `dctimestep`, and `rmtxop`. NexyFab uses
absolute server-controlled paths and rejects executable-name mismatches.

## Runtime safety contract

- Process launch uses an argument array and `shell: false`.
- Each request receives a unique temporary directory that is removed afterward.
- Runtime is limited to 120 seconds per command by default.
- Captured output is limited to 64 MiB per command by default.
- Input artifacts are allowlisted and path traversal is rejected.
- Radiance command escapes beginning with `!` are rejected before execution.
- Missing binaries are `not_run`; non-zero exits and malformed matrices are
  `fail`; neither state is eligible for release.

## Accuracy release gate

Before enabling the production endpoint:

1. Verify the six executable paths inside the final runtime container.
2. Run a point-in-time golden scene and compare sensor lux values with the
   committed reference and tolerance.
3. Run an annual golden scene and verify matrix dimensions, sDA300/50%, and
   ASE1000/250h.
4. Store the output SHA-256, Radiance version, weather-file SHA-256, scene hash,
   sensor hash, command parameters, and pass/fail/not_run verdict.
5. Keep `releaseReady=false` until both golden paths pass in the deployed image.

## API behavior

- `POST /api/cad/v1/architecture/daylight/package` creates deterministic scene
  and sensor artifacts with provenance hashes.
- `POST /api/cad/v1/architecture/daylight/run` executes only the built-in
  allowlisted plan using server-configured binaries.
- `GET /api/cad/v1/architecture/daylight/status` checks all six binaries and
  executes `rtrace -version` and `rtrace -features`; it does not expose server
  paths.
- `POST /api/cad/v1/architecture/daylight/results` parses externally produced
  output but must not be treated as authoritative execution provenance.

Engine readiness and accuracy readiness are separate. The status endpoint can
pass when the tools execute, but production accuracy remains `not_run` until
`verifyRadianceGoldenEvidence` receives provenance-bound point-in-time and
annual results from the deployed image.
