# i18n full-product artifact acquisition

This runbook produces an unsigned `I18N_FULL_PRODUCT_REVIEW_RECEIPT` packet for six locales (`kr`, `en`, `ja`, `cn`, `es`, `ar`) and five review surfaces: visual, RTL, email, PDF, and export.

The runner only binds artifacts that already exist under the declared evidence root. It does not launch a browser, send email, render PDFs, run export parsers, create an HMAC, or issue production approval.

## Packet generation

```bash
node scripts/i18n/acquire-full-product-review-packet.mjs \
  --evidence-root=C:\path\to\evidence \
  --manifest=C:\path\to\artifact-manifest.json \
  --build-id=<build-id> \
  --head=<git-sha> \
  --out=docs/evidence/release/i18n-full-product-review-packet.json
```

The manifest is an acquisition declaration, not an approval. Each artifact must declare `status: PASS`, `synthetic: false`, all six locales, matching build/head, and an execution record with `executed: true`, `status: PASS`, and `exitCode: 0`. It must provide relative `artifactPath` and `evidencePath` values.

The runner independently checks containment, symlink/junction escape, regular-file status, byte length, and SHA-256. Missing declarations become `NOT_RUN`; invalid declarations become `HOLD`. The packet itself is always `status: HOLD`, `releaseEligible: false`, `signatureStatus: UNSIGNED`, with null receipt hash/HMAC.

## Required acquisition sources

- `visual`: Playwright/browser screenshots and visual diff evidence for all six locales.
- `rtl`: Arabic RTL and responsive evidence plus the locale matrix.
- `email`: provider send/receive or deliverability evidence; unit tests are insufficient.
- `pdf`: actual locale-aware PDF output and parser/render inspection.
- `export`: actual locale-aware export output and independent parser/roundtrip evidence.

After acquisition, an authorized review service must independently inspect the files, bind them to the exact build/head, sign the packet, and perform any HMAC operation. The unsigned packet from this runner must never be treated as GA or production evidence.
