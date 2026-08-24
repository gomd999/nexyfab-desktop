# Precision CAD multi-domain product vertical handoff

- Recorded at: `2026-08-24T06:09:44+09:00`
- Branch: `scope/precision-cad`
- Owner: `scope/precision-cad`
- Implementation state: `INTERNAL_VERTICALS_IMPLEMENTED`
- Commercial release state: `HOLD`

## Delivered

- Common fail-closed authority, state, deliverable, receipt, qualification,
  spatial binding, dependency invalidation, and connected-project qualification
  modules under `src/lib/cad/**`.
- Mechanical motor/gearbox drive-module product contract, rights authority,
  deterministic feature models, seven real OCCT B-rep builds, STEP round-trip,
  deliverables, domain checks, and integrated pipeline.
- Building commercial-core, interior fit-out, civil access-road/drainage, and
  landscape plaza/courtyard strict contracts, deterministic native artifacts,
  deliverable bindings, discipline checks, and common qualification adapters.
- Reproducible civil paired-grid earthwork calculation with grid hash, layout,
  cut/fill depth, balance, and tamper gates.
- Side-effect-free `POST /api/cad/v1/product-qualification` service boundary for
  all five products. It never releases, quotes, or creates an RFQ.

## Internal evidence

- Domain product suite: 33 files, 155 tests passed, including real OCCT STEP
  export/re-import for every mechanical flagship part.
- Product service and route: 2 files, 4 tests passed.
- Precision CAD kernel regression: 95 files, 957 tests passed after the final
  product-service and connected-project additions.
- TypeScript: passed.
- Final workspace scope check: passed for 121 changed files with zero shared,
  foreign, or unclassified-path violations; architecture and TypeScript checks
  also passed.

Synthetic unit fixtures are original and rights-cleared for testing, but they
are one-case implementation evidence only. They are not external, independent,
field, manufacturing, jurisdictional, or commercial evidence.

## Release blockers by domain

| Domain | Internal implementation | External/current blockers |
| --- | --- | --- |
| Mechanical | exact B-rep parts, model, STEP, pipeline | governed loads/life, independent drawing/DFM and STEP evidence, 20 cases, campaigns, blind reviews, three fabrication/assembly pilots |
| Building | BIM-semantic contract, native schedules/plan, verifier | approved survey/CRS, current jurisdictional code basis, independent IFC round-trip, professional review, three field pilots |
| Interior | surveyed-host contract boundary, schedules/drawing data, verifier | actual field survey/host, code and manufacturer authority, independent exchange, professional review, three fit-out pilots |
| Civil | survey/TIN/alignment/corridor/drainage, paired-grid earthwork | approved survey/datum/TIN, governed hydraulic analysis, independent LandXML/IFC, professional review, three site pilots |
| Landscape | terrain/grading/planting/soil/irrigation/maintenance | approved civil terrain, licensed plant catalog, governed hydraulic/climate/code evidence, independent site-model round-trip, professional review, three pilots |

The connected-project gate also stays `HOLD` until all five bound domain
receipts are genuinely `PRODUCT_QUALIFIED`; a caller-supplied boolean cannot
promote it.

## Copyright and AI Design boundary

- No manual or encyclopedia prose, table, diagram, example sequence, screenshot,
  source code, or expressive layout was copied.
- Only general engineering concepts and independently selected synthetic test
  values were implemented.
- Catalog, standard, customer, survey, and manufacturer inputs require explicit
  provenance, rights receipts, current revision hashes, and approved-use state.
- AI Design remains candidate/intent-only. The future cross-worktree binding is
  defined in `AI_DESIGN_BINDING.md`; this branch did not edit `src/lib/ai/**` or
  a shared integration package.

## Integration next step

On `integration/nexyfab`, graduate one versioned shared AI intent envelope,
connect the legacy spatial authoring UI to the product-qualification API, and
bind immutable external evidence retrieval. Do not change any `HOLD` to `PASS`
until the exact current-revision artifacts and independent evidence exist.
