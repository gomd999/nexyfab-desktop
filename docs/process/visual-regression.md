# Visual Regression (3D Viewport)

**Status:** PoC (Wave 0 Day 6) · **Adopted:** 2026-05-26

3D content has sources of non-determinism (GPU vs SwiftShader, AA dithering,
async OCCT init) that make naive pixel-perfect diff useless. This runbook
documents the tolerance strategy and the workflow to grow the snapshot
catalog without baseline thrash.

## What's wired

- `e2e/visual-regression-3d.spec.ts` — one PoC scenario: default cube on the
  shape-generator page.
- Playwright config (`playwright.config.ts`) already includes
  `--enable-unsafe-swiftshader` for CI so WebGL works headless.
- Tolerances:
  - `maxDiffPixelRatio: 0.005` — 0.5% pixel count allowed to differ.
  - `threshold: 0.2` — per-pixel color tolerance for AA/gamma.
  - Settle delay 1500ms before snapshot.
  - Animations disabled, blinking elements hidden via injected CSS.

## Workflow

### Adding a new scenario

1. Pick the diff-bearing state — e.g., "after a boolean cut" or "after a
   fillet on an edge". Same state must be reachable deterministically from
   page load (no manual clicks during the test).
2. Write a new `test()` in `e2e/visual-regression-3d.spec.ts` (or a sibling
   spec). Navigate to the state, settle, screenshot.
3. Generate the baseline:
   ```bash
   npm run dev     # one terminal
   npx playwright test e2e/visual-regression-3d.spec.ts --update-snapshots
   ```
4. Inspect the generated `*.png` in
   `e2e/visual-regression-3d.spec.ts-snapshots/` — does it actually look
   right? If yes, commit it. If no, fix the test setup, not the baseline.
5. Push to CI. The baseline must produce the same image on the CI machine
   too. If CI fails first run, GPU difference; tune tolerances.

### Investigating a failure

1. Look at the Playwright report (HTML). Each failed snapshot shows
   side-by-side: baseline / actual / diff highlighted.
2. Decide: is the diff a **regression** (something broke) or **intended
   update** (UX/lighting/feature changed)?
3. If regression: fix the code, re-run, the test should pass.
4. If intended: update the baseline:
   ```bash
   npx playwright test e2e/visual-regression-3d.spec.ts --update-snapshots
   ```
   Then commit the new `*.png` together with the code change that justified
   it. The commit message should explain the intent.

### When the diff is noisy unrelated to the test

If a baseline keeps flapping (passes locally, fails CI; or alternates):

- Bump `maxDiffPixelRatio` to 0.01 (1%) before considering deeper fixes.
- If still flaky, the underlying render is non-deterministic. Either:
  - Pin a fixed lighting setup in the test (`addInitScript` to force
    preset).
  - Switch to a smaller `clip` so only the deterministic region is
    compared.
  - Last resort: skip the test in CI (`test.skip(({ browserName }) =>
    browserName !== 'chromium')`) with a TODO comment.

## CI integration (deferred to Wave 1)

The PoC is intentionally not in CI yet — the snapshot needs to be generated
on the CI machine to avoid local↔CI font/driver diffs. Once the staging env
is up (Wave 0 Day 3 runbook), run:

```bash
# On staging deploy:
npx playwright test e2e/visual-regression-3d.spec.ts --update-snapshots
git add e2e/visual-regression-3d.spec.ts-snapshots/*.png
git commit -m "test(visual): baseline 3D viewport snapshots from staging"
```

Then add a CI job in `.github/workflows/ci.yml`:

```yaml
visual-regression:
  needs: build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci --legacy-peer-deps
    - run: npx playwright install chromium
    - run: npx playwright test e2e/visual-regression-3d.spec.ts
```

Failures upload the diff PNG as an artifact so review is one click.

## What this catches (and doesn't)

**Catches:** silent visual regressions — a default lighting change, a
material upgrade that mutes a feature, a fillet that renders as a hard
edge after a B-rep change.

**Misses:** anything that re-renders identically but is semantically
wrong (wrong dimensions, wrong topology). Those are caught by
`geometry-invariants.ts` (Day 5) and the property-based tests (Day 6).

These three layers are complementary, not redundant.
