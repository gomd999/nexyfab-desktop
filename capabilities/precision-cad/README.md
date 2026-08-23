# Precision CAD capability

This directory is the target boundary for exact CAD authoring, execution, and
domain behavior. Existing production paths remain active as compatibility
sources until each migration slice has passed its CAD-specific checks.

- UI compatibility root: `src/app/[lang]/shape-generator`
- CAD implementation roots: `src/lib/cad` and `src/lib/precision-cad-agent`
- Domain boundaries: `domains/`
- Cross-Scope types: `packages/artifact-contracts`, `packages/cad-contracts`,
  and `packages/job-contracts`

New isolated CAD modules should start here. Existing modules move here only in
small batches with compatibility exports; this folder does not claim that the
legacy runtime has already been migrated.
