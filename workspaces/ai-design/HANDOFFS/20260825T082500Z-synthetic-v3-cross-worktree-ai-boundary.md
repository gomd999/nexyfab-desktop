# Synthetic v3 cross-worktree AI boundary

Timestamp: `2026-08-25T08:25:00Z`

Status: `PORTABLE_RAW_EVIDENCE / SYNTHETIC_ONLY / AI_ACCURACY_HOLD`

Integration replay found and closed a line-ending binding defect in the first
v3 receipt. Campaign JSON, source cases, corpus, and executor sources now use
canonical UTF-8 LF bytes after CRLF-to-LF normalization. The same immutable
receipt verifies from Platform, integration, and other Windows worktrees.

- canonicalization source commit: `6430d6a8f8b409c2c7d94d38ad02e0e2b77ff10d`;
- receipt self-hash:
  `632fd435b31c8f65cd07a1080bf3b02e79588b65a0e3523209043f036648da26`;
- executor identity:
  `b31882c8619eb3908838bde4ed087582600f234ea5307d8c3437da838f18ecd0`;
- retained evidence: 1,500 raw runs and 6,000 PASS assertions.

This portability fix changes no authority. The deterministic template subject
is not an AI-model accuracy campaign, independent holdout, exact-CAD result, or
manufacturing evidence. AI Design remains candidate authority only.
