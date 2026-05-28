# Wave 2 — Phase 2 · Configurations (Parametric Family of Parts) — Design Spec

**Status:** design / spec — NO implementation in this doc
**Date:** 2026-05-28
**Author:** wave-2 phase-2
**Risk tier:** P1 (data model + pipeline coupling)
**Related:**
  - `docs/wave-2-crdt-architecture.md` (CRDT envelope this slots into)
  - `docs/wave-2-soak-runbook.md` (perf budgets we must respect)
  - ADR-010 (Wave 2 B-Full + collab)
  - Wave 1 nfab schema (v2)

## Purpose

A SolidWorks/Onshape part rarely ships alone — production needs **the same
design at multiple sizes / materials / variants**. A single bolt design with
M3/M4/M5/M6 sizes is one part-file; a clamshell with "open / closed" states
is one part-file; a bracket with "steel / aluminum / heavy-duty" variants is
one part-file. NexyFab already has the *skeleton* of this concept (the
`NfabConfigurationV1` schema, a `ConfigurationTable.tsx` Excel-grid panel, and
an unused `ConfigurationManager` class). Phase 2 is about **wiring it through
the pipeline** so switching a configuration actually changes the geometry,
and **exporting families** so a single `.nfab` produces N STEP files.

This document is **design only**. No source files are modified by this doc;
only the document at `docs/wave-2-phase-2-configurations-spec.md` is produced.
Implementation lands in Wave 2 Phase 2 weeks 1–4, on PRs that reference this
spec.

---

## 1. Current Implementation Audit

### 1.1 What exists today

Configurations have been touched **three separate times** with no consolidation,
leaving the codebase with three parallel models that do not talk to each
other. This is the most important finding in this audit.

#### A. `NfabConfigurationV1` (file format — the canonical one)

`src/app/[lang]/shape-generator/io/nfabFormat.ts:167`

```ts
export interface NfabConfigurationV1 {
  id: string;
  name: string;
  params: Record<string, number>;
  paramExpressions?: Record<string, string>;   // serialized but never resolved at apply time
  featureEnabled: Record<string, boolean>;     // history-node id → enabled
}
```

- Round-trips through `.nfab` save/load (v1 + v2 supported).
- `normalizeConfigurations` (`nfabFormat.ts:505`) drops malformed entries
  silently — good for forward-compat, bad for tooling visibility.
- Top-level fields on `NfabProjectV1`: `configurations?` and
  `activeConfigurationId?` (string | null).

#### B. `ConfigurationManager` (runtime class — DEAD CODE in host)

`src/app/[lang]/shape-generator/config/configurationManager.ts`

- Rich runtime model: parent inheritance chain, per-feature param overrides,
  per-feature suppression, cycle detection, `applyConfig(features)` re-projector.
- Backed by `Map<id, Map<key, value>>` — not directly serializable.
- Tested (`configurationManager.test.ts`, 11 tests pass).
- Pipeline integration **exists** at the seam:
  `applyFeaturePipelineDetailed → applyFeatureContext → configManager.applyConfig()`
  (see `features/index.ts:106`, `featureContext.ts:51`).
- BUT `useConfigurationManager()` is **never called from
  `ShapeGeneratorInner.tsx`** (verified by grep). So `getConfigurationManager()`
  always returns `null` in the host. The override path is dead code in
  production.

#### C. `multiConfigPartVariant.ts` (third, separate API)

`src/app/[lang]/shape-generator/assembly/multiConfigPartVariant.ts`

- Same domain, different data model
  (`PartModel { features, parameters, configurations }`).
- Has features A & B lack: `diffConfigs`, `validateModel`, `summarize`.
- Used **only by its own test**. Not wired to UI, pipeline, or file format.

#### D. UI panels

- **`config/ConfigurationPanel.tsx`** — list + add/remove + activate, hooked
  to ConfigurationManager class (B). Not referenced by `ShapeGeneratorInner`.
- **`panels/ConfigurationTable.tsx`** — Excel-style grid, hooked to
  `NfabConfigurationV1` array (A). This is the one the host shows
  (`showConfigurationTable` flag, F5 keyboard shortcut). i18n: ko/en/ja/zh/es/ar.
  Supports inline numeric param edit, suppress toggle (✓/·), CSV export.

#### E. Host integration (`ShapeGeneratorInner.tsx:1382–1483`)

```ts
const [configurations, setConfigurations] = useState<NfabConfigurationV1[]>([]);
const [activeConfigurationId, setActiveConfigurationId] = useState<string | null>(null);
```

- `handleConfigurationSelect` (problematic — see §5): writes config values
  into `sceneStore.params` and calls `updateNode(nodeId, { enabled })` for
  each `featureEnabled` entry. **Mutates the master tree.**
- `handleConfigurationAdd` snapshots **current** sceneStore params + node
  enabled flags into a new config row.
- Auto-purge: if design tree collapses to 1 node, configs are dropped (line 1473).

### 1.2 Gap matrix — what works, what doesn't

| Capability | Schema (A) | Runtime (B) | Variant API (C) | Host wired? |
|---|---|---|---|---|
| Persist to `.nfab` | yes (v1 + v2) | no | no | yes |
| Parent inheritance | no | yes | yes | **no** |
| Per-feature param override | no (only global params) | yes | yes | **no** |
| Feature suppression | yes (`featureEnabled`) | yes | yes | yes |
| Param expression (string formula) | yes (`paramExpressions`) — **serialized only** | no | no | **partial** (saved, never resolved) |
| Pipeline re-apply on activate | no (mutates scene params) | yes (would be) | no | **no** (B not wired) |
| Excel-grid UI | yes | no | no | yes |
| CSV export | yes | no | no | yes |
| STEP family export (zip) | no | no | no | no |
| Cycle detection | n/a | yes | yes | n/a |
| Diff between configs | no | no | yes | no |
| CRDT-friendly storage | n/a (JSON snapshot OK) | **no** (Maps) | **no** (Maps) | n/a |

**What works end-to-end today:** A user can open the ConfigurationTable, add a
row, edit numeric params and suppress flags, save the `.nfab`, reload it, and
the table re-appears. Activating a row changes `sceneStore.params` (which is
the *legacy* per-base-shape parameter table, e.g. radius/height/width on a
cylinder primitive), and toggles `node.enabled` on history nodes.

**What does NOT work:**

1. **Per-feature param overrides** — the schema's `params` field is a flat
   `Record<string, number>` shared across all features, not keyed by
   `featureId`. A config cannot say "for feature `f1` set radius=5, for `f2`
   set radius=8". You can override the base-shape param `radius` once, period.
2. **Expression evaluation in configurations** — `paramExpressions` exists in
   the schema and is preserved through save/load (`nfabFormat.ts:525`), but
   `handleConfigurationSelect` copies it into `sceneStore.paramExpressions`
   verbatim; there is no integration with EquationManager when the active
   config switches.
3. **Parent inheritance** — schema has no `parentId`. Two configs cannot
   share a base.
4. **Family-of-parts export** — there's no "export all configs as N STEP
   files" path. Single-config STEP export already works.
5. **Real-time multi-user** — `configurations` is a vanilla React `useState`;
   not in a Y.Doc, not CRDT-compatible. Diff-and-replace edits will conflict.

### 1.3 Three parallel implementations — Phase 2 consolidates

A was added first (file format slot); B and C are abandoned runtime
explorations. **Phase 2 deletes B and C; the new ConfigurationTable class
is the single runtime backed by A's schema.**

---

## 2. Configuration Concept (Phase 2 Target)

A **Configuration** is a named overlay on the master feature tree. Given:

- **Master part** = the feature tree as authored (sketch → extrude →
  fillet → hole → …), with each feature carrying default params.
- **N Configurations** = a list of named variants, each holding **only the
  delta** from the master (or from a parent config).
- **Active config** = the one currently rendered. There is always exactly
  one active config (or `null` = "master, no overlay"). `activeConfigurationId`
  is persisted.

Each config holds:

- **Feature param overrides** — `{ featureId → { paramKey → expression-or-number } }`
- **Suppress flags** — `{ featureId → suppressed: boolean }`
- **Expression variables** — `{ varName → expression-or-number }`, scoped
  to this config; overlays the global EquationManager table.
- **Parent reference** (optional) — `parentId`; child config inherits all of
  the parent's deltas, then layers its own on top.

The "master" itself is not a config — it's the union of all feature defaults
in the tree. This avoids a "master must always exist" sentinel row.

---

## 3. Data Model Extension

### 3.1 Schema bump — `NfabConfigurationV2`

Bump `.nfab` to **v3** (current is v2). Migration: v2 → v3 lifts each existing
`NfabConfigurationV1` into the new shape, preserving `params` as a single
"global" override block keyed by the synthetic id `"__scene_params__"`.

```ts
// nfabFormat.ts — additions

export interface NfabConfigurationV2 {
  id: string;
  name: string;
  isDefault?: boolean;          // marks the "newest user-intent" config; ≤1 per file
  parentId?: string;            // derived configs (Onshape "variation")

  /** Per-feature param overrides. Value is either a literal number or a
   *  string expression (resolved via Expression Engine + globalVars + expressionVars). */
  overrides: Record<string, {
    params?: Record<string, number | string>;
    suppressed?: boolean;
  }>;

  /** Config-scoped variables. Shadow ConfigurationTable.globalVars and the
   *  EquationManager table when this config is active. */
  expressionVars: Record<string, number | string>;

  /** v1 legacy fields preserved for migration round-trip (read-only after v3) */
  legacyParams?: Record<string, number>;
  legacyParamExpressions?: Record<string, string>;
}

export interface NfabConfigurationTableV1 {
  configs: NfabConfigurationV2[];
  activeConfigId: string | null;
  /** Cross-config shared vars (overrides global EquationManager when set). */
  globalVars: Record<string, number | string>;
}

export interface NfabProjectV3 extends Omit<NfabProjectV1, 'configurations' | 'activeConfigurationId'> {
  version: 3;
  configurationTable?: NfabConfigurationTableV1;
}
```

**Why not Maps?** JSON-serializable plain objects round-trip without custom
reviver/replacer and are directly representable as `Y.Map` keys for CRDT
phase (§9).

**Why string-or-number for param values?** A config that says
`radius: '<<bolt_diameter>> * 0.5'` requires lazy resolution. Configs that
say `radius: 5` (literal) skip the parser entirely (fast path). The
EquationManager (`equationManager.ts:156`) already implements this
number-or-string union (`resolveFeatureParams`) — we reuse it.

### 3.2 v2 → v3 migration

`migrateV2ToV3` lifts each `NfabConfigurationV1` into the new shape:
`featureEnabled[id] = false` → `overrides[id] = { suppressed: true }`;
`params` and `paramExpressions` are preserved in `legacy*` fields (read-only,
stripped only when the user explicitly edits an override in v3 mode). The
old `configurations` / `activeConfigurationId` top-level fields move under
`configurationTable`. Migration is **idempotent** and **non-lossy**.

### 3.3 Runtime model

New `ConfigurationTable` class
(`src/app/[lang]/shape-generator/config/configurationTable.ts`) replaces B+C.
Key surface:

```ts
class ConfigurationTable {
  add/remove/get/list(...)
  activate(id: string | null)
  setOverride(configId, featureId, params: Record<string, number | string>)
  setSuppressed(configId, featureId, suppressed: boolean)
  setExpressionVar(configId, name, value)
  setGlobalVar(name, value)
  resolveActive(features, equationManager): FeatureInstance[]    // hot path
  toJSON() / static fromJSON()
}
```

`resolveActive` is the function that closes the loop (§5).

---

## 4. Feature Param Expression

The single biggest win in Phase 2 is letting a feature param be a formula
instead of a constant.

### 4.1 Syntax

We have **two** expression engines today:

- `ExpressionEngine.ts` (recursive-descent, used by sceneStore params)
- `assembly/positionDrivers.ts` (also recursive-descent, used by EquationManager)

These are duplicate. Phase 2 picks **one** (positionDrivers — it's already
the EquationManager backend) and deletes the other. ExpressionEngine usages
migrate.

Expression syntax:

- Literal: `5`, `3.14`, `-2.5`
- Variable reference: `bolt_diameter`, `thickness`, `scale`
- Operators: `+`, `-`, `*`, `/`
- Grouping: `(`, `)`
- Functions: `sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `pow` (already
  supported by positionDrivers)
- **No** function definition, no conditionals, no string ops — pure numeric.

The `<<…>>` syntax mentioned in the request is **rejected**. Reasons:

- The existing parser already treats bare identifiers as var refs
  (`thickness * 4`), so `<<thickness>> * 4` is redundant.
- `<<` and `>>` would collide with future bit-shift operators if we ever
  expand the grammar.
- All real CAD systems (Onshape, SolidWorks, Fusion) use bare identifiers,
  so user intuition matches.

### 4.2 Resolution order

When the pipeline asks for a feature's effective param:

1. **Start with the feature's declared default** (e.g., `params: { radius: 5 }`
   in the feature instance — set at feature-creation time).
2. **Apply parent-chain overrides** (root config first, child last).
3. **Apply active config's overrides** for this feature.
4. **Substitute variables** in any remaining string expressions, using
   (in priority order):
   - **Active config's `expressionVars`** (highest priority — shadows globals)
   - **`ConfigurationTable.globalVars`**
   - **EquationManager global variables** (lowest — fallback)
5. **Evaluate** the resulting AST → number.
6. **NaN handling** — if any var is missing or expression is malformed, the
   param is `NaN`; the existing feature diagnostic system
   (`featureDiagnostics.ts`) already surfaces NaN as a feature error.

Resolution is **per pipeline run**, not on every param read — we cache the
resolved feature list (§7) keyed by `(activeConfigId, configurationTable.toJSON()-hash, equationManager.toVarTable()-hash)`.

### 4.3 Cycle detection

Two cycle dimensions:

- **Parent chain** — `A.parentId = B`, `B.parentId = A`. Reuse
  `multiConfigPartVariant.hasCycle` algorithm in the new ConfigurationTable.
- **Expression dep graph** — `globalVars.A = 'B + 1'`, `globalVars.B = 'A * 2'`.
  Already handled by EquationManager's `wouldCycle` (`equationManager.ts:183`).
  Phase 2 wraps `setGlobalVar` / `setExpressionVar` in the same check.

Both checks **refuse the edit** rather than detect-on-eval — failing at the
UI level (toast: "would create a cycle") is much friendlier than NaN'ing the
pipeline.

---

## 5. Config Switch Flow

User clicks "M4" in the ConfigurationTable. What happens:

```
[User] click M4
   ↓
useUIStore.setActiveConfigurationId('m4')
   ↓
ConfigurationTable.activate('m4')
   ↓                                       (also: emit y-doc transact in §9)
sceneStore subscribers wake               (legacy params — keep for back-compat)
   ↓
pipelineManager re-evaluates:
  features      = useFeatureStack.getOrderedNodes()
  resolved      = ConfigurationTable.resolveActive(features, equationManager)
                = features
                    .filter(f => !suppressed[f.id])
                    .map(f => ({
                      ...f,
                      params: substituteAndEval(f.params, overrides[f.id], vars)
                    }))
   ↓
runPipeline(baseGeometry, resolved, FEATURE_MAP)
   ↓
viewport BufferGeometry update + thread/hole callouts re-derived
```

**Key invariants:**

- The master feature tree (`useFeatureStack`) is **never mutated** by a
  config switch. Only the *derived* feature list passed to the pipeline
  changes. This is the single most important architectural rule — without it,
  switching back to "master" loses the user's authored values.
- The current `handleConfigurationSelect` violates this rule
  (`ShapeGeneratorInner.tsx:1404–1420`): it writes config values into
  `sceneStore.params` and calls `updateNode(nodeId, { enabled })`. Phase 2
  must **remove these mutations** and instead route the pipeline through the
  ConfigurationTable. (Migration risk: §13 — files saved with active config
  ≠ master may have already had the master polluted; we can't fully recover.)
- `applyFeatureContext` is the existing seam — we extend it, not replace it:

  ```ts
  // featureContext.ts — Phase 2 shape
  export function applyFeatureContext(features: FeatureInstance[]): FeatureInstance[] {
    let out = features;
    if (configurationTable) {                                  // NEW (was: configManager)
      out = configurationTable.resolveActive(out, equationManager);
    } else if (equationManager) {                              // fallback when no configs
      out = equationManager.resolveFeatures(out);
    }
    return out;
  }
  ```

  Note: `configurationTable.resolveActive` now does its own expression resolve
  via the passed `equationManager`, so the `else if` covers the no-config case.

### 5.1 In-progress edit handling

Mid-edit on a numeric input when user switches config: **discard** the
pending value (`blur()` the active element from the switch handler).
Reason: auto-commit would apply the new value to the wrong (about-to-become-active)
config — surprising. Toast: "Switched to M4 — unsaved edit discarded" (ko/en/ja/zh/es/ar).

---

## 6. Suppress Feature in Config

Already half-implemented today (`featureEnabled: Record<string, boolean>`).
Phase 2 just **promotes** it from "global" to "per-config override":

```
For each feature f in tree:
  effective_enabled =
    if active config has overrides[f.id].suppressed defined:  !overrides[f.id].suppressed
    elif parent chain has it:                                 !inherited
    else:                                                     f.enabled  (master default)
```

**Example:** "Heavy Duty" config replaces a chamfer (master default) with a
fillet. Two overrides in one config:

```ts
{
  id: 'heavy_duty',
  name: 'Heavy Duty',
  overrides: {
    'chamfer-001': { suppressed: true },
    'fillet-001':  { suppressed: false, params: { radius: 6 } },
  },
  expressionVars: {},
}
```

The master tree has both features present. The chamfer is suppressed unless
this config is active; the fillet is added to the tree but starts
`suppressed: true` in the master, then this config un-suppresses it.

### 6.1 Adding "config-only" features

A feature that exists only in some configs is added to the master tree with
`enabled: false` (suppressed by default), then un-suppressed only in the
configs that need it. This keeps the master tree as the union of all features
across configs.

---

## 7. UI: Configuration Table

The existing `ConfigurationTable.tsx` is the foundation. Phase 2 changes:

### 7.1 Layout

- **Rows = configs** (current: same).
- **Columns:**
  - Name (input, current).
  - For each feature in master tree, a column showing the feature's
    overrideable params **and** suppress toggle as compact sub-grid.
  - "+" column at right.
- Excel-grid feel preserved; current row-height + 11px font kept.

### 7.2 Cell interactions

- Click a cell with a **literal number**: opens inline number input
  (current behavior).
- Type a **non-numeric** value (e.g., `bolt_d * 0.5`): we now store as
  string expression. Cell renders the expression dimmed + the computed value
  in bright. Tooltip shows full expression on hover.
- **Suppress** toggle stays as the current ✓/· button.

### 7.3 New affordances

- **Active row indicator** — current dot stays.
- **Parent indicator** — small "↑ Parent" chip next to the name input, with
  a dropdown to pick a parent (other configs only; cycle-protected).
- **Variable panel toggle** (Phase 2 add) — collapsible side panel showing
  `globalVars` (table-wide) and active config's `expressionVars` (config-scoped).
- **"Family Export" button** — opens dialog (§8).

### 7.4 i18n keys (new strings, ko canonical)

| key | ko | en | ja | zh | es | ar |
|---|---|---|---|---|---|---|
| `config.parent` | 부모 구성 | Parent | 親構成 | 父配置 | Padre | الأصل |
| `config.variants` | 변형 | Variants | 変種 | 变体 | Variantes | المتغيرات |
| `config.expressionVars` | 표현식 변수 | Expression vars | 式変数 | 表达式变量 | Variables de expresión | متغيرات التعبير |
| `config.globalVars` | 전역 변수 | Global vars | グローバル変数 | 全局变量 | Variables globales | متغيرات عامة |
| `config.familyExport` | 패밀리 내보내기 | Family Export | ファミリーエクスポート | 系列导出 | Exportar familia | تصدير العائلة |
| `config.cycleError` | 순환 참조 — 부모 변경 거부 | Cycle — parent rejected | 循環参照 — 親拒否 | 检测到循环 — 父级被拒 | Ciclo detectado | تم اكتشاف دورة |

Add to the existing `dict` object in `ConfigurationTable.tsx`. ko is canonical
per the user's i18n policy.

### 7.5 Performance

- Wave 2 perf budget (`wave-2-soak-runbook.md`): UI ≤ 16ms p95 for ≤ 1000
  cells, ≤ 50ms for ≤ 5000.
- Phase 2: virtualized rows (`react-window`, already in package.json).
  Columns bounded by master tree depth (≈ 20–50 features) — no col virt.
- Above 100 configs: switch to "summary view" (diff-from-parent only).

---

## 8. Family of Parts Export

A single `.nfab` represents N configurations → export should be able to emit
N artifacts in one batch.

### 8.1 STEP family export (zip)

Trigger: "Family Export" button in ConfigurationTable.

```
[Click Family Export]
  ↓
dialog: which configs?  □ active only  ☑ all  □ selected (multi-select grid)
        format:          ☑ STEP  □ STL  □ both
        filename pattern: {project}_{config}.step          (default)
        units:            mm                                (read-only, from project)
  ↓
[Generate]
  ↓
for each selected config:
  ConfigurationTable.activate(cfg.id)
  result = applyFeaturePipelineDetailedAsync(baseGeometry, features)
  stepBytes = await exportStepFromGeometry(result.geometry)
  zip.add(`${pattern.replace('{config}', cfg.id)}.step`, stepBytes)
ConfigurationTable.activate(originalActiveId)   // restore
zip.add('manifest.json', { configs: [...], generatedAt, project })
download(zip, `${project}_family.zip`)
```

- **Progress** — toast with progress bar; per-config status (10/24 done).
- **Cancellation** — `AbortController` passed through; on cancel, partial
  zip is discarded (no half-zips).
- **STEP gate** — uses existing `canExportStepCleanly()` per config; if any
  config fails, dialog shows "12/24 configs would export; 12 have errors —
  [download partial / fix errors / cancel]".
- **Resource budget** — Wave 2 soak says STEP export ≤ 4s p95 for medium
  parts; 50-config family ≈ 3.5 min. Above 50 configs we throttle to a
  Web Worker pool of 3 concurrent (memory safety; OCCT is large).

### 8.2 Configuration table → CSV (BOM integration)

The existing `exportConfigurationsCsv` (`ConfigurationTable.tsx:293`)
generates a flat config × param × suppress matrix. Phase 2 adds:

- A **second CSV** ("BOM CSV") that includes: config id, name, computed
  mass (g), volume (cm³), bounding box, materials, all parent-chain
  metadata. Wire to the existing `bomParts` machinery in `ShapeGeneratorInner`
  so a designer can do "Export → Family BOM" and hand it to procurement.

---

## 9. CRDT Integration (Wave 2 collab)

Per `wave-2-crdt-architecture.md`, all mutable design state is migrating to
Y.Doc. Configurations are a clean candidate because edits are mostly
non-conflicting (different users editing different configs).

### 9.1 Y.Doc structure

```
yDoc
├── tree           Y.Map<HistoryNode>             (already planned, sketch §1.2 of CRDT spec)
├── sketch         Y.Map<...>                     (already planned)
├── assembly       Y.Map<...>                     (already planned)
└── configs        Y.Map<configId, Y.Map<...>>    (Phase 2 — new)
                      ├── meta:  Y.Map<{ name, parentId, isDefault }>
                      ├── overrides: Y.Map<featureId, Y.Map<{ params: Y.Map, suppressed: boolean }>>
                      └── expressionVars: Y.Map<string, string | number>

yDoc.getMap('configTableMeta')                    (top-level)
  ├── activeConfigId: string | null
  └── globalVars: Y.Map<string, string | number>
```

### 9.2 Conflict surface

| Operation | Conflict? | Resolution |
|---|---|---|
| User A edits config X param, User B edits config Y param | none | both apply |
| Two users edit same param of same config | yes | Yjs LWW on Y.Map value |
| User A activates config X, User B activates config Y | yes | Yjs LWW on `activeConfigId` (last write wins — the UI re-renders to whoever wrote last) |
| User A deletes config X, User B edits config X | yes | edit on tombstoned map is dropped (Yjs default); user B sees "config gone" toast |
| User A changes config X parent to Y, User B changes X parent to Z | yes | LWW on `parentId`; cycle re-checked on each merged state — if cycle detected, **the loser's edit is auto-reverted** (Y.Map can't refuse a write, so the cycle-validator runs on next observe and re-writes the safe value, broadcasting the correction) |

The cycle-recovery branch is the only tricky one. It's idempotent: if both
clients converge to the same "safe" `parentId` (the one that does NOT create a
cycle, picked deterministically by lexicographic order), no further writes.

### 9.3 Transaction granularity

A single user-level edit (e.g., "set override M4.radius = 4") is wrapped in
one `yDoc.transact(() => { … })`. This guarantees other users see the edit
as a single atomic event — no half-applied state where the param key exists
but the value hasn't arrived.

### 9.4 Local-first

Pre-CRDT and post-CRDT, the UI reads from the same `ConfigurationTable`
class. The class accepts either a vanilla in-memory backing store or a
Y.Map-backed store via dependency injection:

```ts
class ConfigurationTable {
  constructor(private store: ConfigStore) {}      // interface, vanilla or Y-backed
}
```

This is the same pattern `wave-2-crdt-architecture.md §2.2` proposes for the
feature tree, and keeps non-collab single-user mode (offline `.nfab` editing)
fast.

---

## 10. Worker API: Client- vs Server-side Resolution

Configurations interact with the OCCT worker
(`occt-worker/`, `occt-collab-worker/`). Two architecture choices:

### 10.1 Option A — Client resolves, sends literal params (preferred)

```
client                                            worker
  resolveActive(features, equationManager) ┐
                                            │
  features_with_literal_numeric_params      │ POST /pipeline
  ─────────────────────────────────────────►│
                                            │ runPipeline (OCCT)
                                            │
  geometry  ◄──────────────────────────────┘
```

- **Pros:** worker is stateless wrt configurations; same pipeline endpoint
  serves master and any config; worker doesn't carry an Expression parser;
  matches today's architecture (worker already receives literal params).
- **Cons:** wire payload is N × feature_count param values; for large
  family-export the client sends N pipelines (one per config).

### 10.2 Option B — Server resolves

```
client                                          worker
  POST /pipeline {                              ┐
    masterFeatures: [...],                       │
    configurationTable: {...},                   │  Worker calls
    activeConfigId: 'm4',                        │  resolveActive() internally
    equationManagerSnapshot: {...}               │
  } ─────────────────────────────────────────►  │  runPipeline
                                                 │
  geometry  ◄────────────────────────────────────┘
```

- **Pros:** family export = 1 wire round-trip; worker can cache resolved
  state across configs.
- **Cons:** worker must ship the Expression parser; doubles cycle-detection
  duty; debugging becomes "did client or server get the resolution wrong?";
  larger worker bundle.

### 10.3 Decision: **A** (client-side resolution)

For two reasons:

1. Wave 2 Phase 2 ships in 4 weeks; option A is a pure incremental change
   (extend `applyFeatureContext`). Option B requires Worker schema bump,
   Worker test coverage of the Expression engine, and shared-code packaging
   for the parser.
2. The wire-payload cost of sending N pipeline requests for family export is
   bounded by OCCT export time (4s p95 per config), not network. Network
   overhead is < 1% of total family-export time at N ≤ 50.

If profiling shows wire bottleneck for >50-config exports, we can
back-pressure with Worker-side batching (`POST /pipelineBatch` taking an
array) without changing where resolution happens.

---

## 11. Phase 2 Timeline (4 weeks)

> Single-engineer pace, ½ time on this (the other ½ on Wave 2 Phase 1
> cleanup). Calendar 4 weeks ≈ 80 engineer-hours.

**Week 1 — Data model & migration (≈ 16h)**
- Bump `.nfab` to v3 schema + write `migrateV2ToV3` with fixture round-trip tests.
- Implement `ConfigurationTable` class; port `diffConfigs` / `validateModel`
  from `multiConfigPartVariant` into it.
- Unit tests (30+): cycle, resolution order, suppress inheritance, JSON
  round-trip. ≥ 90% line coverage on the new file.

**Week 2 — Pipeline integration & expressions (≈ 20h)**
- Replace `ExpressionEngine` usages with `positionDrivers` (dedup engines).
- Wire new `useConfigurationTable` into `ShapeGeneratorInner.tsx`; **remove**
  `handleConfigurationSelect`'s scene-store mutation + `updateNode` calls,
  replace with pure `configurationTable.activate(id)`.
- Extend `applyFeatureContext` to call `resolveActive` with expression resolution
  (activeConfig.expressionVars >> globalVars >> equationManager).
- Perf regression test: config switch ≤ 50ms p95 for 30-feature part.

**Week 3 — UI Excel-table & family export (≈ 24h)**
- Refactor `panels/ConfigurationTable.tsx`: cells accept string expressions
  (show expression dimmed + value bright), parent dropdown column,
  `react-window` virtualization at N > 50.
- Add `ExpressionVarsPanel.tsx` (collapsible side panel).
- Family Export dialog + JSZip browser-side zip (JSZip already in deps).
- Per-config `canExportStepCleanly()` with partial-export option.
- CSV BOM export (mass + volume per config). i18n for 6 langs.

**Week 4 — CRDT integration & polish (≈ 20h)**
- `Y-backed ConfigStore` (DI second backend from §9.4).
- Y.Doc subtree migration in `collab/yjsDoc.ts`: legacy `configurations` →
  new `configs` Y.Map structure.
- Multi-client soak: 3 users × 5 configs × 10 min, zero divergence.
  Add to `wave-2-soak-runbook.md`.
- Cycle auto-recovery (CRDT path, §9.2).
- DELETE: `ConfigurationManager`, `ConfigurationPanel.tsx`,
  `multiConfigPartVariant.{ts,test.ts}`, `useConfigurationManager`,
  `useEquationManager` (EquationManager class stays; only the hook is removed
  since `ConfigurationTable` composes it explicitly).
- Update `docs/wave-2-crdt-architecture.md` with config subtree.

### Exit criteria

- All Week-1–4 boxes checked.
- 30+ new unit tests pass; existing test suite still green.
- Manual demo: open a fixture bolt with M3/M4/M5/M6 configs, switch between
  them, geometry updates in < 100ms. Family-export 4 STEP files in zip.
- Soak: 30 min with 3 simulated users, no CRDT divergence.
- `.nfab` v2 → v3 migration round-trip: 6 fixture files, deep-equal post-migration.

---

## 12. Test Fixtures

Six fixture `.nfab` files under `e2e/fixtures/configurations/`:

- **F1 — `bolt_m3_m4_m5_m6_m8.nfab`** — hex bolt master, 5 size configs;
  each overrides `bolt_diameter` (3/4/5/6/8mm); thread reads var via expression.
- **F2 — `bracket_steel_alu.nfab`** — 5mm bracket, 2 material configs
  (Steel uses master, Aluminum overrides thickness=8mm + material metadata).
  Tests: material-as-metadata vs. geometry override.
- **F3 — `clamp_open_closed.nfab`** — jaw clamp; "Open" suppresses
  `jaw-rotation`; "Open-Wide" parent="Open" + un-suppresses & sets 45°.
  Tests: parent chain inheritance of suppression.
- **F4 — `bolt_family_10.nfab`** — 5 sizes × 2 materials cartesian = 10
  configs with parent chains. Validates UI under moderate density.
- **F5 — `bracket_heavy_duty.nfab`** — 3 chamfers in master, 3 fillets
  added with `enabled: false`; "Heavy Duty" suppresses chamfers + un-suppresses
  fillets. Tests: feature default vs. config override interaction.
- **F6 — `bolt_with_cycle_attempt.nfab`** — `globalVars: { d: 'h*0.5', h: 'd*2' }`.
  Loaded file → WARN, one var NaN, cycle indicator in UI.

---

## 13. Edge Cases & Risks

- **13.1 Cycle (expression vars)** — detect on edit (UI refuses) and on
  load (WARN + NaN). No auto-fix.
- **13.2 Switch mid-edit** — `blur()` active input; discard pending value. (§5.1)
- **13.3 Delete config with children** — **inline** the deleted config's
  overrides into each child so effective behavior survives. Confirmation
  dialog explains.
- **13.4 Orphan override** (feature deleted, override remains) — sticky
  banner: "3 orphan overrides in M4 — [Clean up] [Ignore]". No auto-cleanup
  on save (let user see warning first).
- **13.5 Polluted master from pre-v3** — files saved before Phase 2 with an
  active config ≠ master had their master overwritten by
  `handleConfigurationSelect`. **v2→v3 cannot recover** the original
  master. Release notes call this out: "Open + re-save in v3; verify master
  matches your intended baseline."
- **13.6 Large tables (100+)** — virtualize at 100, "diff-only" view at 500,
  hard cap 1000 (load fails with toast — better than degraded UI).
- **13.7 STEP family at scale** — 50 configs × 4s = 200s. Sequential export
  with progress bar in Phase 2; worker pool deferred to Phase 3 (OCCT memory
  ~150MB/instance).
- **13.8 Tauri vs. browser** — browser uses blob download, Tauri writes
  directly via `@tauri-apps/api/dialog.save`. UI detects via `useTauri()`.
- **13.9 Negative-dimension expressions** — `radius = thickness - 10` with
  `thickness = 5` → `-5`. Existing feature diagnostics flag NaN / invalid
  OCCT input; no extra Phase 2 work.
- **13.10 Pre-v3 `paramExpressions`** — preserved in `legacyParamExpressions`
  for one cycle; release notes ask users to re-enter formulas (the legacy
  format never evaluated — see §1.2).

---

## 14. Out of Scope (Phase 3+)

- **Design tables linked to external Excel/CSV** (Onshape "Variable Studios").
- **Configuration-driven materials with mass props recomputation.**
- **Configurable assembly mates** (config-aware mates on leaves).
- **Per-config undo history** (Wave 2 history is per-doc).
- **Visual configuration switcher in the 3D viewport.**

---

## 15. Open Questions

1. **"No active" vs. "master"** — make explicit with a non-editable "Master"
   pseudo-row at the top. `activeConfigId = null` highlights it.
2. **Config switch in undo stack?** No — config switch is not an undo step
   (it doesn't mutate scene). Ctrl+Shift+C cycles configs separately.
3. **CRDT conflict on `isDefault`** — LWW; loser sees toast (post-Phase-2 polish).
4. **Worker cache** — already keyed on literal feature params; should "just
   work" after client-side resolution. Confirm with soak.
5. **Mobile UX** — Excel-grid is desktop-first; Phase 3 adds tablet dropdown view.

---

## 16. References

- `src/app/[lang]/shape-generator/io/nfabFormat.ts` (§167 — current schema)
- `src/app/[lang]/shape-generator/config/configurationManager.ts` (unused class)
- `src/app/[lang]/shape-generator/assembly/multiConfigPartVariant.ts` (third API)
- `src/app/[lang]/shape-generator/panels/ConfigurationTable.tsx` (current UI)
- `src/app/[lang]/shape-generator/equations/equationManager.ts` (expression engine to reuse)
- `src/app/[lang]/shape-generator/features/featureContext.ts` (pipeline seam)
- `src/app/[lang]/shape-generator/features/index.ts:97–112` (where `applyFeatureContext` runs)
- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx:1382–1483` (host state)
- `docs/wave-2-crdt-architecture.md` (CRDT envelope)
- `docs/wave-2-soak-runbook.md` (perf budgets)
- ADR-010 (Wave 2 B-Full + collab)
