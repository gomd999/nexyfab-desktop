# occt-collab-worker — 수동 검증 시나리오

스모크 테스트. CI는 별도 PR로 추가 예정.

## 사전 준비

```powershell
cd occt-collab-worker
npm install
Copy-Item .dev.vars.example .dev.vars
# .dev.vars 의 JWT_SECRET 을 main 앱과 동일하게 설정
npm run dev      # http://127.0.0.1:8787
```

테스트용 JWT 발급:

```powershell
# main app 디렉토리에서
node -e "import('./src/lib/jwt.ts').then(async m => { console.log(await m.signJWT({sub:'u1',email:'a@b.com',plan:'pro'}, 600)) })"
```

또는 quick & dirty:

```powershell
# Node 18+
$JWT = node -e @"
  const c = require('crypto');
  const secret = 'nexyfab-dev-secret-change-in-production';
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  const payload = Buffer.from(JSON.stringify({sub:'u1',email:'a@b.com',plan:'pro',iat:now,exp:now+600})).toString('base64url');
  const sig = c.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
  process.stdout.write(header+'.'+payload+'.'+sig);
"@
```

토큰 만료 5초짜리도 같이 만들어 두면 `exp` 시나리오 빠르게 검증 가능.

## 1. 헬스 체크

```powershell
curl http://127.0.0.1:8787/healthz
# → {"ok":true,"service":"occt-collab-worker","ts":...}
```

## 2. 두 탭 sync

`test-client.html` (아래 부록 1) 을 두 브라우저 탭에서 연다. URL 쿼리로
`?token=<JWT>&docId=demo-1` 을 똑같이 넘긴다.

- 한쪽 탭에서 input 박스에 글자 입력 → 다른 탭에 즉시 미러링되어야 한다.
- 첫 연결 시 sync step1/step2가 오가며 빈 Y.Doc 이 정렬.
- 양쪽이 한 글자씩 동시에 입력해도 CRDT 머지로 둘 다 보존.

## 3. JWT 만료 시 401

`exp` 가 이미 지난 토큰으로 연결 시도:

```powershell
$dead = "<expired-jwt>"
curl -i "http://127.0.0.1:8787/ws/demo-1?token=$dead" -H "Upgrade: websocket" -H "Connection: Upgrade"
# → HTTP/1.1 401 Invalid or expired token
```

브라우저 측에서는 `WebSocket onclose` 가 즉시 발화. 클라이언트 reconnect
로직이 `/api/nexyfab/worker-token` 으로 새 토큰을 받아 재연결하는지 확인.

## 4. KV 스냅샷 복구

1. `?docId=demo-snap` 으로 한 탭 접속, "hello world" 입력.
2. 30초 대기 (스냅샷 주기). `wrangler dev` 콘솔에 KV put 로그 확인.
3. 탭 닫기 → 마지막 클라이언트 disconnect 시 최종 스냅샷이 한 번 더 기록됨.
4. `wrangler dev` 를 Ctrl+C 로 죽이고 다시 `npm run dev`.
5. 같은 `docId=demo-snap` 로 새 탭 접속 → "hello world" 가 자동 복원되는지
   확인.

`GET /rooms/demo-snap/snapshot` 으로 raw 바이너리도 dump 가능
(`X-Snapshot-Updated-At` 헤더로 시점 확인).

## 5. idle alarm 동작

- `IDLE_TIMEOUT_MS` 를 `10000` (10s) 으로 임시 변경하고 재기동.
- 한 탭 접속 후 닫기.
- 10초 후 `wrangler dev` 로그에 `[alarm]` 라인 또는 `doc.destroy` 흔적 확인.
- 다시 같은 docId 로 접속 → KV에서 복원됨을 확인 (재load 경로).

## 6. 룸 정원 초과

- `MAX_CLIENTS_PER_ROOM` 을 `2` 로 낮추고 재기동.
- 같은 docId 로 3번째 탭을 열면 `429 Room full` 로 거절되는지 확인.

## 7. origin 거부

`ALLOWED_ORIGINS` 에 없는 origin 헤더를 직접 보내서 403 떨어지는지 확인.
브라우저는 origin을 강제로 박지만, 모바일 네이티브 등은 가능.

## 8. 두 docId 격리

- 탭A: `?docId=room-a`
- 탭B: `?docId=room-b`

각자 입력해도 서로 영향 없어야 함 (다른 DO 인스턴스).

## 부록 1 — `test-client.html`

루트 어디에 두든 상관없음 (커밋 X).

```html
<!doctype html>
<html>
<body>
<h3>occt-collab-worker tester</h3>
<input id="text" style="width:60%" />
<pre id="log"></pre>
<script type="module">
import * as Y from 'https://esm.sh/yjs@13.6.20';
import * as syncProtocol from 'https://esm.sh/y-protocols@1.0.6/sync.js?bundle';
import * as awarenessProtocol from 'https://esm.sh/y-protocols@1.0.6/awareness.js?bundle';
import * as encoding from 'https://esm.sh/lib0@0.2.97/encoding.js?bundle';
import * as decoding from 'https://esm.sh/lib0@0.2.97/decoding.js?bundle';

const qs = new URLSearchParams(location.search);
const token = qs.get('token');
const docId = qs.get('docId') ?? 'demo-1';
const endpoint = qs.get('endpoint') ?? 'ws://127.0.0.1:8787';

const log = (...a) => { document.getElementById('log').textContent += a.join(' ') + '\n'; };

const doc = new Y.Doc();
const awareness = new awarenessProtocol.Awareness(doc);
const yText = doc.getText('demo');
const input = document.getElementById('text');

const ws = new WebSocket(`${endpoint}/ws/${docId}?token=${token}`);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  log('open');
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0);
  syncProtocol.writeSyncStep1(e, doc);
  ws.send(encoding.toUint8Array(e));
};
ws.onclose = (e) => log('close', e.code, e.reason);
ws.onmessage = (ev) => {
  if (typeof ev.data === 'string') return;
  const d = new Uint8Array(ev.data);
  const dec = decoding.createDecoder(d);
  const type = decoding.readVarUint(dec);
  if (type === 0) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.readSyncMessage(dec, enc, doc, null);
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
  } else if (type === 1) {
    awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), ws);
  }
};

doc.on('update', (u, origin) => {
  if (origin === ws) return;
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0);
  syncProtocol.writeUpdate(e, u);
  if (ws.readyState === 1) ws.send(encoding.toUint8Array(e));
});

yText.observe(() => {
  if (input.value !== yText.toString()) input.value = yText.toString();
});

input.addEventListener('input', () => {
  doc.transact(() => {
    yText.delete(0, yText.length);
    yText.insert(0, input.value);
  });
});
</script>
</body>
</html>
```

## 부록 2 — 실패 케이스 체크리스트

- [ ] WebSocket frame size > 1MB → DO가 chunk 처리 못함 (현재). 큰 페이로드
      는 다중 update로 쪼개 보내자.
- [ ] DO 메모리 한도 (~128MB). 한 문서가 그 이상 자라면 CRDT GC 필요.
- [ ] 동일 docId 에 동시에 100+ 클라이언트 → DO 단일 인스턴스로 병목.
      샤딩하려면 docId에 partition 접미사를 두고 read replica를 추가.
