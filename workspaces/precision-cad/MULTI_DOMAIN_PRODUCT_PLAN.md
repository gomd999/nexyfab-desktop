# Multi-domain usable design product plan

- Status: `INTERNAL_VERTICALS_IMPLEMENTED_EXTERNAL_QUALIFICATION_HOLD`
- Owner: `scope/precision-cad`
- Date: `2026-08-24`
- Domains: mechanical, building/architecture, civil, landscape, interior
- AI binding: `workspaces/precision-cad/AI_DESIGN_BINDING.md`
- Release effect: none; this document defines work and evidence requirements but
  is not itself product evidence.

## Objective

Build one genuinely usable, editable, verifiable design product in every domain,
then expand from those vertical products. A product is not complete because it
renders, produces a plausible image, exports one file, or passes self-authored
fixtures. It must preserve design intent through editing, produce the normal
domain deliverables, survive an independent exchange round-trip, and carry
current external evidence where the discipline requires it.

Precision has a domain-specific meaning:

- mechanical: exact analytic B-rep, feature/assembly semantics, tolerances, and
  manufacturing evidence;
- building: authoritative spatial/BIM semantics, coordinates, hosted elements,
  code-basis checks, drawings, schedules, and IFC consistency;
- civil: approved survey/CRS/datum, TIN, alignment/profile/corridor/drainage
  semantics, calculations, quantities, drawings, and exchange;
- landscape: approved terrain, grading and surface flow, planting/soil/hardscape
  semantics, irrigation, schedules, quantities, and maintenance information;
- interior: field-measured architecture host, space/circulation/door/furniture,
  ceiling-MEP-lighting, finish/millwork semantics, drawings, and schedules.

OCCT B-rep is authoritative for mechanical geometry and may support component
geometry elsewhere, but it is not a substitute for BIM, survey, terrain,
hydraulic, catalog, or regulatory authority.

## Implementation result (2026-08-24)

The Precision-owned internal product verticals are now implemented. This is an
implementation milestone, not a commercial release claim:

- common authority, maturity, deliverable, validation, qualification, connected
  dependency, and connected-pilot gates are implemented under `src/lib/cad/**`;
- mechanical has a strict flagship contract, deterministic model, real OCCT
  execution for seven B-rep parts, STEP export/re-import tests, deliverable
  binding, qualification, and an integrated product pipeline;
- building, interior, civil, and landscape each have a strict immutable
  contract, deterministic native schedules/drawing data, discipline verifier,
  deliverable binding, and common qualification adapter;
- civil earthwork uses hash-bound paired cell-center existing/proposed elevation
  grids and calculates cut, fill, net volume, and maximum depths instead of
  treating a grid hash as quantity evidence;
- `POST /api/cad/v1/product-qualification` exposes a bounded, rate-limited,
  side-effect-free entry point for the five verticals; it cannot create a quote,
  RFQ, approval, or commercial release;
- all original fixtures are explicitly synthetic one-case evidence. They can
  exercise the implementation but can never satisfy the 20-case, campaign,
  independent-review, round-trip, or real-pilot requirements below.

The domain registry remains conservative (`BLOCKED`, and legacy spatial UI
capabilities remain preview-oriented) until integration and external evidence
are complete. Missing survey, jurisdiction, catalog, independent exchange,
professional review, fabrication, and field-pilot evidence remains `HOLD`.

## Product maturity states

| State | Meaning | Who may create it |
| --- | --- | --- |
| `CONCEPT` | Assumptions and unresolved inputs are visible; preview only | AI Design or manual authoring |
| `DESIGN_CANDIDATE` | Structured, rights-bound, editable intent accepted | Precision candidate intake |
| `DOMAIN_VERIFIED` | Required internal deterministic validators passed on the current revision | Precision CAD only |
| `DELIVERY_CANDIDATE` | Normal deliverables and independent round-trip passed | Precision CAD plus reviewed external tools |
| `PRODUCT_QUALIFIED` | External authority, independent discipline review, and real pilot evidence passed | Governed release process only |

No average score may promote a state when a required authority or safety check is
`NOT_RUN`, `HOLD`, stale, or failed. AI output cannot directly create
`DOMAIN_VERIFIED`, `DELIVERY_CANDIDATE`, or `PRODUCT_QUALIFIED`.

## Common product definition of done

Every domain product must satisfy all of the following on one immutable source
revision and artifact graph.

### Authoritative inputs

- requirements, units, coordinate frame, assumptions, and unresolved decisions
  are explicit;
- source IDs, content hashes, capture/review times, rights basis, and allowed use
  are recorded;
- jurisdiction, governing rule set, edition/effective date, and reviewer are
  explicit where legal or safety rules apply;
- field, survey, catalog, or manufacturer data is not fabricated or inferred by
  the AI;
- source changes invalidate dependent calculations, drawings, quantities, and
  release evidence.

### Editable authoritative model

- objects have stable IDs and domain semantics, not only triangles or pixels;
- parameters and constraints can be edited without rebuilding the project by
  hand;
- relationships, host references, coordinate transforms, and revision lineage
  survive save/reopen and regeneration;
- unsupported operations fail closed instead of being silently simplified;
- preview geometry is visibly separated from authoritative geometry/model data.

### Verification

- every required domain axis is measured from artifacts, not self-reported;
- every measured value is bound to an input and result hash;
- validators report `NOT_RUN` when a fact cannot be established;
- required safety, authority, and release gates pass at 100%; they are not
  averaged into the general accuracy score;
- false verification and destructive object/part merging remain zero;
- two independent domain reviewers approve the ground truth and final pilot.

### Deliverables and interoperability

- the editable project, native NexyFab artifact, drawings, schedules/BOQ, reports,
  and required exchange files are generated from the same revision;
- drawing dimensions, labels, quantities, and schedules agree with the model;
- exchange files reopen in an independent target application or validator;
- critical IDs, units, coordinates, quantities, and relationships survive the
  round-trip within the declared tolerance;
- a representative design change regenerates every affected deliverable and
  invalidates stale ones.

### Product evidence

- at least 20 rights-cleared independent cases per domain cover the first-release
  capability set;
- every required evidence axis reaches at least the governed accuracy and
  coverage threshold; current policy target is 95% per axis, not only overall;
- three consecutive campaigns with five repeats meet the deterministic campaign
  policy;
- controlled beta may begin after one successful real reviewed pilot;
- a broad commercial usability claim requires at least three independent real
  pilots in that domain, with issue closure and regenerated final deliverables;
- marketing claims never exceed the exact domain, capability, jurisdiction, and
  evidence actually qualified.

## Cross-domain authority graph

The five products remain independently releasable, but shared authorities must
be versioned when projects connect:

```text
Approved survey / CRS / vertical datum
  +-> Civil site, surface and drainage
  +-> Building site placement
  +-> Landscape terrain and grading

Building host revision
  +-> Interior spaces, doors, ceilings and MEP references

Mechanical equipment envelope and service zones
  +-> Building service openings and coordination
  +-> Interior clearance and maintenance access

Civil proposed surface and drainage outlets
  +-> Landscape grading, surface flow and irrigation coordination
```

These links require versioned artifacts and hashes. A downstream product becomes
stale when its upstream authority changes. The shared artifact declarations are
integration-owned; this Scope records and validates consumer bindings locally.

## Product 1: mechanical design

### Flagship product

An adjustable motor-and-gearbox drive module with a machined base, shaft/coupling,
bearing supports, fasteners, protective guard, assembly mates, and inspection
features. It is complex enough to exercise real part, assembly, motion,
tolerance, drawing, and manufacturing workflows without depending on one
vendor-specific product shape.

### Required authoritative inputs

- motor and gearbox interface dimensions and permitted loads;
- speed, torque, duty cycle, service factor, alignment requirement, and design
  life;
- materials, stock/process choices, coatings, fastener specification, and
  purchased-component rights/provenance;
- critical dimensions, fits, datums, geometric tolerances, safety/guarding basis,
  and inspection method.

### Authoritative model and deliverables

- analytic part B-reps with editable feature trees;
- assembly occurrences, hierarchy, mates/joints, transforms, and allowed motion;
- stable topology references across parameter edits;
- STEP, native project, manufacturing drawings, BOM, tolerance/inspection report,
  DFM findings, and assembly/motion verification receipt.

### Blocking gates

- B-rep validity and one intended solid/body membership per part;
- feature completeness and critical-dimension tolerance;
- assembly DoF, continuous collision, alignment and service clearance;
- tolerance stack and fits;
- material/process/fastener consistency;
- STEP export/re-import and drawing consistency;
- load/life verification or an explicit `NOT_RUN` that blocks load-bearing
  claims;
- blind review and three fabrication/assembly pilots for commercial qualification.

### Precision-owned implementation focus

- `domains/mechanical/**` for the product contract, fixtures, and qualification;
- `src/lib/cad/**`, `src/lib/occt/**`, and `src/lib/assembly/**` for feature,
  topology, exact geometry, motion, tolerance, and persistence;
- `src/app/api/cad/v1/assembly/**`, `manufacturing/**`, `pmi/**`, `tolerance/**`,
  and `part-step/**` for bounded product endpoints;
- `containers/occt-exact/**` only through the reviewed job contract.

## Product 2: interior design

### Flagship product

A small office or retail fit-out bound to a surveyed host revision, including
rooms, doors, circulation, work/service furniture, reflected ceiling, lighting,
MEP coordination zones, finishes, and one buildable millwork package.

### Required authoritative inputs

- field measurements and the exact architecture host revision;
- user/occupancy program, accessibility and egress rule basis;
- door and furniture manufacturer dimensions with commercial-use provenance;
- ceiling, MEP, lighting, acoustic, finish build-up, and millwork requirements.

### Authoritative model and deliverables

- hosted spaces, openings, door swings, furniture/FFE, activity clearances,
  ceilings, lights, finish layers, millwork, and MEP references;
- editable layout plan, reflected ceiling plan, elevations, millwork details,
  finish/FFE schedules, BOQ, IFC/native artifact, and coordination report.

### Blocking gates

- field-measurement and host-revision binding;
- space closure, circulation, door swing, egress, accessibility, and furniture
  clearance;
- ceiling/MEP clashes and maintenance access;
- finish thickness, millwork dimensions, lighting and acoustic criteria;
- model/drawing/schedule/quantity agreement and IFC round-trip;
- code-authority and independent interior review.

### Precision-owned implementation focus

- replace preview-only boxes with revision-bound semantic interior documents;
- build on `interiorPlacement*`, `interiorGovernedChecks`, and the existing
  architecture/interior transaction and approval boundary;
- keep a failed or unavailable governed rule at `NOT_RUN`, never inferred pass;
- use `domains/interior/**`, `src/lib/cad/**`,
  `src/lib/precision-cad-agent/**`, and `src/app/api/cad/v1/interior/**`.

## Product 3: building/architecture

### Flagship product

A two-storey small commercial/office building core with approved site placement,
levels/grids, enclosed spaces, walls/slabs/roof, hosted doors/windows, stair and
egress routes, envelope layers, and coordinated service openings.

### Required authoritative inputs

- approved survey, CRS, vertical datum, project north, and site boundary;
- area/program, storeys, occupancies, loads and code basis;
- envelope, accessibility, egress, structural reference, and MEP coordination
  requirements;
- construction type and material/layer definitions with provenance.

### Authoritative model and deliverables

- versioned BIM objects and relationships, not viewer boxes;
- site/storey/grid/space/host/opening/stair/envelope/service-opening semantics;
- plans, elevations, sections, schedules, quantities, IFC/native model, and
  coordination report generated from the same revision.

### Blocking gates

- coordinate, level/grid, space closure, and host/opening integrity;
- stair/egress/accessibility rule checks for the declared jurisdiction;
- envelope continuity and service-opening/MEP coordination;
- schedule/quantity and drawing consistency;
- IFC semantic and geometry round-trip;
- approved survey, code authority, and independent professional review.

### Precision-owned implementation focus

- graduate `buildingSpatialModel` from parameterized preview generation to a
  revision-bound architecture document and verifier;
- keep the repository domain ID mapping explicit: product profile `building`
  corresponds to the owned target `domains/architecture/**`;
- use `src/app/api/cad/v1/architecture/**`, IFC routes, spatial commands, and
  coordination models without importing new AI implementation code.

## Product 4: civil design

### Flagship product

A small-site access road and stormwater package with approved existing TIN,
horizontal/vertical alignment, corridor and cross-sections, grading/daylight,
catchments, inlets/pipes/outfall, earthwork quantities, and staged drawings.

### Required authoritative inputs

- approved survey controls, CRS, horizontal/vertical datum, TIN and breaklines;
- road/alignment/profile/cross-section criteria;
- rainfall/catchment, hydraulic, pipe/material, outfall and authority criteria;
- geotechnical, structure, utility, boundary, and construction-stage inputs where
  applicable.

### Authoritative model and deliverables

- survey evidence, points, TIN, alignments, profiles, sections, corridor targets,
  catchments, drainage network, structures, and stages;
- alignment/profile sheets, cross-sections, grading/drainage drawings, earthwork
  and hydraulic reports, quantities, LandXML/IFC/native artifacts.

### Blocking gates

- survey closure, datum/CRS integrity and TIN quality;
- alignment/profile continuity and corridor target agreement;
- cross-section/daylight correctness and earthwork reproducibility;
- drainage connectivity, slope/cover/capacity and governed hydraulic checks;
- construction-stage and structure checks when claimed;
- LandXML/IFC round-trip, drawing and quantity consistency;
- approved survey/TIN/datum and independent civil/hydraulic review.

### Precision-owned implementation focus

- retain `civilSpatialModel` as concept-only until real survey evidence replaces
  `CONCEPT_UNVERIFIED`, unconfirmed datum, and synthetic evidence;
- build authoritative contracts and validators in `domains/civil/**` and
  `src/lib/cad/**` before exposing exact/product states;
- use civil CAD routes and existing engineering engines only with artifact-bound
  parameters and current calculation receipts.

## Product 5: landscape design

### Flagship product

A small plaza/courtyard landscape package bound to the approved civil/site
surface, with grading and flow paths, accessible hardscape, planting zones and
soil volumes, mature-canopy clearance, irrigation zones/network, BOQ, and a
maintenance plan.

### Required authoritative inputs

- approved terrain/site boundary, utilities, drainage outlets and constraints;
- climate/exposure and planting palette from rights-cleared supplier or expert
  data, including mature size and soil requirements;
- hardscape materials/joints/slopes, irrigation source/pressure and maintenance
  strategy;
- accessibility, safety, water and local planting requirements.

### Authoritative model and deliverables

- terrain modifiers, planting/soil/hardscape/irrigation/drainage/maintenance
  objects with stable IDs and revision lineage;
- grading, planting, hardscape and irrigation plans; planting/quantity schedules;
  BOQ, maintenance plan, IFC/native artifact and coordination report.

### Blocking gates

- approved terrain binding, grading and surface-flow continuity;
- plant data provenance, spacing and mature-clearance checks;
- soil-volume and hardscape slope/joint checks;
- irrigation connectivity, pressure/flow and water-budget checks;
- schedule/BOQ/drawing consistency and coordination with civil drainage;
- supplier/catalog rights review and independent landscape/irrigation review.

### Precision-owned implementation focus

- retain existing landscape viewer geometry as concept-only;
- replace synthetic catalog/terrain assumptions with immutable approved artifacts;
- implement product contracts and qualification under `domains/landscape/**`,
  `src/lib/cad/**`, and the owned civil/landscape tool executor paths;
- never promote a species, hydraulic, or maintenance assumption inferred by AI.

## Implementation program

### F0: common product kernel

Add Precision-owned common contracts and tests:

```text
src/lib/cad/domainAuthorityManifest.ts
src/lib/cad/domainAuthorityManifest.test.ts
src/lib/cad/domainProductState.ts
src/lib/cad/domainProductState.test.ts
src/lib/cad/domainProductReceipt.ts
src/lib/cad/domainProductReceipt.test.ts
src/lib/cad/domainDeliverableManifest.ts
src/lib/cad/domainDeliverableManifest.test.ts
```

The receipt binds requirements, authority inputs, semantic model, geometry/model
identity, relationships, calculations, drawings, schedules, exchange artifacts,
review decisions, and current blockers. It cannot infer `PASS` from missing data.

### F1: mechanical vertical product

Implement and qualify the drive module first because mechanical authoring is
`WORKING` and exact execution is already `PARTIAL`. Close current exact-feature,
topology, drawing, STEP, and external pilot blockers before claiming completion.

### F2: spatial authority foundation

Before the four spatial products, implement shared Precision consumer behavior
for coordinate frames, host/upstream revision hashes, semantic object IDs,
geometry fidelity, issue closure, drawings and schedules. Shared package
graduation remains an integration task.

### F3: interior vertical product

Use the existing governed checks and placement transactions to prove the first
spatial product. Replace preview catalogs and boxes with reviewed host, product,
finish and millwork data.

### F4: building vertical product

Extend the spatial authority foundation to site/storey/grid/space/host/opening
and IFC deliverables. Treat all code checks as jurisdiction- and revision-bound.

### F5: civil vertical product

Replace concept survey/TIN/datum inputs, then qualify alignment, corridor,
drainage, quantities and LandXML/IFC on a real reviewed site.

### F6: landscape vertical product

Bind to the approved site/civil surface, rights-cleared plant data and verified
irrigation inputs; qualify schedules, quantities and maintenance deliverables.

### F7: connected-project pilot

After each domain is independently usable, run one connected pilot that proves
survey -> civil/building/landscape, building -> interior, and mechanical
equipment -> building/interior coordination without allowing one domain's
unverified assumptions to authorize another.

## Per-domain code layout

Each owned domain should converge on the same local shape:

```text
domains/<domain>/domain.json
domains/<domain>/product/contract.ts
domains/<domain>/product/authority.ts
domains/<domain>/product/qualify.ts
domains/<domain>/product/deliverables.ts
domains/<domain>/product/fixtures/**
domains/<domain>/product/*.test.ts
```

For building use `domains/architecture`. Cross-domain common code stays under
`src/lib/cad/**`; exact mechanical geometry stays under `src/lib/occt/**` and
`src/lib/assembly/**`. New production endpoints stay under the owned
`src/app/api/cad/v1/**` paths. No new imports from AI-owned implementations are
introduced.

## Acceptance campaign

For each domain:

1. freeze the product contract and rights-cleared holdout manifest;
2. obtain two independent domain reviewers;
3. approve at least 20 cases covering every first-release capability;
4. run three campaigns with five repeats without tuning on the holdout;
5. require 95% minimum accuracy and coverage on every governed axis;
6. require 100% pass on safety, authority, release and critical round-trip gates;
7. execute one real controlled pilot and close all critical/major findings;
8. execute a representative revision/change request and regenerate all outputs;
9. expand to three independent pilots before a broad commercial usability claim;
10. retain `HOLD` for any unrun jurisdictional, professional, field or
    manufacturing validation.

## Copyright and data-rights application by domain

- manuals, standards and the engineering encyclopedia contribute concepts only;
  their original text, tables, diagrams, examples and structure do not enter
  fixtures, prompts, retrieval, source templates or product documents;
- standards are represented by independently implemented rule IDs, parameters,
  applicability and test cases, with edition/effective-date and rights review;
- manufacturer and plant catalogs require explicit commercial and derivative-use
  permission before data or geometry is shipped;
- customer drawings, surveys, field measurements and BIM/CAD files remain
  tenant-scoped immutable inputs with purpose and retention controls;
- generated drawings and schedules are produced from the independent NexyFab
  model, not by tracing or reproducing a reference document's expressive layout;
- unclear rights always block product qualification rather than being hidden by
  paraphrasing or metadata stripping.

## External actions that code cannot complete

- obtain approved survey, TIN, vertical datum and field-measurement artifacts;
- license manufacturer, plant supplier and external CAD/BIM validation data;
- select and record current jurisdictional rule bases;
- recruit at least two independent reviewers per domain;
- provide external CAD/BIM applications or validators for round-trip evidence;
- manufacture/assemble mechanical pilots and conduct building/civil/landscape/
  interior field pilots;
- obtain professional or authority sign-off where law, contract or safety
  practice requires it.

These remain visible `HOLD` items. They must never be fabricated, replaced by AI
judgment, or marked complete from unit tests alone.
