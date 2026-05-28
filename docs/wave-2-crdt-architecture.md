# Wave 2 — CRDT-first State Architecture (Design Spike)

**Status:** spike / design-only — NO implementation in this doc
**Date:** 2026-05-28
**Author:** wave-2 architecture
**Risk tier:** P0
**Related:** ADR-010 (Wave 2 B-Full + collab), `docs/wave-2-phase-1-plan.md`

## Purpose

ADR-010 commits us to CRDT-first state for all mutable design data so multi-user
real-time editing is not a retrofit. This document maps the **existing
mutable code** to **target Yjs structures**, identifies merge-conflict
hazards, sizes the performance envelope, and proposes a 4-6 month migration
that does not stop forward feature work.

This is **design only**. No source files are modified by this spike; only
the document at `docs/wave-2-crdt-architecture.md` is produced.

The six files surveyed are:

| # | Path | Role |
|---|------|------|
| 1 | `src/app/[lang]/shape-generator/sketch/constraintSolver.ts` | LM solver over `SketchSegment[] + SketchConstraint[] + SketchDimension[]` |
| 2 | `src/app/[lang]/shape-generator/useFeatureStack.ts` | `Map<string, HistoryNode>` feature tree React hook |
| 3 | `src/app/[lang]/shape-generator/features/bodyManagement.ts` | `BodyRegistry { bodies: Map<id, Body>; order: string[] }` |
| 4 | `src/app/[lang]/shape-generator/assembly/assemblyTree.ts` | Nested `AssemblyTreeNode` (group / leaf) + flatten |
| 5 | `src/app/[lang]/shape-generator/assembly/matesSolver.ts` | `AssemblyState { bodies[], mates[] }` Gauss-Seidel solver |
| 6 | `src/app/[lang]/shape-generator/io/nfabFormat.ts` | `.nfab` JSON serialization (v1→v2 migration chain) |

Existing scaffolding referenced (not authoritative, will be replaced):
`collab/sketchCrdt.ts`, `collab/assemblyCrdt.ts`, `collab/useCollabFeatureTree.ts`,
`collab/yjsDoc.ts`, `collab/useCollabSseTransport.ts`.

---

## 1. Current Structure Summary

### 1.1 `constraintSolver.ts` — sketch entities / constraints / dimensions

**Data model** (lives in `sketch/types.ts`, not in the solver):

```ts
SketchPoint   { x, y, id? }              // mm
SketchSegment { type, points, id?, construction?, degree?, knots?, weights? }
SketchProfile { segments: SketchSegment[], closed: boolean }
SketchConstraint { id, type, entityIds[], satisfied, value?, expression? }
SketchDimension  { id, type, entityIds[], value, position, locked, name?, expression? }
```

The solver itself is a **pure function** — it never mutates inputs. It receives
arrays and returns `SolverResult { points: Map<id, SketchPoint>, satisfied, ... }`.
This is structurally CRDT-friendly: the *storage* of segments / constraints /
dimensions is what mutates from the UI, and the solver re-runs after each edit.

**Mutation surface** — actual mutations of these arrays live in:
- `SketchCanvas.tsx` / `sketch/` UI handlers — calls like
  `setSegments(prev => [...prev, newSeg])`,
  `setConstraints(prev => prev.filter(c => c.id !== removedId))`.
- `useFeatureStack.addSketchFeature(..., constraints?, dimensions?)` — these
  arrays travel with the sketch node and are persisted on the
  `HistoryNode.sketchData` (line 521).

**Identity strategy** — every `SketchSegment` / `SketchPoint` / `SketchConstraint`
/ `SketchDimension` already carries a stable `id` field. This is critical for
CRDT: position-based array merging is the wrong default for sketches because
two users adding a line at "index 5" should both keep their lines, not have
one win.

**Cross-references** — constraints/dimensions reference segment/point ids via
`entityIds: string[]`. Dangling references are silently skipped by the solver
(every helper returns null/0 on lookup miss), which is the right behaviour for
collaborative editing where a referenced segment may be in-flight from another
peer.

**Expression evaluation** — dimensions can carry parametric `expression`
strings (`"2*D1 + 10"`). `resolveDimensionTargetsWithErrors` runs a topological
sort over `name` references and reports cycles. This computation is purely
derivative — it does not need to live in the CRDT, only the inputs do.

### 1.2 `useFeatureStack.ts` — feature tree

**Data model**:

```ts
HistoryNode {
  id, type, label, icon, featureType?,
  params: Record<string, number>,
  enabled, expanded, error?,
  parentId: string | null,
  children: string[],
  editingActive, timestamp,
  dependsOn?, enabledExpr?,
  sketchData?: SketchNodeData,      // ← embedded sketch when sketchExtrude
  edgeSelections?, faceSelections?,
}

FeatureHistory { nodes: HistoryNode[], rootId, activeNodeId, editingNodeId }
```

**Storage** — `useState<Map<string, HistoryNode>>` flat lookup plus
`rootId / activeNodeId / editingNodeId / labelCounters / featureErrors` as
parallel React `useState` slots. The tree topology is encoded entirely via
`parentId` + `children[]`, which means every structural mutation must update
**two** entries (the child being added, and the parent's `children`).

**Mutation surface** (this hook *is* the mutation API):
- `addNode(...)` — generates id, sets node, appends to parent.children
- `removeNode(id)` — DFS collect descendants, delete all, splice from parent
- `updateNode(id, patch)` — shallow merge
- `moveFeature(id, 'up'|'down')` — swap within `parent.children`
- `rollbackTo(id)` — sets `activeNodeId`; nodes "after" in DFS are filtered
  out at the consumer via `activeNodeSet`
- `toggleFeature`, `toggleExpanded`, `updateFeatureParam`, `setNodeEnabledExpr`
- `addSketchFeature(...)` — special path; builds a `sketchExtrude` node and
  stuffs `{ profile, config, plane, planeOffset, operation, constraints, dimensions, faceFrame }`
  into `sketchData`
- `replaceHistory(nodes, rootId, activeId)` — bulk load (nfab import)
- `clearAll()` — wipe + reseed Base Shape root

**Derived state** — `getOrderedNodes()` runs DFS each call, memoized via
`useMemo` on `nodeMap`. `activeNodeSet` is a Set of ids "at or before" the
active node in DFS order. `featuresCompat` is the legacy `FeatureInstance[]`
shape consumed by `applyFeaturePipeline`.

**Conflict implications** — the dual write to parent and child on `addNode`
is currently atomic inside one `setNodeMap`. In CRDT this must be wrapped in
one Yjs transaction, or two users adding children concurrently will lose one
ordering.

### 1.3 `bodyManagement.ts` — multi-body registry

**Data model**:

```ts
Body {
  id, name, kind: 'solid'|'surface'|'sheet'|'wire',
  volumeMm3, surfaceAreaMm2,
  bbox: { min: Vec3, max: Vec3 },
  visible, materialId?, color?, locked, tags: string[],
}
BodyRegistry { bodies: Map<string, Body>; order: string[] }
```

**Mutation surface** — module-level functions take a registry and mutate it
**in place** (e.g. `addBody`, `removeBody`, `setVisible`, `reorder`). This is
the most aggressive mutation pattern of the six files — direct
`registry.bodies.set(...)` calls, direct field assignment on bodies
(`body.visible = visible` in `setVisible`).

**Order maintenance** — `order: string[]` is parallel to `bodies` map; every
add/remove updates both. CRDT must preserve this; if order drifts from the
keyset it's a bug.

**Plan vs apply** — `planCombine` and `planSplit` return *descriptors* without
mutating. The actual mesh boolean lives elsewhere. The registry only sees the
result. Good — fewer mutation sites.

### 1.4 `assemblyTree.ts` — nested assembly tree

**Data model**:

```ts
AssemblyGroupNode {
  kind: 'group', name,
  position: THREE.Vector3, rotation: THREE.Euler,
  children: AssemblyTreeNode[]
}
AssemblyLeafNode { kind: 'leaf', body: AssemblyBody }
AssemblyTreeNode = group | leaf
```

**Mutation surface** — this module is **pure** (just `flattenTree`,
`countLeaves`, factory helpers `leaf`/`group`). The mutating callers live in
`assembly/` panels — they push to `children` arrays, mutate `position` /
`rotation` Vector3s, swap `body` refs.

**THREE.js object embedding** — `THREE.Vector3` / `THREE.Euler` instances
inside the tree are **runtime objects**, not serializable. The flatten code
clones them. For CRDT we must replace these with plain `[number, number, number]`
tuples in the shared doc and reconstruct THREE objects in a local
view-projection layer.

**Identity** — `AssemblyGroupNode` has **no explicit id**. Cycle detection
uses object identity (`visiting.has(node)`). This will not survive CRDT —
peers receive *new objects* deserialized from updates, identity is lost. We
must mint stable ids during the migration.

### 1.5 `matesSolver.ts` — mate constraint solver

**Data model**:

```ts
MateSelection { bodyIndex: number, type, localPoint, localNormal, localAxis? }
Mate {
  id, type: MateType (12 variants), selections: [MateSelection, MateSelection],
  distance?, angle?, gearRatio?, beltRadius0?, beltRadius1?, beltCrossed?,
  enabled, conflict?
}
AssemblyBody {
  name, position: THREE.Vector3, rotation: THREE.Euler, fixed, geometry?
}
AssemblyState { bodies: AssemblyBody[], mates: Mate[] }
```

**Mutation surface** — solver clones bodies on entry (`bodies.map(b => ({...b, position: b.position.clone(), rotation: b.rotation.clone()}))`) and mutates
the clones in place. **Caller-side** mutations of the assembly state live
in `assembly/` UI code: adding mates, fixing bodies, dragging bodies in the
viewport.

**Critical fragility — `bodyIndex` is positional**. `Mate.selections[0].bodyIndex`
is an integer index into `bodies[]`. If two peers reorder the body array
concurrently the indices break. The CRDT design **must** convert this to a
stable `bodyId: string` reference. (See §4 — this is conflict scenario #3.)

**THREE.js embedding** — same issue as assemblyTree. `geometry: THREE.BufferGeometry`
must be lifted out of the CRDT (geometry is computed from the feature tree;
the CRDT only needs to know which body each mate references).

### 1.6 `nfabFormat.ts` — `.nfab` serialization

**Schema (v2)**:

```ts
NfabProjectV1 {
  magic: 'nfab', version: 1|2,
  createdAt, updatedAt, name, thumbnail?,
  tree: { nodes: HistoryNode[], rootId, activeNodeId },
  scene: {
    selectedId, params, paramExpressions, materialId, color,
    isSketchMode, sketchPlane, sketchProfile, sketchConfig,
    activeTab?, cadWorkspace?, renderMode?, explodeFactor?,
    sketchViewMode?, ribbonTheme?, studioView?, sketchFaceFrame?
  },
  assembly?: NfabAssemblySnapshotV1 { placedParts, mates, bodies?, ... },
  manufacturing?, meta?, configurations?, activeConfigurationId?,
  aiHistory?, scadIntents?
}
```

**Migration chain** — `migrateV1ToV2` adds empty `aiHistory` + `scadIntents`.
Forward-compat raises `NfabParseError` with user-readable message.

**Mutation pattern** — pure serialize / parse round-trip:
- `serializeProject(input) → NfabProjectV1` (strips `error`, `editingActive`
  runtime fields via `stripRuntimeFields`)
- `parseProject(json) → NfabProjectV1` (validates, migrates, normalizes)
- Consumers call `replaceHistory(nodes, rootId, activeId)` to bulk-load

**For CRDT** — `.nfab` becomes a **snapshot format** (point-in-time export from
a Yjs doc) plus a **bootstrap format** (initial state when a new collab doc
is opened on an offline-imported file). Yjs encoded state vector + update
will be stored alongside the JSON for collab-native projects in R2.

---

## 2. Yjs Map / Array Mapping

### 2.1 Top-level shared doc shape

A single `Y.Doc` per **project** (an .nfab project ≈ one CAD document). The
root contains exactly one shared collection per state slice:

```
Y.Doc
├── tree:         Y.Array<Y.Map>      // feature tree nodes (flat)
├── sketches:     Y.Map<sketchId, Y.Map>  // one sub-doc per sketch
├── bodies:       Y.Map<bodyId, Y.Map>    // body registry
├── assembly:     Y.Map<nodeId, Y.Map>    // assembly tree (flat with parentId)
├── mates:        Y.Array<Y.Map>      // assembly mates
├── scene:        Y.Map<string, unknown>  // viewport / UI state
├── manufacturing: Y.Map<string, unknown>
├── meta:         Y.Map<string, unknown>
├── configurations: Y.Array<Y.Map>
└── aiHistory:    Y.Array<Y.Map>
```

Rationale for these choices:
- **Flat maps keyed by id** instead of nested arrays for tree-shaped data
  (`tree`, `assembly`). Parent / child relationships are encoded via fields
  inside each node map (`parentId`, `children` as `Y.Array<string>`).
- **Y.Array<Y.Map>** only where order is intrinsically semantic and not
  derivable: `mates` (apply order matters for the solver), `aiHistory`
  (chronological).
- One **Y.Map per logical entity** so per-field merges win over whole-object
  LWW (last-write-wins). Two users editing different params of the same
  feature should merge.

### 2.2 Sketch entities

```ts
Y.Map sketches: {
  [sketchId]: Y.Map {
    'id':          string,
    'plane':       'xy'|'xz'|'yz',
    'planeOffset': number,
    'operation':   'add'|'subtract',
    'faceFrame':   Y.Map | null,
    'segments':    Y.Map<segmentId, Y.Map>,   // ← keyed, not Y.Array
    'constraints': Y.Map<constraintId, Y.Map>,
    'dimensions':  Y.Map<dimensionId, Y.Map>,
    'config':      Y.Map<string, unknown>,    // SketchConfig
  }
}
```

`segments: Y.Map<segmentId, Y.Map>` chosen over `Y.Array<Y.Map>` (the current
`collab/sketchCrdt.ts` scaffold) because:
1. Segments in a 2D sketch have **no inherent order** — they're drawn in time
   order but the solver and the pipeline iterate by id-set, not position.
   Order would be an artificial constraint that creates spurious conflicts.
2. Append-only `Y.Array` semantics force a position. Two users adding line
   "L1" and "L2" concurrently get `[L1, L2]` on one peer and `[L2, L1]` on
   the other — Yjs resolves this deterministically but the order drifts
   from "user intent" and tests assert sketch equality up to id-set, not
   ordering, so this becomes flaky.
3. Map keyed by id matches the dangling-reference tolerance — a constraint
   references a segment id; if the segment was deleted, `segments.get(id)`
   returns undefined and the constraint is dropped from the solver pass.

Per-segment Y.Map:
```ts
Y.Map (one segment) {
  'id':            string,
  'type':          SketchSegment['type'],
  'points':        Y.Array<Y.Map> | string,   // see §2.2.1
  'construction':  boolean | undefined,
  'degree':        number | undefined,
  'knots':         Y.Array<number> | undefined,
  'weights':       Y.Array<number> | undefined,
}
```

#### 2.2.1 Points: nested Y.Array vs JSON-string LWW

The existing scaffold (`collab/sketchCrdt.ts`) **JSON-stringifies the points
array** to make point-set edits atomic. This is the right call for a Wave 2
**v1**:

> "A 'move this vertex' edit always replaces the whole array. Nesting
> would let two users edit different vertices of the same segment concurrently
> but the merge doesn't carry sketch-solver semantics."

Concretely, two users moving different control points of a NURBS curve
without coordination produces a curve neither user intended. Solver
re-runs would project the geometry but the result is surprising.

**Decision**: keep JSON-string LWW for `points`, `knots`, `weights` in v1.
Revisit in v2 (post-launch) if users actually want per-point concurrent
editing on the same segment (low-probability — different segments is the
normal case).

### 2.3 Constraints + Dimensions (per sketch)

```ts
Y.Map (one constraint) {
  'id':         string,
  'type':       ConstraintType,
  'entityIds':  Y.Array<string>,    // ← Y.Array so concurrent reassignment merges
  'satisfied':  boolean,             // CRDT-derived field; recomputed locally
  'value':      number | undefined,
  'expression': string | undefined,
}

Y.Map (one dimension) {
  'id':         string,
  'type':       'linear'|'angular'|'radial'|'diameter',
  'entityIds':  Y.Array<string>,
  'value':      number,
  'position':   Y.Map { x, y },
  'locked':     boolean,
  'name':       string | undefined,
  'expression': string | undefined,
}
```

`satisfied` is a **runtime-derived** flag — the solver computes it on every
run. We mirror it into the Y.Map so the UI can render constraint badges
without re-solving, but it must be treated as eventually-consistent and
non-authoritative: if peer A's local solve says satisfied=true and peer B's
says false, the *next solver pass on either peer* converges. Listeners
ignore remote changes to `satisfied` (only their local solver writes it).

### 2.4 Feature tree

```ts
Y.Array tree: [
  Y.Map (one node) {
    'id':              string,
    'type':            HistoryNodeType,
    'label':           string,
    'icon':            string,
    'featureType':     FeatureType | undefined,
    'params':          Y.Map<string, number>,
    'enabled':         boolean,
    'enabledExpr':     string | undefined,
    'expanded':        boolean,
    'parentId':        string | null,
    'children':        Y.Array<string>,        // child ids in DFS order
    'timestamp':       number,
    'dependsOn':       Y.Array<string> | undefined,
    'sketchRef':       string | undefined,     // ← key into sketches Y.Map
    'edgeSelections':  string,                 // JSON-stringified
    'faceSelections':  string,                 // JSON-stringified
  }
]
```

Two key changes vs current `HistoryNode`:

1. **`sketchData` is replaced by `sketchRef: string`**. The sketch lives in
   the top-level `sketches` Y.Map (§2.2). This decouples feature-tree edits
   from sketch edits — a user adding a fillet doesn't lock peer-B's
   in-progress sketch edit, and vice versa.

2. **`editingActive` and `error` are dropped from the CRDT**. They're
   per-peer UI state (already stripped on serialize via
   `stripRuntimeFields`). They live in local React state, **not** in the doc.

`Y.Array` for the top-level tree is acceptable because the tree is mostly
append-only and the **insertion-order winner** when two users add a sibling
concurrently is fine — both children appear, with one consistently before
the other across all peers. Reorder operations (`moveFeature`) are the
hazard, addressed in §3.4.

### 2.5 Body registry

```ts
Y.Map bodies: {
  [bodyId]: Y.Map {
    'id':            string,
    'name':          string,
    'kind':          'solid'|'surface'|'sheet'|'wire',
    'volumeMm3':     number,
    'surfaceAreaMm2': number,
    'bbox':          Y.Map { 'min': Y.Array<number>, 'max': Y.Array<number> },
    'visible':       boolean,
    'materialId':    string | undefined,
    'color':         string | undefined,
    'locked':        boolean,
    'tags':          Y.Array<string>,
  }
}
Y.Array bodyOrder: [string, string, ...]   // separate ordered view
```

The current `BodyRegistry` has `{ bodies: Map, order: string[] }` — two
parallel structures. We keep that split:

- **`bodies` (Y.Map keyed by id)** owns the data. Bodies appearing/disappearing
  concurrently merge cleanly.
- **`bodyOrder` (Y.Array<string>)** owns the display order. Reordering by
  drag is a removal + insertion in this array only.

If a body is in `bodies` but not in `bodyOrder` (a race where someone added
the body but the order-append hasn't propagated yet), it sorts to the end on
the local view. If a body is in `bodyOrder` but not in `bodies` (the body
was deleted on peer A while peer B was reordering it), the local view skips
the id. Both transient states converge.

**`volumeMm3` / `surfaceAreaMm2` / `bbox`** — derived from geometry; should
not really live in the CRDT. v1 keeps them for UI convenience (so a peer
joining mid-session sees correct numbers without re-meshing). v2 moves them
to a local-only cache keyed by body id + feature-tree hash.

### 2.6 Assembly tree

The existing tree is **object-identity-based with anonymous group nodes**.
For CRDT we flatten it:

```ts
Y.Map assembly: {
  [nodeId]: Y.Map {
    'id':         string,
    'kind':       'group' | 'leaf',
    'parentId':   string | null,
    'name':       string,        // groups only
    'position':   Y.Array<number>,  // [x, y, z], identity for groups by default
    'rotation':   Y.Array<number>,  // [x, y, z, w] quaternion
    'children':   Y.Array<string>,  // groups: child node ids; leaves: empty
    'bodyId':     string | undefined,  // leaves only; references bodies map
    'fixed':      boolean,             // leaves only
  }
}
```

Two changes:
- **Stable string ids** mint via `crypto.randomUUID()` at creation. Replaces
  identity-based cycle detection.
- **Quaternion** instead of `THREE.Euler` for rotation — quaternions are
  unique up to sign while Euler angles have gimbal-equivalent representations
  that diff-spuriously between peers.

`flattenTree` becomes a local view-projection: walk parentId chain, accumulate
matrices, return `AssemblyBody[]` exactly like today. Pure function; no
Yjs dependency.

### 2.7 Mates

```ts
Y.Array mates: [
  Y.Map (one mate) {
    'id':          string,
    'type':        MateType,
    'enabled':     boolean,
    'distance':    number | undefined,
    'angle':       number | undefined,
    'gearRatio':   number | undefined,
    'beltRadius0': number | undefined,
    'beltRadius1': number | undefined,
    'beltCrossed': boolean | undefined,
    'selections':  Y.Array (length 2) [
      Y.Map (one selection) {
        'bodyId':      string,        // ← was bodyIndex; now stable id
        'type':        MateSelectionType,
        'localPoint':  Y.Array<number>,   // [x, y, z]
        'localNormal': Y.Array<number>,
        'localAxis':   Y.Array<number> | undefined,
      }
    ]
  }
]
```

Order is preserved (matters for Gauss-Seidel iteration order in some
pathological cases). The `bodyIndex → bodyId` switch is the single biggest
correctness fix of the entire migration; see §4 scenario #3.

### 2.8 Scene / manufacturing / meta / configurations / AI history

```ts
Y.Map scene: { ...all fields of NfabProjectV1['scene'] as flat keys... }
Y.Map manufacturing: { ...NfabManufacturing fields... }
Y.Map meta: Record<string, unknown>
Y.Array configurations: [Y.Map per configuration]
Y.Array aiHistory: [Y.Map per entry]
```

Configuration's `featureEnabled: Record<string, boolean>` becomes `Y.Map`.
`paramExpressions: Record<string, string>` becomes `Y.Map`. These were
already keyed-by-id under the hood — straight translation.

---

## 3. Transaction Model

Yjs supports **atomic transactions**: all ops inside `doc.transact(() => {...})`
produce one update message and observers see the union of changes in one
notification. Origin is taggable so we can distinguish local edits from
remote.

### 3.1 Atomic transaction boundaries

The following composite operations **must** be wrapped in a single
`doc.transact(...)`:

| Operation | Touches |
|-----------|---------|
| **Add sketch feature** | `tree` array push + `sketches` map set (entry + nested segments/constraints/dimensions) |
| **Add child node to tree** | child node `Y.Map` set in `tree` array + parent's `children` `Y.Array` push |
| **Delete tree node + descendants** | DFS over `parentId` graph, delete N node maps + remove from each parent's `children` |
| **Add sketch segment + auto-constraints** | `sketches[sid].segments` set + 0..N `sketches[sid].constraints` sets |
| **Combine bodies (union/subtract)** | result body insert in `bodies` + N source bodies remove from `bodies` and `bodyOrder` + result append to `bodyOrder` |
| **Split body** | source remove + 2 results insert + bodyOrder update |
| **Replace history (`.nfab` import)** | wipe + reseed every shared collection — see §3.5 |
| **Group/ungroup assembly** | N child reparenting + 1 group node create/delete |
| **Solve sketch then commit** | bulk write of segment `points` updates after LM converges |
| **Project clear / new** | wipe every shared collection |

Without these wrappers, a peer can see e.g. a feature-tree node that
references a sketch that doesn't exist yet, blowing up the pipeline.

### 3.2 Transaction origin tagging

We pass origin tags into `transact()` so observers can filter:

```ts
doc.transact(() => { ... }, { source: 'local-ui', user: userId });
doc.transact(() => { ... }, { source: 'solver-commit' });
doc.transact(() => { ... }, { source: 'remote-update' });  // from WebSocket
doc.transact(() => { ... }, { source: 'import-nfab' });
doc.transact(() => { ... }, { source: 'undo-redo' });
```

This lets us:
- Skip recomputing the solver when the change *was* the solver commit
- Suppress "X edited Y" toasts for remote vs local
- Run undo (§3.3) only over `local-ui` operations
- Throttle network broadcasts during `solver-commit` rapid bursts

### 3.3 Undo / redo

Yjs ships `Y.UndoManager`. Construct it once per doc with a scope of the
shared root collections we want undoable, filtered by origin:

```ts
new Y.UndoManager(
  [tree, sketches, bodies, bodyOrder, assembly, mates, scene],
  { trackedOrigins: new Set(['local-ui']) }
);
```

This automatically gives each peer **their own undo stack** without
undoing remote users' changes. The current React-state `useHistory.ts`
becomes a thin wrapper over `UndoManager.undo()` / `redo()`.

### 3.4 Reorder operations

`moveFeature`, `bodyOrder reorder`, and assembly children reorder are all
"swap A and B in array" semantics. Yjs `Y.Array` does **not** have a swap
primitive; we implement as `delete(fromIdx, 1)` + `insert(toIdx, [value])`.

This is **not idempotent under concurrency**: if peer A swaps indices 2↔3
while peer B swaps 3↔4, the result is well-defined but neither peer's
"intended pair" survives. For commercial CAD this is acceptable — reorder
is a UX nice-to-have, not a correctness primitive. We display a toast
"Order changed by another user" via `awareness` (§5).

### 3.5 Bulk replace (.nfab import)

`replaceHistory` is dangerous in CRDT: clearing every shared collection +
re-hydrating could produce a 50+ MB update broadcast to all peers. Mitigation:

- Import opens a **fresh `Y.Doc`** (new doc id, new R2 blob).
- Existing peers are notified and asked to switch to the new doc id.
- The .nfab JSON is decoded → fresh Yjs structures populated in one
  `transact()` block before the doc is broadcast.

This treats import-as-replace as "new project from file", not "overwrite
existing project state". Old peers can keep editing the previous doc until
they switch.

---

## 4. Conflict Scenarios

These five scenarios cover the high-risk concurrent edit patterns. For
each: what users do, what Yjs's deterministic merge produces, whether
that's acceptable, and any mitigation.

### Scenario A — Concurrent sketch entity add + sketch wipe

> Peer A adds line L7 with `appendSegment`. Peer B selects all and deletes
> the entire sketch via `replaceHistory` or sketch-level wipe.

**Yjs behaviour** — adds and deletes commute by id. After merge:
- If B's delete uses `segments.delete(L7id)`: L7 is deleted on both peers.
  A sees its line disappear "instantly" once B's update arrives.
- If B's delete is a "wipe sketch" (delete the whole `sketches[sid]` entry):
  A's added L7 inside `sketches[sid].segments` is **also gone**, because
  the parent map entry is gone. Yjs garbage-collects the orphan.
- If B's delete is `replaceHistory` (open a different .nfab): see §3.5 —
  A is moved to a different doc, A's L7 is preserved in the old doc.

**Acceptable?** Yes for cases 1 and 3. Case 2 is the only surprise — A
loses work without a "your change was overridden" toast. **Mitigation**:
fire a toast via awareness when `segments` is observed to drop entries
that the local peer just added in the last 5s.

### Scenario B — Concurrent constraint add referring to a deleted segment

> Peer A deletes segment L3. Peer B adds constraint C9 with `entityIds: [L3.id, L4.id]`.

**Yjs behaviour** — Yjs has **no foreign-key enforcement**. After merge:
- `segments[L3.id]` is gone.
- `constraints[C9.id]` exists with `entityIds[0] = L3.id` pointing at nothing.

Solver re-runs on both peers — `segById.get(L3.id)` returns undefined,
solver gracefully skips this row (already the case today; see
`constraintSolver.ts:347-352`). UI renders constraint badge but marks it
as orphan-red.

**Acceptable?** Yes. The existing solver tolerance handles it. **Mitigation**:
periodic GC pass: every 30s, scan constraints, drop any whose entityIds
reference no longer-extant segments. Run this in a single transact() with
`origin: 'gc'` so it doesn't appear in undo history.

### Scenario C — Two peers add mates referencing the same body, while body is reordered

This is **the** historical bug class because `Mate.selections[i].bodyIndex` is
positional. With the §2.7 fix to `bodyId: string`:

> Peer A drags body B5 (id=`b-foo`) up the list, changing its position from
> index 5 to index 2. Peer B adds mate M3 referencing the body it sees at
> "index 5" — which on B's stale local view is still `b-foo` but **on the
> server** is now `b-quux` after A's reorder.

**Pre-CRDT, today**: A and B both end up writing different `bodyIndex` values
into different copies of the assembly state. Last writer wins. Mate
references wrong body. Hard-to-diagnose bug.

**Post-CRDT with bodyId**: B captures `b-foo` as the bodyId at the moment of
selection. A's reorder updates `bodyOrder` only, not body identity. After
merge, both peers see M3 referencing `b-foo` at its current display index 2.

**Acceptable?** Yes — this is now correct by construction. The migration's
single biggest win.

### Scenario D — Concurrent rename / param edit on same node

> Peer A renames Fillet 3 → "Outer rim". Peer B changes radius from 5 → 8.

**Yjs behaviour** — `Y.Map.set('label', ...)` and `Y.Map.set('radius', ...)`
on different keys merge cleanly. Both edits land. No conflict.

**Acceptable?** Yes — exactly the merge we want, and impossible to get from a
naïve "replace whole node" mutation pattern (current
`updateNode(id, { label })` shallow-merges in React state, but two peers'
React state diverges; CRDT centralises the merge).

**Edge**: if both peers edit the **same** key (e.g. both change the label),
Yjs LWW resolves by logical timestamp. The losing peer sees their text
flicker to the winner's value. Awareness shows "User X is editing this
field" to discourage simultaneous edits, but doesn't prevent them.

### Scenario E — Feature tree reorder collision

> Peer A drags Fillet 3 above Fillet 2 (so DFS order becomes …, F3, F2, …).
> Peer B simultaneously deletes Fillet 2.

**Yjs behaviour** — `tree.delete(idxOfF3, 1) + tree.insert(newIdx, [F3])`
runs as one transact() on A. B's `tree.delete(idxOfF2, 1)` runs separately.

Yjs uses **position-tracking under the hood** — A's insert targets a logical
position, not an integer. After merge:
- F2 is gone (B's delete won).
- F3 is at the position A targeted relative to the surviving neighbours.
- DFS over `parentId + children` still produces a valid tree.

But: A's reorder was "move F3 above F2". F2 doesn't exist. The intent is
lost; F3 ends up wherever the position-tracking pinned it. This is
**unavoidable** without operational-transform-style intention preservation,
which Yjs deliberately doesn't do.

**Acceptable?** Yes for v1. Real-world frequency low. **Mitigation**:
display "Tree changed by user X" toast on the reordering peer when their
target neighbour disappeared mid-drag.

---

## 5. Performance Concern

Target sketch scale for v1: **100 entities + 50 constraints**. We size Yjs
overhead in three dimensions: doc size, update size on each edit, observer
fan-out cost.

### 5.1 Doc size

A 100-segment / 50-constraint / 20-dimension sketch in plain JSON is
roughly:

| Item | Plain JSON | Yjs Y.Map encoded |
|------|------------|-------------------|
| 1 segment (line, 2 points) | ~150 B | ~280 B (Map + 5 keys + struct refs) |
| 1 segment (nurbs, 8 ctrl pts) | ~600 B | ~750 B |
| 1 constraint (2 entityIds) | ~120 B | ~220 B |
| 1 dimension | ~180 B | ~310 B |
| 100 segments avg | ~22 KB | ~38 KB |
| 50 constraints | ~6 KB | ~11 KB |
| 20 dimensions | ~3.6 KB | ~6.2 KB |
| **Sketch total** | **~32 KB** | **~55 KB** |

Plus update history: Yjs keeps the full op log unless we run periodic
**`Y.encodeStateAsUpdate()` snapshots** and ship the snapshot as the new
baseline. With heavy editing (1000 ops over an hour) the doc grows to
~200 KB before snapshot, ~60 KB after.

A typical CAD project with ~10 sketches + ~50 features + ~5 bodies + 1
assembly + 30 mates:

| Section | Yjs size (after snapshot) |
|---------|---------------------------|
| Feature tree (50 nodes) | ~25 KB |
| Sketches (10 × ~60 KB) | ~600 KB |
| Bodies (5) | ~5 KB |
| Assembly (8 nodes) | ~6 KB |
| Mates (30) | ~12 KB |
| Scene / manufacturing / meta | ~10 KB |
| **Doc total** | **~660 KB** |

Comparable to the current .nfab file at the same project size (~500 KB).
The ~30% overhead is acceptable.

### 5.2 Update size (per edit)

This drives **network cost** during collab. Yjs updates are deltas — only
the changed ops, not the full doc.

| User action | Update size |
|-------------|-------------|
| Move 1 sketch point | ~80 B (single key set on the segment Y.Map) |
| Add 1 line segment | ~250 B (new Y.Map + struct items) |
| Drag-select 5 segments to construction | ~400 B (5 key sets in 1 transact) |
| Add 1 constraint | ~200 B |
| Add 1 feature node | ~350 B (node + parent.children push) |
| Rename a feature | ~100 B |
| Run solver + commit 100 point updates | ~7-10 KB (one transact, 100 set ops) |
| Add a 50-segment sketch in one shot | ~14 KB |

At 10 Hz sustained editing, an active peer broadcasts ~1-3 KB/s. Well within
WebSocket throughput. **Hazard: solver commits at high frequency** — see
§5.4 mitigation.

### 5.3 Observer fan-out

Every Y.Map / Y.Array can have observers; we drive React re-renders from them.
Naïve implementation: 1 React state per shared collection, re-fetch all on
any change. For a 100-segment sketch this means re-running `readSegments()`
on every keystroke = ~3 ms (mostly JSON.parse of points strings).

Better: **diff-driven updates**. `Y.YEvent.changes.keys` reports exactly
which segment ids changed; update just those entries in a React Map state.
Brings re-fetch cost to <0.3 ms for typical edits.

Even better for the solver: subscribe to `segments` / `constraints` /
`dimensions` Y.Maps and **debounce solver runs to 100 ms** after the last
event. Avoids re-solving during a multi-segment drag where 60 events fire
in 16 ms.

### 5.4 Solver commit overhead

The LM solver runs locally on every state change. Today's invariant: solver
input is React-state arrays; solver output replaces those arrays.

In CRDT, two concerns:

1. **Solver writeback storm**. Solver converges in ~10-50 iterations, each
   computing fresh point positions. We write the *final* positions, not
   intermediate, in one `transact()`. ~7 KB update per solve, ~150 ms cost.

2. **Solver loops with peers**. Peer A solves, commits, broadcasts. Peer B
   receives, re-solves locally (gets the same answer, since input is now
   identical), produces an empty diff (Yjs detects no-op), no broadcast. Good.

   **Failure mode**: if peers solve to slightly different numerical
   solutions (e.g. LM under-defined sketch finds different DOF residuals),
   both write back. Mitigation: tag solver commits with
   `origin: 'solver-commit'` and **suppress local solver runs in response
   to remote `solver-commit` updates**. The peer that received accepts the
   broadcaster's solution.

### 5.5 Memory ceiling

A worst-case project (50 sketches × 200 segments + 500 features + 50 bodies +
200 mates) sits at ~5 MB in-memory for the Y.Doc plus another ~5 MB for
the React-mirrored views. Well under the 2 GB browser heap budget. No
concern.

---

## 6. Migration Plan (4-6 months)

The migration cannot be a big-bang rewrite. It runs alongside Wave 2 feature
work. Six phases, each ~3-4 weeks, total ~5 months. Each phase ships
working code on `main`.

### Phase 0 — Foundation (weeks 1-2)

- [ ] Pin Yjs version (1.x latest). Establish CRDT dev-dep policy.
- [ ] Replace `collab/yjsDoc.ts` scaffold with project-doc lifecycle:
      open, close, persist to IndexedDB, snapshot to R2.
- [ ] Stand up Cloudflare Durable Object for `y-websocket` relay.
- [ ] Wire `Y.UndoManager` over local-origin transactions (no UI yet, just
      tests).
- [ ] Add `useDoc()` hook that exposes the current project's Y.Doc.

**Ship criteria**: dev can open a doc, edit a counter Y.Map, see it sync to a
second tab via DO, undo/redo works.

### Phase 1 — Feature tree (weeks 3-6)

The least-mutation-coupled state. Migration:

- [ ] Implement `useFeatureTree(doc)` hook returning the same React API as
      `useFeatureStack()` today (`addFeature`, `removeNode`, `updateNode`,
      `moveFeature`, ...) backed by `Y.Array<Y.Map>` per §2.4.
- [ ] Keep `sketchData` field as JSON-blob initially (sketches not yet
      migrated). Embed full sketch JSON in the node Y.Map.
- [ ] Feature-flag the new hook behind `?crdt=tree` URL param.
- [ ] Migrate `replaceHistory`, `clearAll`, undo last, all addFeature
      variants.
- [ ] Update `.nfab` serializer to read from Y.Doc instead of React state.

**Ship criteria**: single-user editing works identically with flag on. Multi-tab
sync works for feature tree only.

### Phase 2 — Body registry + simple scene (weeks 7-9)

- [ ] Map `BodyRegistry` to `Y.Map bodies + Y.Array bodyOrder` per §2.5.
- [ ] Convert all `addBody / removeBody / setVisible / reorder` call sites to
      transact() wrappers.
- [ ] Map `scene` to Y.Map per §2.8.
- [ ] Hide `volumeMm3 / bbox / surfaceAreaMm2` behind a derived view layer;
      writes go through a single recompute path.

**Ship criteria**: bodies panel and viewport stay in sync across tabs.

### Phase 3 — Sketches (weeks 10-14, longest phase)

The hardest because of solver coupling.

- [ ] Move `sketchData` out of the feature-tree node into top-level `sketches`
      Y.Map per §2.2. Node now has `sketchRef: string`.
- [ ] Per-segment Y.Map keyed by id. JSON-string `points` LWW.
- [ ] Constraints + dimensions as keyed Y.Maps.
- [ ] **Solver integration**: debounced 100 ms after last sketch event,
      writeback as `origin: 'solver-commit'` transact, suppress re-solve
      on remote solver-commit events.
- [ ] Auto-constraint inference UI runs against the Y.Doc, not React state.
- [ ] Expression evaluation (`resolveDimensionTargetsWithErrors`) is pure
      and unchanged — just reads from Y.Map snapshots.

**Ship criteria**: two users sketching the same .nfab in two tabs see each
other's lines, constraints solve consistently on both, undo per-peer works.

### Phase 4 — Assembly + mates (weeks 15-18)

- [ ] Flatten `assemblyTree.ts` per §2.6. Mint stable ids during migration.
- [ ] Convert `Mate.selections[i].bodyIndex → bodyId`. Migration script reads
      existing .nfab v2, indexes-to-ids by reading `assembly.placedParts[i].id`.
- [ ] Bump `.nfab` to **v3** with the bodyIndex→bodyId change; v2 files
      auto-migrate via existing chain.
- [ ] `matesSolver` runs locally, writes back transformed body positions
      under `origin: 'mates-solver'`, suppresses re-solve on remote.

**Ship criteria**: drag a body in one tab, see it animate in another tab
under mate constraints.

### Phase 5 — Cleanup + presence (weeks 19-22)

- [ ] Awareness layer: cursor, selection, "X is editing this field" toasts.
      Hook into existing `collab/AwarenessCursors.tsx`.
- [ ] Delete `useState`-backed legacy code paths and the `?crdt=*` feature
      flags.
- [ ] Snapshot policy: snapshot every 60 s of active editing or 5 KB of
      pending ops, whichever first.
- [ ] Conflict log UI surfaces (`collab/conflictLog.ts`) for orphan
      constraints, lost reorders, etc.
- [ ] Performance pass — confirm 100 ent / 50 con sketch hits the §5 budget.

**Ship criteria**: collab is the default. Single-user mode is just "one peer
on the doc". `.nfab` exports/imports are bootstrap-only.

### Cross-cutting tasks (parallel throughout)

- Permissions layer (owner / editor / viewer) — uses awareness for read-only
  enforcement; server-side guards in the DO for write rejection.
- Persistence: IndexedDB local + R2 snapshot + Postgres metadata.
- Test suite: every existing `*.test.ts` adds a "multi-peer" variant via
  `syncDocs` (which already exists in `collab/sketchCrdt.ts`).

---

## 7. Risk + Reversal Plan

### 7.1 Top risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Solver writeback storm degrades sync to >1 s lag | Medium | High | Debounce solver to 100 ms; tag origin; suppress remote-triggered re-solve (§5.4). Burn-in test at phase 3 exit. |
| Yjs doc size grows unbounded without snapshots | Medium | Medium | Auto-snapshot every 60 s active editing. Garbage-collect orphan refs in 30 s sweep. |
| `bodyId` migration corrupts in-flight .nfab v2 files | Low | High | Migration script tested on 50 sample .nfab files from internal use + 5 customer files (with permission) before phase 4 ship. Roll-back path = read v2 again on failure. |
| Yjs upstream breakage (1.x → 2.x) mid-migration | Low | High | Pin to a single 1.x version. Don't upgrade during the 5-month window. |
| Cloudflare DO costs balloon at scale | Medium | Medium | Per-doc DO, idle eviction after 30 min no activity. Cost cap per workspace; alert at $100/mo. |
| User churn from "edits got lost" because of conflict resolution | Medium | High | Awareness toasts on every concurrent-edit class; conflict log accessible from UI; "show recent changes" diff view. Phase 5 burn-in with 5 design-partner pairs. |
| 5-month migration timeline slips into Year 2 | High | Medium | Each phase ships independently; if phase N misses, phase N+1 starts behind the same feature flag. Wave 2 calendar accommodates 6 months actual vs 5 planned. |

### 7.2 Reversal (if CRDT path proves untenable)

The escape hatch is **"freeze at the last shipped phase boundary"**, because
every phase ships a working single-user fallback.

- **Reversal during phase 0-1** — flip the `?crdt=*` flag off everywhere.
  Zero impact: feature tree still works via React state. Delete CRDT code
  later.
- **Reversal during phase 2-3** — bodies & sketches were the migration; UI
  reads from React-state mirrors anyway. Stop syncing the Y.Doc; mirrors
  become authoritative. Lose collab. Two-week delete pass.
- **Reversal during phase 4** — mate `bodyId` is the only DB-breaking
  change. Reverse-migration script: rewrite `bodyId → bodyIndex` based on
  current `placedParts` order. Tested as part of phase 4 entry.
- **Reversal during phase 5** — sunset awareness UI, keep CRDT as
  "single-user with auto-persist". 1-week pass.

A **full retrofit later** is what ADR-010 wanted to avoid; this section is
the floor, not the plan.

### 7.3 Reversibility budget per phase

| Phase | Reversal cost (eng-weeks) | Data corruption risk |
|-------|---------------------------|----------------------|
| 0 | 0.5 | none |
| 1 | 1 | none (CRDT only writes to a parallel store while flag is off) |
| 2 | 2 | low (BodyRegistry mutations harder to undo) |
| 3 | 4 | medium (sketch storage in two places during transition) |
| 4 | 3 | medium (.nfab v3 needs reverse migrator) |
| 5 | 1 | none (cleanup-only) |

Total: ~11.5 eng-weeks for full reversal from end of phase 5. Acceptable
ceiling.

### 7.4 Decision checkpoints

After each phase ship, hold a 1-hour "continue / pivot / reverse" review
against these signals:

- Sync round-trip P95 < 200 ms over WebSocket
- Doc size growth < 10× the .nfab equivalent at end of week
- No more than 2 user-reported "my edit was lost" incidents per phase
- Solver re-run rate < 5 Hz steady-state
- Cloudflare DO cost per active doc < $0.10/day

If any two consecutive signals fail two reviews in a row, halt and
re-evaluate. ADR-010 commits to the goal, not the path.

---

## 8. Open Questions (parking lot)

These don't block design approval but must be answered before phase 4-5 ship:

1. **Branching / merge** ("git for CAD" pillar from ADR-010) — does it
   piggyback on Yjs snapshots, or do we need a custom semantic-merge layer
   over the document tree? Spike in phase 3 needed.
2. **Comments / annotations on geometry** — attached to face/edge tracker
   ids? `topologyRegistry.ts` stable across edits — verify with a CRDT round
   trip.
3. **Configurations** — does swapping the active configuration trigger N
   peer re-renders of the feature tree? Probably yes; debounce or apply
   only the diff.
4. **AI history** — chronologically ordered Y.Array fine. But does AI
   ingestion *replay* a doc back through prompts? If yes, snapshots break
   replay. Decision: snapshot is a baseline, full op log is retained in R2
   for replay-on-demand.
5. **NexyFlow integration** — when a NexyFab project is shared via NexyFlow,
   does the NexyFlow side embed the Y.Doc viewer or just an .nfab snapshot?
   Phase 5 decision.

---

## Appendix A — File-by-file CRDT call site index

For each of the six source files surveyed, the exact lines that will need
to be touched during migration. (Cross-reference for the engineer doing
the actual phases.)

### `constraintSolver.ts`
- Pure function; no mutation. **No direct CRDT changes**.
- Callers in `sketch/*.tsx` will switch from React-state arrays to
  Y.Doc-derived snapshots in phase 3.

### `useFeatureStack.ts`
- Lines 131-679 — entire hook gets a CRDT-backed twin `useCollabFeatureTree`
  per phase 1. Once shipped, the original is deleted.
- Line 521 (`sketchData` field) — replaced with `sketchRef: string` in
  phase 3.

### `bodyManagement.ts`
- Lines 50-62 (`addBody`, `removeBody`) — wrap in `transact()`.
- Lines 82-101 (visibility / locked / reorder) — Yjs Map.set replaces direct
  field assignment.
- Lines 46-48 (`createRegistry`) — replaced with `useBodyRegistry(doc)` hook.

### `assemblyTree.ts`
- Lines 31-47 (node types) — get `id: string` field added.
- Lines 90-116 (`flattenTree`) — pure; reads from CRDT projection; no
  internal change.
- Lines 128-145 (factories) — `leaf()` and `group()` now mint ids.

### `matesSolver.ts`
- Lines 33-44 (`MateSelection`) — `bodyIndex: number` → `bodyId: string`.
- Lines 87-90 (`SolveResult.bodies`) — returns ordered by `bodyId` lookup, not
  positional.
- Lines 579-725 (`solveAssembly`) — first line does `state.bodies.map` from
  Y.Map keyed lookup, not array index.

### `nfabFormat.ts`
- Bump version: `NFAB_FORMAT_VERSION = 3` in phase 4.
- New migration: `migrateV2ToV3` — index→id rewrite using `placedParts`.
- `serializeProject` reads from Y.Doc projection; `parseProject` produces
  bootstrap-only JSON for fresh doc creation per §3.5.

---

## Appendix B — Glossary

- **CRDT** — Conflict-free Replicated Data Type. Yjs (Y.js) is our specific
  implementation; uses a YATA-derived algorithm for arrays and observed
  remove sets for maps.
- **Y.Doc** — root container for shared state. One per project.
- **Y.Map / Y.Array** — keyed / ordered collections. Items can be other
  Y types or primitives.
- **transact** — atomic batch; produces one update message.
- **origin** — opaque tag on a transact; consumers can filter by origin.
- **awareness** — Yjs sidekick library for ephemeral per-peer state
  (cursors, selections, "is typing").
- **snapshot** — `encodeStateAsUpdate()` output; the full doc as a single
  binary blob. We store these in R2 every 60 s for fast bootstrap.
- **LWW** — last-write-wins. Yjs default for single-key conflicts.
- **DO** — Cloudflare Durable Object. Hosts one y-websocket session per doc.

---

*End of spike.* Design only — no source modifications. Approve to proceed
to phase 0.
