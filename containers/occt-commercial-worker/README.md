# Commercial Precision worker image boundary

This directory is a fail-closed deployment wrapper, not a bundled CAD engine.
It cannot build until an operator supplies a reviewed adapter image by exact
OCI digest, the adapter executable SHA-256, and the worker source SHA-256.

The adapter image contract is:

- Linux OCI image referenced as `registry/repository@sha256:<64 hex>`;
- Node.js 22 or newer and `sha256sum` available;
- a regular, non-symlink, executable adapter (default
  `/opt/nexyfab/bin/native-adapter`);
- no core database, object-storage, or web-service credentials in the image.

Use `scripts/drawing-to-3d/build-commercial-precision-worker-image.mjs` to
validate the immutable inputs, derive the native invocation SHA-256, and invoke
Docker without a shell. Runtime secrets and the Ed25519 private key must be
injected only into the isolated worker service. `/live` is process liveness;
`/health` remains HTTP 503 `NOT_READY` until a signed self-test job completes.
