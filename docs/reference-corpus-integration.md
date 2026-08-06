# Reference CAD corpus integration

The external `참고파일들` directory is a read-only, quarantined validation corpus. It is not an application asset directory and no third-party CAD bytes may be committed, redistributed, uploaded, or inserted into model prompts.

## One integrated validation ladder

1. Inventory file metadata and SHA-256 content hashes; exclude `.env`, `.git`, `node_modules`, `result`, and `.gate_work`.
2. Deduplicate by content hash and record provenance/license separately. Unknown provenance means local validation only.
3. Route STEP/STP, STL, DXF, IFC, and SCAD to executable importer tests. Native SolidWorks, Inventor, CATIA, DWG, RVT, and PDF remain `not_run` until a governed loader/comparator exists.
4. Discover the scenarios in `cadCorpusManifest.ts`: robot motion, fasteners, gearbox, sheet-metal cabinet, weldment, heavy equipment, NIST PMI, and IFC4.3.
5. Execute deterministic geometry, assembly, manufacturing, PMI, and openBIM assertions. AI may classify intent and relationships, but it may not decide geometric validity.
6. Produce an evidence record with engine revision, input hash, assertions, explicit unsupported checks, and no RFQ/quote side effects.

## Release criteria

- Assembly hierarchy and independent part identity are preserved; flattening a product into one body fails.
- Part count, transforms, BOM quantity, mates/DoF, motion collision, and clearance are reported where applicable.
- STEP roundtrip compares solids, volume, transforms, and topology/PMI references.
- Sheet-metal and weldment cases produce deterministic bend/cut evidence.
- NIST cases distinguish semantic PMI from graphical PMI and bind callouts to stable topology references.
- IFC certification is a separate openBIM track covering GUID, hierarchy, material, quantity, and georeferencing.
- Unsupported native formats are `not_run`, never passed.

Run `npm run corpus:inventory -- "C:\\Users\\gomd9\\Downloads\\참고파일들" --output=<temporary-report.json>`. Keep the report outside commits when it contains source-relative filenames.

Run the bounded evidence adapters with `npm run corpus:verify -- "C:\\Users\\gomd9\\Downloads\\참고파일들" --output=<temporary-evidence.json>`. Use `--scenario=nist-pmi` for one scenario and `--max-bytes=52428800` to set the per-file safety budget. Exit `0` means every selected scenario passed, `4` means required evidence was `not_run`, and `5` means an executed check failed.

STEP first uses the editable pure-TypeScript classifier. If that cannot faithfully recover curved geometry, the runner promotes only that file to the existing isolated OCCT child-process importer. OCCT mesh evidence proves measured geometry, not parametric editability or semantic PMI; those assertions remain `not_run` until separately implemented.
