<!--
PR template — every field is load-bearing. Filling in "n/a" is fine when
genuinely not applicable; leaving blank means you haven't thought about it.
See docs/process/commit-policy.md and docs/process/risk-policy.md.
-->

## Summary

<!-- 1-3 sentences. What changed and why, not how. -->

## Risk tier

<!-- Mark one. The dominant tier across commits in this PR. -->

- [ ] **P0** — touches money / geometry correctness / security / data integrity
- [ ] **P1** — affects shipped UX or shared infra, recoverable without data loss
- [ ] **P2** — local, easily reverted, no shared state effect

## Reversal plan

<!-- What does it take to undo this if it breaks prod?
     Possibilities: git revert, feature flag toggle, DB migration down,
     env var rollback, manual data recovery. State the path explicitly. -->

## Blast radius

<!-- Which files / directories / features are affected?
     For P0/P1: list explicitly. For P2: "docs only" is acceptable. -->

## Test plan

- [ ] `npm run typecheck` passes
- [ ] `npm run lint:ci` passes
- [ ] `npm run test` passes (or related subset for narrow changes)
- [ ] Manual smoke (if UI/3D change): which scenarios? <!-- list here -->
- [ ] 24h self-review delay completed (waived for `[hotfix]` only — note why)

## Commits

<!-- For multi-commit PRs, list the commits in order with their risk tier.
     Per policy, P0 commits should come LAST in the PR. -->

## Related

<!-- ADRs, prior PRs, issue links, customer reports. -->
