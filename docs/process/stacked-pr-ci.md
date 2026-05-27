# Stacked PR CI behaviour

When a feature is large enough that it splits into a chain of PRs
(`A → B → C → main`), each child PR's *base* is its parent's head
branch, not main. GitHub Actions' `branches:` filter on
`pull_request` triggers matches against the base, so a naive
workflow like

```yaml
on:
  pull_request:
    branches: [main]
```

only runs CI on the bottom-of-stack PR — the others get zero
pre-merge signal until their base auto-retargets to main on parent
merge. This is the bug that Wave 1's 22-PR stack would have shipped
into main with no CI signal on PRs #6-#26.

## What we do

`ci.yml` and `build-test.yml` both drop the `branches:` filter from
`pull_request`. Every PR — regardless of base — gets the same
typecheck / ESLint / unit-test / build-test pipeline. Cost: ~30 PR
runs for the Wave 1 stack vs 4 with the filter; cheap insurance
against shipping a regression that only surfaces post-merge.

`push:` triggers keep their branch filter — we only care about
`main`/`master`/`develop` for push events (PR coverage is the
contract for everything else).

`integration-smoke.yml` (heavier suite, cron-driven) doesn't gate
PRs — leave it alone.

## When to revisit

If we ever onboard external contributors whose PRs we don't want to
spend CI on, restore the `branches:` filter and rely on
`workflow_dispatch` for the wave-1-style stacked chains. Until then,
the simpler "run on everything" rule wins.

## Verification

After this change lands, push a tiny commit to any stacked
wave-1/* branch and check the PR — both CI and Build Test workflows
should report runs. If they don't, the filter wasn't fully removed.
