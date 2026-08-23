# Reviewer work packet contract

`src/lib/ai/reviewerWorkPacket.ts` defines the Wave 5 handoff boundary for
architecture, building, interior, civil, landscape, and mechanical review.

The generated packet is intentionally a request for review, not a review result.
It binds the source input, independent holdout set, immutable project revision,
artifact hashes, and evidence root to one `targetSha256`. It starts with no
reviewer attestations and therefore evaluates to `PENDING` with
`releaseReady: false`.

An external reviewer may append an attestation only when it identifies the
reviewer and role, proves independence from the build, points to the exact
packet and revision hashes, and links a separately verified signature and
attestation record. The validator rejects target tampering, duplicate reviewer
roles, missing required roles, invalid hashes, failed independence, duplicate
artifacts, future review times, and stale revision hashes. A PASS verdict is
release-eligible only after every required role has a matching verification
record from outside the packet. A self-declared verification boolean is not a
trusted input.

This contract does not create expert identities, signatures, manufacturing
receipts, legal approvals, or seven-day operations evidence. Those remain
external inputs and are HOLD/PENDING until supplied and independently checked.

Focused test:

```text
npx vitest run src/lib/ai/reviewerWorkPacket.test.ts --reporter=dot
```
