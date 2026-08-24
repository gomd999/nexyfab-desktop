# GP-01 General-Purpose CAD Capability Matrix

Status: inventory only (2026-08-24). This is a repo-evidence ledger, not a
product claim or release qualification. A registry entry, UI label, synthetic
fixture, self-authored receipt, or preview mesh is not treated as exact kernel
or independent exchange evidence.

Current bounded check receipt: on 2026-08-24, eight cited registry, parameter,
feature persistence/reference, OCCT plan/stub, DXF gate, and IFC route test files
passed (`93/93`). This confirms only the bounded rows named by those tests; it
does not close exact-worker or independent-exchange blockers.

## Classification

- `EXACT`: the cited implementation and tests establish deterministic behavior
  for the stated bounded scope (not unrestricted feature parity).
- `APPROXIMATE`: useful result exists, but it is mesh/stub/reduced-fidelity,
  local-cache, heuristic, or otherwise not authoritative exact geometry.
- `PREVIEW`: planning/UI/synthetic/domain-gate scaffolding exists, but the
  authoritative or independent evidence required for delivery is absent.
- `UNSUPPORTED`: no owned implementation/evidence was found for the stated
  capability; do not silently fall back.

## Evidence matrix

| Capability / bounded claim | Status | Direct repository evidence | Known boundary / gap | First corpus candidate | ko | en | ja | zh | es | ar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Feature definition and map (the 39 `FeatureType` cases listed by the shape-generator test) | EXACT | `src/app/[lang]/shape-generator/features/index.ts`; `src/app/[lang]/shape-generator/features/__tests__/registryCompleteness.test.ts` | Registration and parameter dispatch do not prove an exact kernel implementation for every case | One fixture per `FEATURE_MAP` key, including rejected/invalid inputs | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| AI parameter ranges and buildable-type allow-list | EXACT | `src/app/[lang]/shape-generator/features/featureParamSchema.ts`; `src/app/[lang]/shape-generator/features/__tests__/featureParamSchema.test.ts` | Ranges clamp input; they do not prove geometric validity or domain qualification | Boundary, NaN, unknown-type, and every-map-key cases | EXACT | EXACT | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE |
| Feature-tree structural validation and deterministic JSON round-trip | EXACT | `src/lib/cad/featureTree.ts`; `src/lib/cad/featureTreePersist.ts`; `src/lib/cad/featureTreePersist.test.ts` | Schema is currently v1; this is a tree artifact, not server canonical revision | All `KNOWN_KINDS`, cycles, duplicate IDs, version mismatch, serialize/deserialize identity | EXACT | EXACT | EXACT | EXACT | EXACT | EXACT |
| Browser autosave/local recovery | APPROXIMATE | `src/lib/cad/featureTreePersist.ts` (localStorage, v1, quota handling); `src/lib/cad/__tests__/persistPromotion.test.ts` | Explicitly a browser cache; no authoritative server/IndexedDB journal or multi-user merge | Crash, quota, stale-tab, reopen, and promotion-failure cases | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE |
| Upstream feature-reference promotion and topology-reference reconciliation | EXACT | `src/lib/cad/featureTreeMigrate.ts`; `src/lib/cad/featureTreeReferenceReconcile.ts`; corresponding `*.test.ts` | Stable naming across arbitrary imported/native kernels is not established | Rename, suppressed node, missing/ambiguous face-edge reference corpus | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Feature-tree to OCCT command planning (bounded extrude/revolve/boolean/fillet/chamfer/shell paths) | PREVIEW | `src/lib/occt/featurePlan.ts`; `src/lib/occt/featurePlan.test.ts` | Planner emits commands and explicitly reports unsupported pattern/sweep cases; no proof of successful real-kernel execution here | Plan-vs-worker receipt for each command and each unsupported reason | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Browser OCCT bridge primitive build and tessellation | APPROXIMATE | `src/lib/occt/bridge.ts`; `src/lib/occt/bridge.test.ts` | File is explicitly a stub bridge; mesh tessellation has no kernel deflection control and partial revolve uses an envelope | Real `occt-exact` worker parity for primitive, fillet, shell, boolean, and failure cases | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Exact B-rep hydration from a STEP artifact (runtime handle binding) | PREVIEW | `src/lib/cad/canonicalCadBrepHydration.ts`; `src/lib/cad/canonicalCadBrepHydration.test.ts` | Requires runtime `occtEngine` and a valid registered shape; test mocks the engine and is not an independent kernel run | Rights-cleared STEP corpus with independent import, shape hash, and reopen/replay | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| STEP export/import round trip | PREVIEW | `src/lib/occt/bridge.ts`; `src/lib/occt/bridge.test.ts`; `domains/mechanical/product/model.occt.test.ts` | Stub handles bounded generated features; mechanical qualification requires an independent validator and hashes | 30 mechanical parts, export/import in a second kernel, topology and geometry comparison | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Mechanical delivery/qualification exchange gate | PREVIEW | `domains/mechanical/product/pipeline.ts`; `domains/mechanical/product/pipeline.test.ts`; `domains/mechanical/product/qualify.ts` | Gate correctly stays blocked without independent STEP evidence, reviewer, and pilot; synthetic PASS fixtures are not external evidence | 20 rights-cleared parts, 3 deterministic campaigns, 2 independent reviewers, 3 pilots | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Architecture/interior/civil/landscape semantic products and native artifacts | PREVIEW | `domains/architecture/product/**`; `domains/interior/product/**`; `domains/civil/product/**`; `domains/landscape/product/**` | Product contracts and fixtures exist, but external authority, independent exchange, and field evidence remain required (`workspaces/precision-cad/CURRENT.md`) | One small, one irregular, and one revision/invalidation case per domain; independent IFC/site-model checks | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Assembly, drawing, PMI, inspection, simulation, and CAM catalog exposure | PREVIEW | `src/app/[lang]/shape-generator/featureCatalog/registry.ts`; `src/app/[lang]/shape-generator/featureCatalog/registry.test.ts` | Catalog metadata/entry hints are not proof that the module is wired, exact, or delivery-qualified | For each claimed entry: load, execute, deterministic receipt, and domain checker | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Mesh boolean/direct editing/imported-mesh editing | APPROXIMATE | `src/app/[lang]/shape-generator/featureCatalog/registry.ts` (mesh/direct-edit entries); `src/app/[lang]/shape-generator/ai/AiAssistantShell.tsx` (imported mesh routed to SCAD) | Mesh/SCAD path has no parametric exact history and must not be presented as B-rep | STL/OBJ import-edit-export with measured deviation and explicit provenance | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE |
| DXF 2D bounded ingest and self round trip | APPROXIMATE | `src/lib/cad-ir/ingestDxf2d.ts`; `src/lib/cad-ir/gate2d.test.ts`; `src/lib/cad-ir/dxfCorpusEval.test.ts` | ASCII subset and modeled evidence only; the emitter explicitly is not a full writer, corpus may skip when absent, and self round trip is not independent exchange evidence | Rights-cleared DXF profiles, layers, units, arcs, blocks, encodings, and independent target round trip | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE |
| Full DXF authoring/exchange | UNSUPPORTED | No full owned DXF reader/writer, entity-coverage matrix, or independent target round-trip receipt found | Bounded `cad-ir` ingest must not be promoted to general DXF support | Full entity/layer/block/unit corpus and independent target application reopen | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |
| LandXML / civil survey exchange | UNSUPPORTED | No owned LandXML parser/writer or round-trip test found in `src/lib/cad`, `src/lib/occt`, or `domains/civil/product` | Civil fixtures are semantic product scaffolding, not LandXML conformance | CRS/datum, TIN, alignment, corridor, quantity, and independent LandXML round trip | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |
| IFC bounded analysis/verification consumers | PREVIEW | `src/app/api/cad/v1/ifc/**`; domain deliverable/qualification code under `domains/**`; shared read-only parsers under `src/lib/bim/**` and `src/lib/reference/**` | Precision owns bounded routes and gates, not the shared parsers; tests use synthetic inline IFC and no independent target receipt qualifies full exchange | IFC 4.3 element/property/quantity/placement round trip per architecture/interior/site corpus | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |
| Shared application locale resolution and six-locale shell | EXACT | Read-only shared evidence: `src/lib/i18n/adminTranslations.ts`, `src/lib/i18n/adminTranslations.test.ts`, `src/lib/i18n/clientLocale.ts` | Shared admin navigation contract is not Precision-owned CAD terminology, RTL layout, or export qualification | Precision-local six-locale catalog plus Arabic RTL, number/unit/date formatting | EXACT | EXACT | EXACT | EXACT | EXACT | EXACT |
| Shape Generator CAD terminology/catalog translation coverage | APPROXIMATE | `src/lib/i18n/catalogLocalizer.ts`; `src/lib/i18n/commercialLocalizer.ts`; `src/app/[lang]/shape-generator/analysis/AIAdvisor.tsx` | Legacy Korean/English dictionaries and fallback-to-English behavior mean no six-locale key-parity proof for the CAD surface | Extract all feature/command/error/receipt keys; parity, placeholders, units, RTL screenshots for ko/en/ja/zh/es/ar | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE | APPROXIMATE |
| Agentic exact-design claim / authoritative command integration | PREVIEW | `src/app/[lang]/shape-generator/ai/*.test.tsx`; `src/lib/ai/**`; `workspaces/precision-cad/GENERAL_PURPOSE_AGENTIC_CAD_MASTER_PLAN.md` | AI tests exercise guided/local behavior; shared versioned envelope, approval, production job, and exact receipt wiring are not in this scope | Prompt → intent → dry-run → approval → exact build → independent verify → rollback | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW | PREVIEW |

## Gaps and sequencing

1. The largest false-positive risk is treating `FEATURE_REGISTRY` or an entry
   hint as implementation evidence. GP-05 should establish one canonical
   feature registry with an explicit no-silent-fallback result.
2. The browser OCCT bridge and SCAD/mesh paths must remain visibly
   `APPROXIMATE` or `PREVIEW` until a real exact worker receipt and an
   independent checker exist. The plan's `30-feature exact closed loop` is the
   first mechanical gate, not an assumption about current coverage.
3. Persistence currently has two truths: versioned localStorage feature-tree
   JSON and the newer revision/product stores. GP-02/GP-03 should define the
   canonical document, replay, rollback, and recovery lineage before expanding
   domain features.
4. STEP has bounded synthetic coverage. DXF has a limited ASCII 2D ingest and
   self-round-trip path but no full or independent exchange qualification;
   LandXML has no owned exchange path found here. IFC has bounded routes and
   gates, not a passed independent round trip.
5. i18n has a tested six-locale admin shell but not a six-locale CAD command,
   error, receipt, unit, drawing, or export corpus. GP-06 should add locale
   neutral codes and key-parity/RTL/format tests before release claims.

## Suggested first corpus slices

- `mechanical-30`: extrude/revolve, hole, fillet/chamfer/shell, booleans,
  patterns, references, suppression, save/reopen/replay/rollback, STEP export
  and independent import/hash comparison.
- `fallback-boundaries`: every planner `unsupported` kind, bridge warning,
  mesh/SCAD edit, malformed artifact, stale revision, and exact-kernel failure;
  assert no silent promotion to `EXACT`.
- `locale-6`: the same command/error/receipt and dimension/unit cases in
  ko/en/ja/zh/es/ar, including Arabic RTL and placeholder/number/date/unit
  preservation.
- `spatial-exchange`: small and irregular architecture/interior/civil/landscape
  models with IFC/site-model/LandXML candidates, independent validators, and
  revision invalidation receipts. Keep unsupported formats blocked until their
  parser and round-trip corpus exists.
