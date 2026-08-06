# CAD manual requirement traceability baseline

This baseline joins the 20 read-only manuals, current code, and external golden scenarios. `manual-index.json` contains SHA-256 provenance without copied PDF bytes. `manual-requirements.json` is the machine-validated status source.

| Requirement | Capability | Baseline status | Golden scenario | Next closure evidence |
|---|---|---|---|---|
| MAN-FT-001 | Ordered parametric Feature Tree | partial | gearbox | OCCT Pattern/Rib plus STEP roundtrip |
| MAN-SEL-001 | Face/edge/part chat editing | implemented_verified | fastener stack | API, browser transaction, stale-selection, B-rep and affected-part invalidation tests |
| MAN-ASM-001 | Mate residual and DoF | implemented_verified | MeArm | real neutral assembly fixture |
| MAN-ASM-002 | Independent part hierarchy | implemented_verified | gearbox | actual occurrence hierarchy, local/world transform and part/body boundary evidence |
| MAN-IO-001 | STEP hierarchy roundtrip | implemented_verified | gearbox | actual part count, NAUO, transform and cycle-free comparison |
| MAN-SM-001 | Flat pattern, bend evidence, DXF | implemented_verified | cabinet | real cabinet fixture |
| MAN-WL-001 | Miter and cut list | implemented_verified | welded structure | real frame fixture |
| MAN-PMI-001 | Semantic PMI on stable topology | partial | NIST PMI | Semantic AP242 normalization roundtrip passes; full geometry export and persistent-name identity remain |
| MAN-UX-001 | Shared general/expert project | partial | MeArm | cross-mode browser E2E |
| MAN-SURF-001 | Loft/sweep/NURBS/B-rep | implemented_unverified | NIST PMI | real curved STEP corpus |
| MAN-GRAPH-001 | User-editable data-flow graph | not_implemented | — | product decision |
| MAN-CIV-001 | Civil corridor modeling | not_implemented | IFC4.3 | later vertical track |
| MAN-HEAL-001 | Governed B-rep healing approval | partial | NIST PMI | OCCT ShapeFix/Sewing adapter plus before/after kernel evidence |
| MAN-BIM-001 | IFC spatial hierarchy and placement | implemented_verified | IFC4.3 | actual IFC corpora: explicit units, hierarchy, physical-element filtering, world matrices and GUID/property roundtrip |
| MAN-INT-001 | Interior spatial/egress/MEP verification | partial | interior office | closed-boundary, door-swing swept volume and exact MEP geometry |
| MAN-CCD-001 | Continuous collision detection | implemented_verified | MeArm | linear swept AABB, adaptive rotational subdivision, precise mesh-distance proof and bounded TOI bracket tests |

`implemented_verified` here means a deterministic engine path already has automated coverage; it does not mean the linked third-party golden file has passed. Real-corpus certification remains a separate required evidence layer.

## Actual-corpus AI finalizer evidence (2026-08-05)

The AI finalizer now re-analyzes the submitted STEP bytes server-side instead of
accepting client-authored pass claims. The same contract is forwarded unchanged
by Web, API, CLI, and MCP. These reports contain the raw-file SHA-256 and byte
length, but never the source path or STEP contents.

| Requirement | Corpus | Server-derived result | Evidence |
|---|---|---|---|
| MAN-SM-001 | `A0101.STEP` electrical cabinet | pass: 2 exact flat patterns; authoritative empty bend table because both classified panels are planar extrudes with no in-plane coaxial bend surfaces | `ai-finalizer-electrical-cabinet-latest.json` |
| MAN-WL-001 | `SPIRAL STAIRCASE.stp` | pass: 2 structural members, 2 resolved end-cut pairs, 2 deterministic cut-list groups | `ai-finalizer-spiral-staircase-latest.json` |

Both runs report `quoteOrRfqSideEffects: false`. A missing/malformed STEP remains
`not_run` with affected-part-only re-export/heal remediation; it cannot become an
implicit pass.
