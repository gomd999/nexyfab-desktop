# Mechanical intent evidence hierarchy v4 handoff

Date: 2026-08-25 08:41 UTC

## Result

Implementation and regenerated evidence are committed at
`077e20c6f3399fa135dba2086ae69d94dd2fccc0`.

The checked mechanical chain is now portable across LF/CRLF worktrees and
fail-closed against evidence drift. The internal receipt binds 171 files,
including the complete checked 150-case qualification bundle, the default
10-design/70-axis exact-runtime bundle, and the assembly drawing handoff
bundle. The public direct-design campaign schema now requires the same signed
verification receipt that the runner and commercial validator require.

`nexyfab.mechanical-product-scope-assessment.v4` records three local stages
separately from commercial evidence:

- `intentQualification150Verified=true`: deterministic parsing,
  requirements, candidate, and eligibility only; geometry, verification, AI
  model calls, and commercial execution remain `NOT_RUN` for all 150 cases.
- `intentRuntimeRepresentativeVerified=true`: 10 revision-bound designs and
  70 exact create/edit/regenerate/save-reopen/undo/export/drawing axes; the AI
  model and external commercial campaign remain `NOT_RUN`.
- `assemblyDrawingHandoffLocalVerified=true`: authenticated project route,
  immutable SQLite bytes, CAS/revision checks, and bounded expiry cleanup;
  production scheduler/browser/PostgreSQL concurrency observations remain
  `NOT_RUN`.

These local PASS values do not participate in Private Beta promotion. The
commercial requirements remain the signed 30-feature closed loop, 10 direct
design packages for Private Beta, all 30 packages and 150 intents for
self-service, standard STEP conformance, 20 frozen blind product challenges,
and three independently inspected manufacturing pilots.

## Machine evidence

- qualification receipt:
  `cb00232c065b50b92a4e82bec220e5395ec86a585151cf07c4dee786f141fee8`;
- representative 260823 runtime receipt:
  `d0d70305f6e7575dfa09d4187c7f5f23733619a5df9a889794d95d632937e950`;
- assembly handoff receipt:
  `b4d42c43218de614952354cb45b7fa7c69103e827afc4771d3a55e394827633c`;
- full internal verification receipt:
  `b179f7f761fd5ee73399ee51550c81152fff443e4fcea63173650b678d5edb6b`;
- v4 product-scope receipt:
  `95d449dd39c5c2d002c2c3681726ba015a447dd949cd69255683040e434d226f`.

## Verification

- internal direct CAD: 137/137 PASS;
- mechanical accuracy: 49/49 PASS;
- assembly handoff: 11/11 PASS;
- scope/gate/tamper contracts: 46/46 PASS;
- commit-related Vitest: 38/38 PASS;
- qualification: 150/150 checked with zero issues;
- representative runtime: 10/10 designs and 70/70 axes with zero issues;
- Platform workspace ownership, full ESLint, and TypeScript: PASS.

## Honest release boundary and next action

The v4 decision is `private_beta_evidence_pending`; Private Beta,
self-service, manufacturing release, and GA remain false. No native commercial
CAD adapter, external reviewer keys, direct-design artifacts, manufacturing
receipts, production operations evidence, or production deployment was
invented or changed.

Next, fast-forward this commit and handoff through integration, Precision CAD,
and AI Design, then replay the qualification/runtime/scope checks from every
worktree. After that, the first actionable commercial unit is the signed
10-package candidate subset of the frozen 30-design x 5-intent campaign using
real native CAD outputs and role-separated STEP/drawing/BOM verifiers.
