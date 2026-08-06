# NIST AP242 full STEP roundtrip baseline

Measured on 2026-08-04 with `npm run pmi:nist-full-roundtrip -- "C:\Users\gomd9\Downloads\참고파일들"`.

| Family | Solids | Volume delta | Semantic PMI | Face-link coverage | Graphical PMI | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| CTC | 1 → 1 | 0% | 20 → 20 | 1 → 1 | 46 → 46 | pass |
| FTC | 1 → 1 | 0.000000003% | 62 → 62 | 1 → 1 | 134 → 134 | pass |
| STC | 1 → 1 | 0% | 48 → 48 | 1 → 1 | 124 → 124 | pass |

The isolated OCCT import/export path followed by NexyFab's normalized semantic-PMI attachment and graphical-PMI dependency transplant preserves measurable solid count, volume, semantic PMI counts, bounded semantic-to-face linkage coverage, and graphical PMI counts for all three representatives. `step_roundtrip` passes for CTC, FTC, and STC.

Face links currently use a fail-closed same-face-count ordinal mapping for an immediate OCCT roundtrip; this baseline does not claim persistent topology identity across arbitrary feature edits. Quote creation, RFQ transmission, and source-file mutation remain disabled.
