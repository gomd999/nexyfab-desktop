# AI Design handoff: durable exact Precision consumer

- Created: `2026-08-25T00:55:00Z`
- Branch: `scope/ai-design`
- Head: `eb04248d1f3b124cd27b4e39e8df4eee8ccd404f`
- Integration target: `integration/nexyfab`
- Status: `CONCEPT_CONSUMER_CONNECTED / LOCAL_DURABLE_EXACT_PASS / RELEASE_HOLD`

## Summary

AI Design submits only revision-bound concept and candidate requests. The
integrated Precision consumer now proves the complete local durable exact path
through immutable input, transactional claim, isolated native execution,
signed callback, authoritative persistence, and workspace HEAD CAS. The shared
operations handoff records the exact evidence and release boundary.

This does not expand AI authority. AI cannot create exact PASS, sign worker or
parser receipts, mutate the authoritative CAD HEAD directly, approve
manufacturing, or promote a release. Only release-bound real-worker evidence
plus independent product and operations evidence may advance rollout.

## Changed paths

- `workspaces/ai-design/CURRENT.md`
- `workspaces/ai-design/HANDOFFS/20260825T005500Z-ai-precision-durable-exact-consumer.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run test:accuracy:common`
- [x] Full Vitest: 2,950 files and 30,188 tests passed.
- [x] Node test runner: 618 passed, 5 environment-gated skips, 0 failed.
- [x] Production build, 301 static pages, and bundle budgets passed.
- [x] Current candidate secret scan completed with zero findings.

## Remaining work and risks

- The local native executable is a deterministic fixture, not an independently
  qualified production CAD adapter.
- A same-release staging observation, independent CAD review, dual-role expert
  approval, three manufacturing pilots, and seven-day operations evidence are
  not present.
- AI remains concept/candidate authority only; manufacturing and commercial
  release stay disabled and `HOLD`.

