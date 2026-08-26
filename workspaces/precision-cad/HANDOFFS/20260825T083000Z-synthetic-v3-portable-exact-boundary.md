# Synthetic v3 portable exact-boundary handoff

Timestamp: `2026-08-25T08:30:00Z`

Status: `PORTABLE_SYNTHETIC_RECEIPT / NATIVE_CAD_NOT_RUN /
COMMERCIAL_RELEASE_HOLD`

The first v3 receipt exposed a raw LF/CRLF hash dependency after integration.
All run, source, corpus, and executor text bindings now use canonical UTF-8 LF
bytes. The unchanged receipt verifies across Windows worktrees, while semantic
or executor changes remain rejected.

- canonicalization source commit: `6430d6a8f8b409c2c7d94d38ad02e0e2b77ff10d`;
- receipt self-hash:
  `632fd435b31c8f65cd07a1080bf3b02e79588b65a0e3523209043f036648da26`;
- executor identity:
  `b31882c8619eb3908838bde4ed087582600f234ea5307d8c3437da838f18ecd0`;
- retained observations: 1,500 runs and 6,000 required-axis PASS records.

The evidence remains an internal template-rebuild regression. It is not a
production native Precision worker result, independent STEP/XCAF/GD&T review,
150 AI-intent campaign, expert signoff, or manufacturing pilot. Exact-CAD and
commercial authority remain fail-closed.
