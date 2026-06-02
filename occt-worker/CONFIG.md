# occt-worker — build & deploy wiring

How `occt-worker/occt-worker.js` gets to the browser as
`/occt-worker/occt-worker.js`.

## Phase 4 (today): manual copy

Next.js serves anything inside `public/` at the root URL, so the worker
file needs to live at `public/occt-worker/occt-worker.js`. Until we have
a real OCCT binary that benefits from a build step, we keep the stub in
this repo at `occt-worker/occt-worker.js` and copy it into `public/`:

```bash
mkdir -p public/occt-worker
cp occt-worker/occt-worker.js public/occt-worker/occt-worker.js
```

Run that any time you edit the stub. Yes, it's a manual step — it is
INTENTIONALLY manual at this phase:
- The file is ~10 KB, hand-maintained, and changes rarely.
- An automated copy hook would also have to know about `occt.wasm`,
  source maps, threaded variants, etc. — none of which exist yet. Adding
  that pipeline now and ripping it out for Phase 5 is wasted motion.
- Next.js does NOT serve files from arbitrary repo subdirectories — only
  `public/`. So we cannot just point the worker URL at `/occt-worker/…`
  without the copy. (We deliberately do NOT change `next.config.ts` to
  add an alias; the alias would mask the missing-file error in dev.)

The bridge in `src/lib/occt/wasmBridge.ts` defaults to
`'/occt-worker/occt-worker.js'`. If the copy is missing, the browser
console shows a 404 and the init handshake times out after 30 s — that
is the intended failure mode. Tests run against the in-process stub from
`src/lib/occt/wasmWorkerStub.ts` and do not depend on the copy.

## Phase 5: real OCCT build

When the OCCT 7.8 + Emscripten build lands, replace the manual copy
with a build script:

1. Add a dev dependency on the `occt-emscripten` tarball (built in a
   separate repo — see `occt-worker/README.md` § "Binary plan").
2. Add an `npm` script:
   ```json
   "scripts": {
     "occt:install": "node scripts/install-occt-worker.mjs"
   }
   ```
   That script copies `node_modules/occt-emscripten/dist/*` (worker.js,
   `occt.wasm`, `occt-bindings.js`, source map) into
   `public/occt-worker/`.
3. Wire it into `prebuild`:
   ```json
   "scripts": {
     "prebuild": "npm run occt:install"
   }
   ```
   Next.js calls `prebuild` before `next build`, so Vercel/Railway/Docker
   builds pick up the worker bundle automatically.
4. Keep `public/occt-worker/` in `.gitignore` from that point on — it is
   build output, not source.

We do NOT use a webpack/Turbopack rule to bundle the worker through
the main Next pipeline. The OCCT binary is huge (5–15 MB), structured
for `importScripts`, and Webpack's worker-loader path has historically
caused MIME-type and self-reference bugs with Emscripten output. Serving
the raw file from `public/` is the boring, reliable choice.

## Why not just put it in `public/` directly?

We considered it. Two reasons we kept the source in `occt-worker/`:

1. The Phase 5 build output overwrites this file. Keeping the
   hand-written stub in `public/` means a build step deletes it; keeping
   it in a sibling directory means the stub survives until we
   intentionally retire it.
2. The README + Phase 5 wishlist live next to the file — putting only
   the file in `public/` would scatter the related docs.

## Verifying the copy

```bash
# from repo root
ls -la public/occt-worker/
# expected: occt-worker.js
diff occt-worker/occt-worker.js public/occt-worker/occt-worker.js
# expected: no output (files identical)
```

If you change `occt-worker/occt-worker.js`, repeat the copy. CI does
NOT enforce this today — the Phase 5 prebuild script will.
