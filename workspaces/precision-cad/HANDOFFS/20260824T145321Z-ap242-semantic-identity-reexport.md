# Precision CAD handoff — AP242 semantic identity re-export

- Created: `2026-08-24T14:53:21Z`
- Branch: `scope/precision-cad`
- Head: `f727a3dc8f029ce41389d339c8ac39aa718773a5`
- Integration target: `integration/nexyfab`
- Implementation commit: `f727a3dc`
- State: `LOCAL_AP242_SEMANTIC_ROUNDTRIP_PASS / RELEASE_HOLD`

## Summary

The production `occtImportStepText → exportOcctStep` path no longer silently
replaces imported assembly product identity with Open Cascade translator
defaults. A pure STEP Part 21 parser captures the PRODUCT and
NEXT_ASSEMBLY_USAGE_OCCURRENCE graph on import and binds it to the live OCCT
handle. Export applies the captured values only after the returned writer graph
matches the same product-tree signature.

The rebind covers:

- root product part number, name, and description;
- child product part number, name, and description;
- occurrence id, label, and description;
- nested product-tree structure and STEP quoted-string escaping.

The rebind does not rewrite geometry, placement, topology, or representation
entities. The result is parsed again and compared with the captured semantic
identity before bytes are returned.

## Changed paths

- `src/app/[lang]/shape-generator/features/occtEngine.ts`
- `src/app/[lang]/shape-generator/io/stepSemanticIdentity.ts`
- `src/app/[lang]/shape-generator/io/stepSemanticIdentity.test.ts`
- `src/app/[lang]/shape-generator/io/occtStepSemanticRoundtrip.test.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260824T145321Z-ap242-semantic-identity-reexport.md`

## Fail-closed behavior

- A returned tree with a different occurrence count or parent/child structure
  throws `STEP_SEMANTIC_TREE_MISMATCH`.
- An imported STEP containing PRODUCT semantics that cannot be safely captured
  remains viewable, but re-export throws
  `STEP_SEMANTIC_EXPORT_BLOCKED_UNSUPPORTED_SOURCE`.
- STEP block comments cannot inject fake semantic entities.
- Clearing the OCCT shape registry also clears the semantic registry.

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] `npm run workspace:check -- precision-cad`
- `npx vitest run .../stepSemanticIdentity.test.ts .../occtStepSemanticRoundtrip.test.ts --reporter=dot`
  - `2` files, `5/5` tests PASS.
  - Includes a real replicad/OCCT WASM open-export of the bound two-part AP242
    evidence source.
- Existing assembly/STEP regression:
  - `3` files PASS, `1` conditional feasibility file skipped;
  - `32` tests PASS, `6` conditional tests skipped.
- `npx tsc --noEmit`: PASS.
- focused ESLint: PASS.
- Precision workspace ownership and architecture check: PASS with no shared,
  foreign, or unclassified path violations.

## Remaining work and risks

This is local product-path proof, not independent interoperability evidence.
The following remain required before commercial release:

- an independent/native CAD C4 reopen-return campaign;
- signed operator and artifact receipts bound to the same design revision;
- broader assemblies than the bounded two-box local candidate;
- XCAF reader/traversal or an independently accepted equivalent for native
  product-structure inspection;
- external expert review and manufacturing pilots.

Integration should regenerate the local kernel and structure receipts after
merging `f727a3dc`; the current evidence files intentionally remain unchanged
on the source branch.
