# AI authentication feedback handoff

- Recorded at: `2026-08-26T07:56:46Z`
- Scope: `precision-cad`
- Integration target: `integration/nexyfab`
- Status: `USER_ACTIONABLE_401 / SIX_LOCALES_PASS /
  AUTHENTICATED_EXECUTION_NOT_RUN`

## Delivered

- `AiChatPanel` maps an expected SCAD-agent `401` to a direct sign-in and retry
  instruction in all six supported product languages.
- The existing fail-closed behavior is unchanged: an authentication failure
  does not silently switch models, run a deterministic local replacement, or
  mutate the current CAD project.
- The guided-panel regression now exercises the actual `401` response and
  verifies the localized user-facing diagnostic.
- The governed auto-run test counts only calls to the SCAD-agent endpoint, so
  the independent runtime model-access fetch cannot make the test order- or
  cache-dependent.

## Verification

- `AiChatPanel.guided.test.tsx` and `aiChatTransport.test.ts`:
  `2 files / 13 tests PASS`.

## Boundary

The authenticated provider run was not executed because no user credential was
introduced into the production browser check. Provider readiness and selected
model routing remain covered separately; authentication is not weakened.
