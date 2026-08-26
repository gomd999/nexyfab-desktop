# Guided AI production request boundary

- Recorded at: `2026-08-26T07:56:45Z`
- Scope: `platform`
- Integration target: `integration/nexyfab`
- Status: `PRODUCTION_ROUTE_PASS / GUEST_AUTH_FAIL_CLOSED /
  AUTHENTICATED_GENERATION_NOT_RUN`

## Delivered

- `e2e/guided-local-cad.spec.ts` now accepts the canonical trailing slash on
  `/api/nexyfab/scad-agent/` instead of waiting 180 seconds for a request that
  already occurred.
- The check binds the observed request to `ai_design`, the mechanical domain,
  selected-model routing, and user-confirmed critical dimensions.
- Because the scenario intentionally has no authenticated browser session, it
  now asserts the server's `401` response and filters only that expected browser
  resource message. All other console and page errors remain forbidden.
- The test retains the no-local-fallback assertion and verifies keyboard entry
  into Precision CAD selects the Inspector.

## Verification

- Live Chromium run against `https://nexyfab.com`: `1/1 PASS` in 19.5 seconds.
- Railway HTTP evidence showed the exact POST to
  `/api/nexyfab/scad-agent/` and an expected `401` for the guest session.

## Boundary

This proves production routing and the guest authorization boundary. It does
not authenticate a user, consume a model response, mutate a cloud project, or
grant commercial Precision CAD release authority.
