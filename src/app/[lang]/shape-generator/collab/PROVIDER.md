# CollabProvider — Wave 2 Phase 3 Week 1 Track Z1

**Status:** foundation laid, not yet wired into `ShapeGeneratorInner.tsx`
(that's Z2/Z3/Z4). Multi-tab BroadcastChannel + IndexedDB work today, no
infra needed. WebSocket transport is flag-gated on
`NEXT_PUBLIC_OCCT_COLLAB_WS_URL` and falls back gracefully.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         CollabProvider                                 │
│                                                                        │
│  ┌──────────┐    ┌────────────┐    ┌────────────────┐   ┌───────────┐  │
│  │  Y.Doc   │◄──►│ Awareness  │◄──►│ BroadcastChan  │◄─►│ Same-tab/ │  │
│  │          │    │ (presence) │    │  (same-origin) │   │  cross-   │  │
│  │          │    └────────────┘    └────────────────┘   │   tab     │  │
│  │          │                                            └───────────┘  │
│  │          │    ┌────────────────┐                                     │
│  │          │◄──►│ y-indexeddb    │ (offlinePersistence.ts, Phase 1 W2) │
│  │          │    │  (per-doc DB)  │                                     │
│  │          │    └────────────────┘                                     │
│  │          │                                                           │
│  │          │    ┌────────────────────────┐    ┌──────────────────┐    │
│  │          │◄──►│ y-websocket            │◄──►│ occt-collab-     │    │
│  │          │    │ (flag-gated)           │    │  worker          │    │
│  └──────────┘    └────────────────────────┘    │ (Cloudflare DO)  │    │
│                                                 └──────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

Transport priorities, from cheapest to most expensive:

1. **BroadcastChannel** — zero infra, always-on when the browser supports it.
   Carries every doc update + awareness update to other tabs of the same
   origin. Works offline.

2. **IndexedDB** — local cache, source-of-truth for in-progress edits per
   ADR-010. Survives tab close + refresh. Reuses the `setupOfflinePersistence`
   helper from Phase 1 W2.

3. **WebSocket** — only when `NEXT_PUBLIC_OCCT_COLLAB_WS_URL` is set.
   Talks to the Cloudflare Durable Object (`occt-collab-worker/`); auth via
   JWT (Z4 of Phase 3 will mint these client-side).

All three run concurrently when available. y-websocket's own internal
BroadcastChannel is **disabled** (`disableBc: true`) — we have our own so
the local-only mode works without WS.

## Env var contract

| Var                                    | Value                                          | Effect                                  |
| -------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_OCCT_COLLAB_WS_URL`       | unset                                          | Local-only mode (BC + IDB). Default.    |
| `NEXT_PUBLIC_OCCT_COLLAB_WS_URL`       | `wss://occt-collab.nexyfab.workers.dev`        | Production wiring (post task #31)       |
| `NEXT_PUBLIC_OCCT_COLLAB_WS_URL`       | any unreachable URL                            | Falls back to BC + IDB; badge → "Disc." |

The Provider appends `/ws/${docId}` to the configured base URL — matches
the worker route in `occt-collab-worker/src/index.ts`.

## How to test multi-tab locally

No infra needed:

1. `npm run dev`
2. Visit `http://localhost:3000/en/collab-smoke-provider` in two tabs of the
   same browser.
3. Set the local peer name in one tab → see it appear under "Remote peers"
   in the other.
4. Click "+1" in one tab → counter increments in both.
5. Close one tab + refresh the other → counter persists (IndexedDB).

The connection badge (top-right) shows "Local-only" — BC active, no WS.

## How to wire into production

**Blocked on Phase 0 backlog task #31** (deploy occt-collab-worker to
Cloudflare). The worker is already scaffolded under `occt-collab-worker/`
with the Durable Object + Hono routes ready, but never deployed.

Production-ready steps (in order):

1. Deploy `occt-collab-worker` via `cd occt-collab-worker && wrangler deploy`.
   Confirm `wss://occt-collab.nexyfab.workers.dev/healthz` is 200.

2. Set `NEXT_PUBLIC_OCCT_COLLAB_WS_URL=wss://occt-collab.nexyfab.workers.dev`
   in the Railway env (NexyFab main app) and in `.env.production.local` for
   local prod-mode debugging.

3. Wire JWT mint at app boot — the worker expects a HS256-signed JWT
   matching the main app's `JWT_SECRET`. Pass via query string:
   `${base}/ws/${docId}?token=<jwt>` — extend the Provider's WS connection
   options. (Z4 work, separate week.)

4. Verify the badge flips to "Online (N peers)" with WS connected.

## What this file does NOT do

- Wire the doc into `ShapeGeneratorInner.tsx` — Z2/Z3/Z4 phases per ADR-010.
- Render multi-cursor / selection overlays — `AwarenessCursors.tsx` (already
  exists for the legacy WS transport) gets re-wired against this Provider's
  awareness in Z2.
- Mint or verify JWT — handled separately.
- Modify the existing CRDT primitives (`sketchYjs.ts`, `featureTreeYjs.ts`,
  `configStoreYjs.ts`) — those are Phase 1/2 finalised contracts.

## Files

- `CollabProvider.tsx` — Provider + hooks
- `awareness.ts` — PeerInfo type + encode/decode helpers + color hash
- `CollabConnectionBadge.tsx` — status indicator
- `../../../collab-smoke-provider/page.tsx` — demo harness route
- `__tests__/CollabProvider.test.tsx` — lifecycle + hook contract
- `__tests__/awareness.test.ts` — pure helpers
- `__tests__/CollabConnectionBadge.test.tsx` — render
