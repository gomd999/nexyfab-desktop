# e2e/occt — Real OCCT WASM Playwright Suite

Phase 5 launch step 11 scaffold (Agent — Playwright e2e).

## Why this is separate from `vitest`

`src/lib/occt/wasmReal.placeholder.test.ts` documents the same acceptance
criteria but runs under Vitest's `node` env — it can never instantiate the
~65 MB `opencascade.wasm` because Emscripten's fetch path requires a browser
Worker. This suite is the browser-side counterpart.

## Files

- `wasm-real.spec.ts` — three tests:
  - **opencascade.js loads and builds unit box** — booted via `Module()` in
    a real page context, then runs the `MakePolygon → MakeFace → MakePrism`
    sequence that `wasmReal.buildFromExtrude` documents.
  - **STEP roundtrip via real OCCT** — verifies the
    `STEPControl_Writer_1` / `STEPControl_Reader_1` symbols are bound. The
    full export/import roundtrip lives in `occt-worker/occt-worker-real.js`
    and is exercised by the M1 STEP roundtrip vitest suite.
  - **cylinder revolve via real OCCT** — `BRepPrimAPI_MakeCylinder_2` smoke
    to prove revolve-family primitives are bound.

## Gates

The suite skips itself unless **BOTH** are true:

1. Env: `NEXYFAB_OCCT_REAL=1`
2. Server: `GET /api/occt/diagnostic` reports `mode === 'wasm'`

The diagnostic endpoint (`src/app/api/occt/diagnostic/route.ts`) checks that
`public/occt-worker/opencascade.wasm` exists and is ≥ 1 MB. Run
`npm run occt:copy` to stage the binary before running the suite.

## How to run locally

```bash
# 1. Stage the OCCT WASM into public/ (one-time per checkout)
npm run occt:copy

# 2. Start dev server (Playwright will reuse if already running)
npm run dev

# 3. Smoke test only (fast — just the unit-box test)
npm run test:occt:smoke

# 4. Full suite
npm run test:e2e:occt
```

If `NEXYFAB_OCCT_REAL=1` is not set, every test is `test.skip()` — you'll see
3 skipped, 0 passed, 0 failed. That's intentional: the suite stays inert on
default branches until the binary is wired into the deploy.

## How to run in CI

Add to the relevant workflow step (typically the nightly job, not PRs):

```yaml
- name: OCCT real WASM e2e
  env:
    NEXYFAB_OCCT_REAL: '1'
  run: |
    npm run occt:copy
    npm run build
    npm run test:e2e:occt
```

**Recommendation:** Gate this on a label (`needs-occt-e2e`) or a schedule
trigger rather than running on every PR. The 65 MB WASM doubles CI artifact
size and adds ~30–60 s of cold init per worker.

## Wiring with `playwright.config.ts`

The repo-level `playwright.config.ts` uses `testDir: './e2e'`, so this
sub-directory is discovered automatically — no config changes needed. The CI
project (`chromium`) inherits the launch args that work around the WebGL
swiftshader requirement.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Suite reports "skipped" with `mode=stub` | `opencascade.wasm` not staged | `npm run occt:copy` |
| Suite reports "skipped" with `mode=wasm-stub` | Loader present but WASM truncated | Re-run `occt:copy`, check `/api/occt/diagnostic` for `sizeBytes < 1_000_000` |
| `Module() timed out after 90s` | WASM stream blocked by CSP `wasm-eval` denial | Confirm dev `next.config.ts` does NOT inject a CSP for this route; static assets under `/occt-worker/` should be served unrestricted |
| `loader script failed` | `/occt-worker/opencascade.js` 404 | `occt:copy` only copies the `.wasm`. Verify the `.js` glue file is also present under `public/occt-worker/` |

## Pinned references

- `src/lib/occt/wasmReal.ts` — typed wrapper around the Embind module.
- `src/lib/occt/wasmReal.placeholder.test.ts` — vitest mirror of these tests.
- `occt-worker/occt-worker-real.js` — production dispatcher that runs the
  same call path inside a real Worker.
- `occt-worker/PHASE_5_INTEGRATION.md` — per-op call site table.
