# Precision CAD verification

Run the focused, bounded regression set:

```powershell
node workspaces/precision-cad/verify.mjs
```

Run all tests under the owned CAD roots with a 15-minute hard limit:

```powershell
node workspaces/precision-cad/verify.mjs --all
```

Blocking reference-part findings fail by default. Investigation runs may retain
the old report-only behavior explicitly, but their result is not a release pass:

```powershell
node workspaces/precision-cad/verify.mjs --all --report-findings
```

Override the per-group timeout between one and thirty minutes with
`NEXYFAB_PRECISION_TEST_TIMEOUT_MS`. Integration CI should call this runner from
the Precision CAD path-filtered job so a hung Vitest process cannot consume an
unbounded runner.
