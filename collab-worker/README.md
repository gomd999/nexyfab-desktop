# collab-worker

Phase 6.4 server side of NexyFab's collaborative editing
(`src/lib/collab/crdtAdapter.ts`, `transport: 'websocket'`). Relays Yjs
sync + `y-protocols/awareness` frames between every client that joins the
same `docId`.

`crdtAdapter.ts` already wires a real `WebsocketProvider` from `y-websocket`
when its transport is `'websocket'`. This directory provides the other end of
that socket. The wire format is the canonical y-websocket framing
(`MESSAGE_SYNC = 0`, `MESSAGE_AWARENESS = 1`), so the client adapter does
not need any server-aware code paths.

## Deployment options

### Option A — Node.js relay on Railway (recommended for Phase 1)

> `server.js` — single-instance, in-memory, easy to operate.

- One process holds every active room. ~10MB Y.Doc fits ~hundreds of
  concurrent docs in <1GB RAM. Past that, scale by `docId` sharding
  (consistent hash to N replicas) or jump to Option B.
- No persistence: rooms are torn down when the last client leaves. CRDT
  merge from each client's local copy keeps reconnect safe, but a
  server-side cold restart with zero clients online truly resets state.
  Phase 2 wishlist below.
- Health endpoint: `GET /healthz` → `{ ok: true, rooms: <N> }`.
- Backed by `ws` (already a transitive dep) + `y-protocols` + `yjs`
  (already in package.json). **Zero new top-level deps required.**

Quick start:

```powershell
# from repo root
npm run collab:dev
# → [collab] listening on ws://0.0.0.0:1234
# → [collab] healthz at http://0.0.0.0:1234/healthz
```

Connect from the app:

```ts
import { createCrdtDoc } from '@/lib/collab/crdtAdapter';

const doc = createCrdtDoc<FeatureTree>({
  docId: 'project-42',
  initialState: emptyFeatureTree(),
  transport: 'websocket',
  wsUrl: 'ws://localhost:1234',  // WebsocketProvider appends /<docId>
  userId: currentUserId,
});
```

### Option B — Cloudflare Durable Objects (per-doc scaling, complex)

> `cloudflare/index.ts` — scaffold. The **production** version of this
> path already exists at `../occt-collab-worker/` (despite the name, it's
> the Yjs collab DO; the prefix is historical).

- Each `docId` maps deterministically to one Durable Object instance via
  `env.COLLAB_ROOM.idFromName(docId)`. Effectively unlimited horizontal
  scaling — each doc has its own isolated worker.
- KV snapshots every 30s give cold-start recovery (Phase 2 here, already
  implemented in `occt-collab-worker/src/CollabRoom.ts`).
- Idle eviction via `state.storage.setAlarm()` so we don't pay for memory
  on dormant rooms (Phase 2 here, already implemented in CollabRoom).
- Costs more to operate than a single Node instance until you have enough
  concurrent docs that the DO billing wins vs. Railway hours.

For a new project, Option A is the right starting point. Lift to Option B
when you hit one of:

- single-instance memory pressure (rooms × Y.Doc size > 1GB)
- single-instance CPU pressure (relay-bound, not edit-bound)
- need true geo-distribution (DOs run at edge)
- need persistence-by-default without writing your own R2/D1 code

## Files

```
collab-worker/
├─ server.js                 # Node.js relay (Option A) — primary path
├─ server.test.js            # node:test suite (15 tests, mock + e2e)
├─ cloudflare/
│  └─ index.ts               # Worker + DO scaffold (Option B reference)
└─ README.md                 # this file
```

## Wire protocol

Identical to `y-websocket` + `occt-collab-worker`:

| First varuint | Meaning             | Payload                                   |
| ------------- | ------------------- | ----------------------------------------- |
| `0`           | `MESSAGE_SYNC`      | `y-protocols/sync` (step1/step2/update)   |
| `1`           | `MESSAGE_AWARENESS` | `encodeAwarenessUpdate(awareness, [..])`  |

Text frames (JSON) carry a tiny control channel:

| `type` | Direction | Notes                          |
| ------ | --------- | ------------------------------ |
| `ping` | C→S       | Server replies `pong` w/ `ts`. |
| `pong` | S→C       | `{ ts: number }`.              |

## Environment variables (Node server)

| Var            | Default     | Notes                                                                                          |
| -------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `COLLAB_PORT`  | `1234`      | TCP port the HTTP+WS server binds.                                                             |
| `COLLAB_HOST`  | `0.0.0.0`   | Bind interface. Use `127.0.0.1` for local-only.                                                |
| `JWT_SECRET`   | _(unset)_   | Phase 2: HS256 secret to verify the `?token=` query param against the main app's tokens.       |

## Scripts

Defined in repo `package.json`:

- `npm run collab:dev` — start the Node relay on `COLLAB_PORT` (default 1234).

Deployment scripts are intentionally **wishlist** — see Phase 2 below.

## Authentication

- **Phase 1 (current)**: the `?token=...` query param is accepted but NOT
  validated. `server.js#authorize()` is a single function that returns
  `{ ok: true, userId }` for any input. Anonymous connections (no token)
  are also allowed. This is dev-mode only; do not expose to the public
  internet without finishing Phase 2.
- **Phase 2 path**: the main Next.js app already has `src/lib/jwt.ts`
  (HS256, same shape `occt-collab-worker` uses). The plan:
    1. Add `nfProjectAccess(userId, docId)` check inside the existing
       `/api/nexyfab/worker-token` endpoint (or add the endpoint if
       missing) — it issues a short-lived JWT only if the user has access
       to the requested doc, optionally pinning `docId` in the payload.
    2. In `authorize()` here: import `jose.jwtVerify`, verify against
       `process.env.JWT_SECRET`, check `exp` + (optional) `payload.docId
       === docId`.
    3. On failure, send `HTTP/1.1 401 Unauthorized` during the upgrade
       handshake (the code path is already there in `server.js#upgrade`).

  See `../occt-collab-worker/src/auth.ts` for the exact verify shape we
  reuse.

## Persistence

- **Phase 1 (current)**: in-memory only. Empty rooms get garbage-collected
  on last-client-leaves. A server restart with no clients online wipes
  every doc.
- **Phase 2 path (Node side)**: snapshot `Y.encodeStateAsUpdate(room.doc)`
  to R2 every 30s and on last disconnect, restore on first connect. Code
  shape already exists in `../occt-collab-worker/src/CollabRoom.ts` —
  swap `KVNamespace.put/get` for `@aws-sdk/client-s3` (R2 is already
  configured at the repo root, see `project_r2_architecture.md`).
- **Phase 2 path (Cloudflare side)**: KV is already the answer. The
  scaffold has the hooks commented; the full impl is in
  `../occt-collab-worker/src/CollabRoom.ts`.

## Tests

```powershell
# tests live OUTSIDE vitest's `src/**/*.test.ts` include — run with node:test
node --test collab-worker/server.test.js
```

The test file (`server.test.js`) uses Node's built-in test runner and a
real WebSocket round-trip against an ephemeral port; tests are fully
self-contained and clean up between runs. No fixture servers, no
external network.

## Comparison cheat sheet

| Axis                          | Node (Option A)         | Cloudflare DO (Option B) |
| ----------------------------- | ----------------------- | ------------------------ |
| Per-room isolation            | shared process          | per-doc instance         |
| Persistence                   | Phase 2 (R2)            | Phase 2 (KV) — partially done in occt-collab-worker |
| Cold start                    | none                    | a few hundred ms per room first hit |
| Memory ceiling                | single VM RAM           | unlimited (per-DO 128MB) |
| Geo-distribution              | one region              | edge (always-near user)  |
| Auth wiring                   | jose HS256 (Phase 2)    | same shim, already in occt-collab-worker |
| Cost @ 10 active docs         | ~$5/mo on Railway       | ~$0 (within free tier)   |
| Cost @ 10,000 active docs     | >$200/mo + sharding pain| ~$50/mo + auto-scales    |
| Operational complexity        | low                     | high (DOs + KV + alarms) |
| Local dev story               | `npm run collab:dev`    | `wrangler dev --local`   |

## Phase 2 todo (in order of expected impact)

1. JWT verification in `authorize()` (Node) and `cloudflare/index.ts`.
2. R2 snapshot loop in Node server (mirror `CollabRoom.ts` shape).
3. Origin allowlist enforcement on Node side
   (`ALLOWED_ORIGINS` env var; already done on the CF side).
4. Per-room connection cap on Node side (`MAX_CLIENTS_PER_ROOM`).
5. `/metrics` endpoint: active rooms + sockets per room (Prometheus
   text format so Railway scrape works).
6. Graceful shutdown: snapshot every dirty room on `SIGTERM` before
   closing the server.
