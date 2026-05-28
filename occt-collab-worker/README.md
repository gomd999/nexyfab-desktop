# occt-collab-worker

NexyFab의 협업 편집 트랜스포트. Cloudflare Workers + Durable Objects 위에서
[Yjs](https://github.com/yjs/yjs) sync/awareness 프로토콜을 WebSocket으로
서빙한다. 문서 ID 1개 = Durable Object 인스턴스 1개로 매핑되며, KV에
30초마다 스냅샷을 떠 두어 DO eviction/hibernation에 견딘다.

배포 대상: `wss://collab.nexyfab.com`

## 아키텍처 한 줄 요약

```
[Browser] --(JWT)--> wss://collab.nexyfab.com/ws/:docId
                          |
                          | (HS256 verify in Worker)
                          v
                  Worker (Hono router)
                          |
                          | (forward Upgrade)
                          v
                  Durable Object: idFromName(docId)
                          |
                          +-- Y.Doc (in-memory)
                          +-- Awareness (in-memory)
                          +-- setInterval(30s) → KV snap:<docId>
                          +-- alarm(30min idle) → flush + destroy
```

## 디렉토리

```
occt-collab-worker/
├─ package.json              # hono / yjs / y-protocols / lib0 / wrangler
├─ wrangler.toml             # DO binding + KV + env vars
├─ tsconfig.json
├─ .dev.vars.example         # JWT_SECRET (로컬)
├─ .gitignore
├─ README.md                 # 이 파일
├─ TESTING.md                # 수동 검증 시나리오
└─ src/
   ├─ index.ts               # Hono router, JWT verify, /ws/:docId upgrade
   ├─ CollabRoom.ts          # Durable Object: Y.Doc + KV 스냅샷
   ├─ auth.ts                # HS256 JWT verify (main app과 동일)
   └─ client-example.ts      # Next.js 쪽에 복붙할 클라이언트 참고 코드
```

## 와이어 프로토콜

바이너리 프레임(`ArrayBuffer`):

| 첫 varuint | 의미                                 | 페이로드                                |
| ---------- | ------------------------------------ | --------------------------------------- |
| `0`        | `MESSAGE_SYNC` (`y-protocols/sync`)  | sync step1/step2/update                 |
| `1`        | `MESSAGE_AWARENESS`                  | `encodeAwarenessUpdate(awareness, [..])` |

텍스트 프레임(JSON, 컨트롤 채널):

| `type`  | 방향  | 설명                          |
| ------- | ----- | ----------------------------- |
| `ping`  | C→S   | 서버가 `pong` 으로 응답       |
| `pong`  | S→C   | `{ ts }` 포함                 |

## 인증

1. 메인 Next.js 앱이 `/api/nexyfab/worker-token` 으로 HS256 JWT를 발급한다
   (`src/lib/jwt.ts`).
2. 브라우저는 `wss://collab.nexyfab.com/ws/:docId?token=<jwt>` 로 연결.
3. Worker가 `JWT_SECRET`(시크릿)으로 HS256 verify → exp 검사. 실패 시 401.
4. 통과한 토큰의 `sub/email/plan` 을 헤더로 변환해 DO에게 전달. DO는
   재검증하지 않는다 (worker→DO 호출은 Cloudflare 내부 채널).

> 문서 수준 ACL (이 사용자가 이 docId 에 접근 가능한가?)은 **main 앱**의
> `/api/nexyfab/worker-token` 발급 단계에서 검증한다. 이 워커는 JWT가
> 유효한지만 본다. 즉 토큰을 발급받은 사용자는 그 토큰의 수명동안 어떤
> docId 든 연결 가능 — 권한 분리를 좁히려면 발급 단계에서 토큰 payload에
> `docId` 클레임을 추가하고 여기서 매칭하면 된다(TODO).

## 환경 변수

| 변수                    | 종류    | 설명                                                                |
| ----------------------- | ------- | ------------------------------------------------------------------- |
| `JWT_SECRET`            | secret  | `wrangler secret put JWT_SECRET`. 메인 앱과 동일 값.                 |
| `SNAPSHOT_INTERVAL_MS`  | var     | KV 스냅샷 주기. 기본 30000.                                          |
| `IDLE_TIMEOUT_MS`       | var     | 마지막 클라이언트 이탈 후 DO 자기 해제 지연. 기본 1800000 (30분).      |
| `MAX_CLIENTS_PER_ROOM`  | var     | 룸당 동시 연결 제한. 기본 20.                                        |
| `ALLOWED_ORIGINS`       | var     | `,` 구분 origin allowlist. WebSocket 핸드셰이크 시 origin 검사.      |
| `COLLAB_SNAPSHOTS` (KV) | binding | Y.Doc 상태 바이너리 보관 (`snap:<docId>` 키).                        |
| `COLLAB_ROOM` (DO)      | binding | `CollabRoom` 클래스의 네임스페이스.                                  |

## 로컬 개발

```powershell
cd occt-collab-worker
npm install
Copy-Item .dev.vars.example .dev.vars
# .dev.vars 안의 JWT_SECRET 을 메인 앱의 .env JWT_SECRET 과 동일하게 맞춘다
npm run dev
```

`wrangler dev --local` 은 워커, DO, KV 모두 메모리에서 시뮬레이션한다.
KV 스냅샷은 `.wrangler/state/` 아래에 디스크 캐시된다.

엔드포인트:

- `http://127.0.0.1:8787/healthz`
- `ws://127.0.0.1:8787/ws/<docId>?token=<jwt>`

## 1회성 배포 (Cloudflare 본인 계정 기준)

### 1. KV 네임스페이스 만들기

```bash
npm run kv:create           # production
npm run kv:create:preview   # preview (wrangler dev --remote 용)
```

각각이 출력하는 `id` 를 `wrangler.toml` 의 `REPLACE_WITH_...` 자리에 붙인다.

### 2. JWT 시크릿 설정

메인 앱의 `JWT_SECRET` 과 같은 값을 워커에도 등록:

```bash
wrangler secret put JWT_SECRET
# (프롬프트에 값 입력)

# staging / production 분리하려면:
wrangler secret put JWT_SECRET --env staging
wrangler secret put JWT_SECRET --env production
```

### 3. 배포

```bash
npm run deploy                  # default env
npm run deploy:staging          # staging
npm run deploy:production       # production
```

### 4. 커스텀 도메인 (선택)

Cloudflare 대시보드 → Workers & Pages → `occt-collab-worker` → Triggers
→ Custom Domains 에서 `collab.nexyfab.com` 추가. 또는
`wrangler.toml` 의 `[env.production]` 섹션에서 `routes` 블록을 풀고
`wrangler deploy --env production`.

### 5. 클라이언트 연결

메인 Next.js 앱에서 `src/client-example.ts` 를 복사해 `lib/collab/yjs-client.ts`
같은 곳에 두고 호출:

```ts
import { connect } from '@/lib/collab/yjs-client';

const { doc, awareness, destroy } = connect({
  endpoint: 'wss://collab.nexyfab.com',
  docId: projectId,
  token: workerToken,         // /api/nexyfab/worker-token
});

const yText = doc.getText('cad-notes');
yText.observe(() => render(yText.toString()));
```

## 운영

- **로그 스트리밍**: `npm run tail`
- **스냅샷 강제 플러시**: `POST /rooms/:docId/flush` (JWT 필요). 배포 직전이나
  대규모 마이그레이션 직전에 한 번 호출하면 안전.
- **스냅샷 덤프**: `GET /rooms/:docId/snapshot` 은 마지막 KV 스냅샷의 raw
  바이너리 (`Y.encodeStateAsUpdate`)를 돌려준다. 백업/디버깅용.

## 비용/한도 가이드

- DO 인스턴스 1개당 메모리는 Y.Doc 크기에 비례. CAD 노트/주석 정도라면
  KB 단위. 대형 binary asset 은 Y.Doc 에 넣지 말고 별도 R2 url로 참조.
- KV write 비용: 30s 주기 + 활성 룸 N개 = `2 * N` writes/min. 1k 룸이
  동시에 활성이면 분당 2k writes (Free tier 권장 한도 근처). 필요시
  `SNAPSHOT_INTERVAL_MS` 를 60000으로 올린다.
- 30분 idle alarm 으로 활성 DO 수를 제한한다.

## ADR 참고

- ADR-010: Yjs sync transport는 Cloudflare Workers + Durable Objects 채택.
- ADR-???: collab 권한은 토큰 발급 단계에서 처리, 워커는 토큰 진위만 검증.

## 다음 단계 (TODO)

- [ ] 토큰 페이로드에 `docId` 클레임 추가 → 워커에서 매칭 검증
- [ ] DO 내부에서 awareness 클라이언트 ID ↔ socket 매핑 정확화 (현재는
      클라이언트가 disconnect 시 자체적으로 timeout에 의존)
- [ ] /metrics 엔드포인트: 활성 룸/연결 수
- [ ] CRDT garbage collection 정책 (Y.Doc.gc = true 검토)
