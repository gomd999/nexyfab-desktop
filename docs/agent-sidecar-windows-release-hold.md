# Windows agent sidecar release HOLD

The current Windows sidecar evidence proves only that the installer-core source bundle builds and its MCP smoke passes. It does not prove that an independently executable Windows SEA exists, is reproducible, has a verified SHA-256 manifest, preserves MCP/CLI parity when run as the binary, is Authenticode-signed, or has passed an installer test.

The 2026-08-23 audit is therefore fail-closed: `status=HOLD` and `releaseEligible=false`. The machine has Node v25.2.1 with legacy `--experimental-sea-config`, but no `--build-sea`, no installed `postject`, no `signtool.exe`, and no expected sidecar `.exe`. No substitute executable or synthetic PASS receipt was created.

Current toolchain evidence: [windows-sea-readiness-260823.json](evidence/agent-sidecar/windows-sea-readiness-260823.json).
The commercialization gate consumes the separate fail-closed release receipt at
[`windows-agent-sidecar-release-receipt.json`](evidence/release/windows-agent-sidecar-release-receipt.json).
The readiness receipt can never substitute for the release receipt.

Reproduce the audit without installing or executing an installer:

```powershell
node scripts/agent-sidecar/windows-sea-readiness.mjs --run-bundle-check
node scripts/agent-sidecar/windows-sea-release-evidence.mjs --write
node --test scripts/agent-sidecar/windows-sea-readiness.test.mjs scripts/agent-sidecar/windows-sea-release-evidence.test.mjs
```

The default release builder only reads local files and writes `NOT_RUN/HOLD` when
the governed evidence packet is absent. It never invokes SignTool, an installer,
or a VM. A release operator may provide already-captured artifacts explicitly:

```powershell
node scripts/agent-sidecar/windows-sea-release-evidence.mjs --write `
  --release-baseline docs/evidence/release/commercial-release-baseline-current.json `
  --readiness docs/evidence/agent-sidecar/windows-sea-readiness-260823.json `
  --unsigned-binary evidence/windows/agent-unsigned.exe `
  --unsigned-manifest evidence/windows/agent-unsigned.exe.sha256.json `
  --signed-binary evidence/windows/agent-signed.exe `
  --signed-manifest evidence/windows/agent-signed.exe.sha256.json `
  --parity evidence/windows/sea-parity.json `
  --signing evidence/windows/authenticode.json `
  --installer evidence/windows/disposable-vm-installer.json `
  --attestation evidence/windows/trusted-ci-release-attestation.json `
  --attestation-signature evidence/windows/trusted-ci-release-attestation.sig `
  --attestation-public-key evidence/windows/trusted-ci-release-ed25519-public.pem
```

The public key file is evidence, not its own trust root. Before invoking the
builder or commercialization gate, release infrastructure must configure an
out-of-band allowlist of Ed25519 SPKI SHA-256 fingerprints. For example:

```powershell
$env:WINDOWS_SEA_TRUSTED_ED25519_KEYS = '{"nexyfab-release-ci-2026":"<64-lowercase-hex-spki-sha256>"}'
```

Do not store a test private key or dynamically calculated fingerprint in this
variable. Key rotation requires an independently reviewed CI/release
configuration change. With no allowlisted key, the validator always returns
`trusted_release_attestation_invalid` and the receipt remains `HOLD`.

All paths must stay inside the repository and resolve to regular, non-symlink
files. The release validator requires:

- separate unsigned and signed `.exe` files with valid DOS/PE headers; the
  signed file must carry an Authenticode certificate table and have different
  bytes from the unsigned file;
- exact `nexyfab.windows-agent-sidecar-sha256.v1` manifests for both binaries;
- a `nexyfab.windows-agent-sidecar-parity-evidence.v1` packet with at least
  three unique executable calls, both MCP and CLI surfaces, and a different
  bound JSONL transcript for every call. Each transcript must contain exactly
  one structured `request`, `baseline_response`, `sea_response`, and `exit`
  record. The validator re-derives canonical input/output hashes, exactness,
  executable SHA-256, and exit code from those records;
- a `nexyfab.windows-agent-sidecar-authenticode-evidence.v1` packet bound to
  both binary hashes and a bound `nexyfab.windows-authenticode-machine-result.v1`
  JSON result captured from PowerShell `Get-AuthenticodeSignature` or SignTool.
  It must include the actual command/tool version/exit code, PE SHA-256,
  trusted-chain result, certificate SHA-256/subject, and verified timestamp
  token SHA-256/message imprint/authority/time. A PE certificate-table marker
  or human-authored `Status: Valid` text is not sufficient;
- a `nexyfab.windows-agent-sidecar-installer-vm-evidence.v1` packet from a
  unique disposable non-production VM, its bound structured provider
  attestation, and separate structured stage observations. Observations must
  be chronological and bind the executed PE hash, commands, version transition,
  induced rollback failure plus recovery, and zero uninstall residue;
- a canonical `nexyfab.windows-agent-sidecar-trusted-ci-attestation.v1` packet,
  detached Ed25519 signature, and allowlisted public key. The signed packet
  binds release identity, trusted runner identity, all evidence bindings, both
  PE hashes, Authenticode certificate/timestamp values, parity call digest, VM
  identity, the claimed Git tree OID, and the exact source-binding tree digest;
- fresh exact release identity, the fixed verifier source set, the readiness
  receipt, every raw file binding, and the final receipt self-hash.

Any missing, stale, transplanted, duplicated, malformed, or hash-mismatched
item keeps `ok=false`, `status=HOLD`, and `releaseEligible=false`. Editing PASS
fields, inventing raw JSON/logs, or recalculating the outer receipt hash cannot
bypass the allowlisted detached signature and re-derived observations.

Commercial release remains blocked until all of these are observed from the same immutable source revision:

1. Pin and review a SEA injection toolchain: Node with `--build-sea`, or legacy SEA plus a locked `postject` dependency.
2. Build the unsigned Windows SEA into the expected `src-tauri/binaries` target without touching an installed user copy.
3. Generate the `nexyfab.windows-agent-sidecar-sha256.v1` manifest and pass the byte/PE/path tamper verifier.
4. Run the executable itself through MCP discovery, representative tool calls, framing recovery, and the exact installer-core/CLI capability parity smoke, preserving the required JSONL process records.
5. Sign the exact manifest-bound executable with the production Authenticode identity and capture machine-readable OS/SignTool chain and RFC3161 timestamp results.
6. Exercise install, upgrade, induced-failure rollback/recovery, and uninstall in one uniquely attested disposable Windows VM and bind the structured observations to the same executable SHA-256.
7. In trusted release CI, verify the checked-out bytes against the claimed Git tree, build the canonical release attestation, and sign it with an allowlisted Ed25519 release key. Keep the private key outside the repository.

Source-bundle success must never be promoted to SEA, signing, installer, or release success.
