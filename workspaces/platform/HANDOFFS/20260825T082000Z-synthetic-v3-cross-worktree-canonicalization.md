# Synthetic v3 cross-worktree canonicalization handoff

Timestamp: `2026-08-25T08:20:00Z`

Status: `RAW_CAMPAIGN_VERIFIED / CROSS_WORKTREE_DETERMINISTIC /
SYNTHETIC_ONLY`

## Defect and closure

The first v3 receipt passed in the Platform worktree but failed after the same
Git files were materialized in the integration worktree. The receipt had bound
raw working-tree bytes, so LF/CRLF checkout policy changed byte counts and
hashes without changing evidence semantics.

All JSON and MJS bindings in the synthetic receipt now use the established
`utf8-crlf-to-lf` canonicalization contract. The receipt declares that policy,
the generic local-file verifier accepts only that exact known policy, and the
derivation verifier rebuilds the receipt from canonical bytes.

A regression converts campaign results, source cases, corpus, and executor
sources to CRLF after receipt generation. The unchanged receipt remains valid.
Changing semantic text, corpus identity, an assertion, or executor content
still invalidates it.

## Current identities

- raw evidence commit: `4731d3bc669bed442132e56b3afd28496014c02b`;
- canonicalization code/source commit:
  `6430d6a8f8b409c2c7d94d38ad02e0e2b77ff10d`;
- local observation identity: `local-synthetic-campaign-20260825`;
- receipt self-hash:
  `632fd435b31c8f65cd07a1080bf3b02e79588b65a0e3523209043f036648da26`;
- executor identity:
  `b31882c8619eb3908838bde4ed087582600f234ea5307d8c3437da838f18ecd0`;
- runs/observations: 1,500/1,500 and 6,000/6,000 PASS.

This remains synthetic deterministic regression only. It does not authorize
commercial accuracy, native-CAD interoperability, expert approval,
manufacturing release, Private Beta, or GA.
