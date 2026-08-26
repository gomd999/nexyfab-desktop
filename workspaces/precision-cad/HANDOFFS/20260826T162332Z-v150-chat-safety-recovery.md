# Precision CAD handoff: v150 chat safety and recovery

- Created: `2026-08-26T16:23:32Z`
- Branch: `scope/precision-cad`
- Head: `e57c2e5771c15563a9e3258f53dac5eea2432166`
- Integration target: `integration/nexyfab`

## Summary

Compared the 622-pattern v150 reference gallery with the current main chat and
Precision CAD workspace. Adopted the two remaining high-value interaction
gaps: example prompts fill the input before any provider call, and a failed AI
run offers an explicit, localized retry. Existing version comparison, recovery,
CAD state, and session-job surfaces were retained instead of duplicated.

## Changed paths

- `src/app/[lang]/shape-generator/_shell/sidebars/AiChatPanel.tsx`
- `src/app/[lang]/shape-generator/_shell/sidebars/AiChatPanel.guided.test.tsx`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260826T162332Z-v150-chat-safety-recovery.md`

## Verified current product alignment

- Main chat starters cover attached 2D drawing to 3D, attached image to 3D,
  and complex product design in all six product locales.
- Main starter clicks populate and focus the composer; they do not submit.
- Raster input supports picker, clipboard paste, and drag/drop and separates
  drawing extraction from photo/reference fallback.
- `ChatResultShareTray` renders directly below the main composer with
  `GA_3D.html`, exact STEP, and package/source rows.
- Precision CAD already wires autosave crash recovery, recovery 3D compare,
  version/branch diff surfaces, and observed session job states.

## Verification

- [x] Focused guided AI panel regression: 1 file / 12 tests PASS.
- [x] Starter click changes the input and produces zero `fetch` calls.
- [x] Failed AI run exposes retry; retry performs exactly one new request.
- [x] Retry copy key parity passes for Korean, English, Japanese, Chinese,
  Spanish, and Arabic.
- [x] `npm run typecheck` — PASS (29.3s through the workspace check).
- [x] `npm run platform:architecture:check` — PASS with zero issues.
- [x] `npm run workspace:check -- precision-cad` — zero
  shared/foreign/unclassified path violations.

## Deliberately not copied from v150

- The generic pattern catalog, glow-heavy visual language, fake agent trace,
  and a second disconnected CAD shell do not improve the product workflow.
- Fake progress percentages were not added. The Jobs drawer continues to say
  when a live project queue was not queried.

## Remaining work and risks

- Connect the Jobs drawer to a real authenticated project queue only when it
  can display persisted job IDs, server states, cancellation policy, and
  deterministic receipts. Until then its orchestrator row remains `NOT_RUN`.
- The provider failure/retry path is unit-tested with a bounded mocked 503. It
  is not evidence that OpenAI or Qwen inference was executed in production.
- External Precision CAD qualification and manufacturing release gates remain
  unchanged and must not be inferred from this UX change.
