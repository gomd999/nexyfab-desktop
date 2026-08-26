# AI Design handoff: chat-first model i18n closure

- Created: `2026-08-26T10:55:55Z`
- Branch: `scope/ai-design`
- Head: `3d0fa11d89fe8e86203e5d2415391922f3005b02`
- Integration target: `integration/nexyfab`

## Summary

The chat-first product entry is verified to fill localized 2D-drawing,
image-to-3D, and complex-product prompts without auto-executing them; accept a
single reviewable raster attachment through picker, paste, or drag/drop; and
carry an allowlisted OpenAI, Qwen, or DeepSeek model selection through chat
and CAD requests. This change completes the six-language AI Design V10 copy
contract and localizes every selectable model description. Provider keys were
checked by name only in the repository-external environment; no secret value
was read into source and no live provider call was made.

## Changed paths

- `src/lib/ai/aiDesignWorkspaceI18n.ts`
- `src/lib/ai/codegenModelI18n.test.ts`
- `src/lib/ai/codegenModelI18n.ts`
- `src/lib/ai/codegenModels.ts`
- `workspaces/ai-design/CURRENT.md`
- `workspaces/ai-design/HANDOFFS/20260826T105555Z-chat-first-model-i18n-closure.md`

## Verification

- [x] `npm run typecheck` — pass.
- [x] `npm run test:accuracy:common` — 11 files / 62 tests plus 7
  candidate-manifest tests pass.
- [x] `npm run workspace:check -- ai-design` — pass with zero shared,
  foreign, or unclassified ownership violations.
- [x] Focused ChatHero, model selector, model policy, launcher, workspace
  surface, and i18n regression — 7 files / 59 tests pass.

## Remaining work and risks

- Platform-owned AI Design V10 components must consume the new copy keys and
  localized model-note helper after this AI scope is integrated.
- A live authenticated OpenAI/Qwen/DeepSeek request was not executed, so
  provider credentials, quotas, latency, and output quality still require a
  staging smoke test.
- Independent holdout accuracy, expert review, exact-CAD qualification, and
  manufactured pilots remain pending; commercial accuracy and manufacturing
  release remain HOLD.
