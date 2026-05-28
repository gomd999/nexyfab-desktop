# Wave 1 GA Gate — 4시간 Soak 런북

> **목적:** ADR-009 §2 (Wave 1 GA gate) 통과를 위해 `occt-worker` 4시간 부하 실측.
> **Pass 기준:** heap Q4/Q1 ≤ 2.0, recycle ≥ 5, unhandled crash = 0.
> **대상 인프라:** Railway `occt-worker` 서비스 (Tier 0, 1 vCPU / 2 GB).
> **소요:** 셋업 ~30분 + 실행 4시간 + 평가 ~15분 = **~5시간** (대부분 무인).
> **작성:** 2026-05-28 / 적용: Phase 1 Week 1 (06-04 까지).

이 런북은 **Wave 1 머지 직후, Phase 1 Decision Review 직전** 에 한 번 실행한다. 결과는 `docs/wave-1-ga-checklist.md` 의 gate #2 evidence 로 첨부한다.

---

## 0. 개요

```
[USER 머신, Windows]
   │
   │ 1) curl polling (5분마다 /health)
   │ 2) 결과 NDJSON 적재
   ▼
[Railway occt-worker]
   │  npm run soak -- --duration=14400  (in-process)
   │  └─ pool 부하, heap 통계, recycle 카운터
   ▼
[종료 후]
   evaluate_soak.py  →  PASS / FAIL + ADR-009 evidence
```

핵심 신호:
- **heap Q4/Q1** — soak 마지막 25% RSS 평균 ÷ 첫 25% RSS 평균. 누수 시 > 2.0.
- **recycle count** — worker 풀이 max-ops 도달해 재시작한 횟수. < 5 면 부하가 부족.
- **failed_ops** — pool job 실패 누적. crash 와 별개. `> 0.5 %` 면 retry 분석.
- **uptime_continuous** — `/health` 200 응답 끊김 없이 14,400 s 유지되어야 함.

---

## 1. 사전 체크리스트

다음 항목을 **모두 yes** 로 확인한 뒤 §2 로 진행한다.

### 1.1 코드 / 배포
- [ ] `occt-worker/src/soak.ts` 가 main 브랜치에 머지됨
- [ ] `occt-worker/package.json` `scripts.soak` 존재 (`tsx src/soak.ts`)
- [ ] Railway 프로젝트 `nexyfab-occt-worker` 서비스 생성, 최신 commit 배포 완료
- [ ] Railway dashboard → Deployments → 최근 상태 `Active` (재시작 안 한 상태)

### 1.2 환경 변수 (Railway 서비스 Variables 패널)
| 변수 | 값 (Tier 0 권장) | 비고 |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `8080` | Railway 자동 주입 시 생략 |
| `OCCT_POOL_SIZE` | `2` | 1 vCPU 기준 |
| `OCCT_POOL_MAX_OPS` | `200` | recycle trigger; 4h 동안 ≥ 5 회 나오도록 |
| `OCCT_POOL_IDLE_MS` | `60000` | |
| `SOAK_DURATION_SEC` | `14400` | 4 h |
| `SOAK_OP_MIX` | `tessellate:0.6,boolean:0.3,step_import:0.1` | 실 워크로드 비율 |
| `SOAK_LOG_LEVEL` | `info` | `debug` 는 디스크 폭주 |
| `HEALTH_TOKEN` | (랜덤 32 hex) | `/health` 인증; 미설정 시 public |

`HEALTH_TOKEN` 생성 (PowerShell):
```powershell
-join ((48..57) + (97..102) | Get-Random -Count 32 | % {[char]$_})
```

생성한 값은 Railway `HEALTH_TOKEN` + 로컬 `.env.soak` 둘 다에 동일하게 넣는다.

### 1.3 /health 사전 검증

PowerShell:
```powershell
$env:WORKER_URL = "https://nexyfab-occt-worker.up.railway.app"
$env:HEALTH_TOKEN = "<위에서 생성한 값>"
curl.exe -sS -H "Authorization: Bearer $env:HEALTH_TOKEN" "$env:WORKER_URL/health" | ConvertFrom-Json
```

Git Bash:
```bash
export WORKER_URL="https://nexyfab-occt-worker.up.railway.app"
export HEALTH_TOKEN="<위에서 생성한 값>"
curl -sS -H "Authorization: Bearer $HEALTH_TOKEN" "$WORKER_URL/health" | jq .
```

기대 응답 (필드명은 `soak.ts` 가 export 하는 schema 와 동일해야 함):
```json
{
  "ok": true,
  "service": "occt-worker",
  "uptime_sec": 12,
  "pool": { "size": 2, "busy": 0, "recycle_count": 0, "max_ops": 200 },
  "heap": { "rss_mb": 187.4, "heap_used_mb": 92.1 },
  "soak": { "running": false, "ops_total": 0, "ops_failed": 0 }
}
```

`ok: false` 또는 5xx 면 §5 트러블슈팅 (a) 로.

### 1.4 로컬 도구

| 도구 | 확인 방법 | 없을 때 |
|---|---|---|
| `curl` | `curl --version` | Windows 11 기본 포함 (`C:\Windows\System32\curl.exe`) |
| `jq` | `jq --version` | `winget install jqlang.jq` 또는 https://jqlang.github.io/jq/ |
| `python` | `python --version` (≥ 3.10) | `winget install Python.Python.3.12` |
| Git Bash | `bash --version` | Git for Windows 설치 |

---

## 2. Soak 실행 명령

### 2.1 Railway 측 — soak 트리거

soak 는 worker 프로세스 **안** 에서 도는 in-process harness 이다. Railway 컨테이너 자체를 따로 띄울 필요 없이, deployed 인스턴스에 control endpoint 로 명령만 보낸다.

PowerShell:
```powershell
$body = @{
  duration_sec = 14400
  op_mix       = "tessellate:0.6,boolean:0.3,step_import:0.1"
  start_ts     = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
} | ConvertTo-Json

curl.exe -sS -X POST `
  -H "Authorization: Bearer $env:HEALTH_TOKEN" `
  -H "Content-Type: application/json" `
  -d $body `
  "$env:WORKER_URL/soak/start"
```

Git Bash:
```bash
curl -sS -X POST \
  -H "Authorization: Bearer $HEALTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"duration_sec\":14400,\"op_mix\":\"tessellate:0.6,boolean:0.3,step_import:0.1\"}" \
  "$WORKER_URL/soak/start"
```

기대 응답:
```json
{ "ok": true, "soak_id": "soak-2026-05-28T13-00-00Z", "ends_at": "2026-05-28T17:00:00Z" }
```

`soak_id` 를 메모해 둔다. 모니터링 결과 파일명에 사용한다.

### 2.2 로컬 머신은 끄지 않는다

soak 는 **Railway 측에서 도므로** 로컬 PC 를 꺼도 무방하다. 단 §3 의 polling 스크립트는 로컬에서 돌리므로:

- **노트북: 절전 OFF.** Windows: 설정 → 시스템 → 전원 → "절전 모드: 사용 안 함" + "디스플레이 끄기: 사용 안 함" (4시간 동안)
- **VPN/Wi-Fi 안정.** 단절 시 5분 polling 만 빠지고 soak 자체는 계속 돈다 (§5-d 참고).

### 2.3 백그라운드로 polling 시작 (Windows PowerShell)

```powershell
$logDir = "C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\docs\soak-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$soakId = "soak-2026-05-28T13-00-00Z"   # §2.1 응답의 soak_id 그대로
$ndjson = Join-Path $logDir "$soakId.ndjson"
$stderr = Join-Path $logDir "$soakId.stderr.log"

Start-Job -Name "soak-poll" -ScriptBlock {
  param($url, $token, $out, $err)
  & "C:\Program Files\Git\bin\bash.exe" `
    "C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\scripts\soak-poll.sh" `
    $url $token $out 2>> $err
} -ArgumentList $env:WORKER_URL, $env:HEALTH_TOKEN, $ndjson, $stderr
```

확인:
```powershell
Get-Job -Name soak-poll      # State: Running
Get-Content $ndjson -Wait -Tail 3   # tail -f 등가, Ctrl+C 로 빠져나옴
```

### 2.4 Git Bash 로 polling (대안)

PowerShell Job 대신 Git Bash 터미널을 4시간 열어두는 방식. `nohup` 와 `disown` 으로 터미널 닫아도 동작.

```bash
cd "/c/Users/gomd9/Downloads/nexysys_1/nexyfab.com/new"
mkdir -p docs/soak-logs

SOAK_ID="soak-2026-05-28T13-00-00Z"
NDJSON="docs/soak-logs/${SOAK_ID}.ndjson"
STDERR="docs/soak-logs/${SOAK_ID}.stderr.log"

nohup bash scripts/soak-poll.sh "$WORKER_URL" "$HEALTH_TOKEN" "$NDJSON" \
  > "$STDERR" 2>&1 &
disown
echo "polling PID: $!"
```

PID 확인 / 강제 중단:
```bash
ps -ef | grep soak-poll
kill <PID>
```

---

## 3. 모니터링 — runtime metrics 수집

### 3.1 Polling 스크립트 — `scripts/soak-poll.sh`

레포에 다음 파일을 추가한다 (`scripts/soak-poll.sh`):

```bash
#!/usr/bin/env bash
# Soak runbook §3.1 — /health 를 5분마다 polling 해 NDJSON 으로 적재.
#
# Usage:
#   bash scripts/soak-poll.sh <WORKER_URL> <HEALTH_TOKEN> <OUTPUT_NDJSON>
#
# Exit: 사용자가 kill 할 때까지 무한. 응답 없을 때마다 stderr 1줄 + ndjson "ok:false".

set -uo pipefail

WORKER_URL="${1:?WORKER_URL required}"
HEALTH_TOKEN="${2:?HEALTH_TOKEN required}"
OUT="${3:?OUTPUT_NDJSON required}"
INTERVAL="${SOAK_POLL_INTERVAL:-300}"   # 5 min

mkdir -p "$(dirname "$OUT")"
touch "$OUT"

echo "[$(date -u +%FT%TZ)] soak-poll start url=$WORKER_URL interval=${INTERVAL}s out=$OUT" >&2

while true; do
  ts=$(date -u +%FT%TZ)
  body=$(curl -sS --max-time 20 \
    -H "Authorization: Bearer $HEALTH_TOKEN" \
    "$WORKER_URL/health" 2>/dev/null || echo "")

  if [[ -z "$body" ]]; then
    line=$(jq -nc --arg ts "$ts" '{ts:$ts, ok:false, reason:"no-response"}')
    echo "[$ts] WARN no-response from $WORKER_URL" >&2
  elif ! echo "$body" | jq -e . >/dev/null 2>&1; then
    line=$(jq -nc --arg ts "$ts" --arg raw "$body" '{ts:$ts, ok:false, reason:"non-json", raw:$raw}')
    echo "[$ts] WARN non-json: ${body:0:120}" >&2
  else
    # /health JSON 에 ts 필드 합쳐 NDJSON 한 줄 만든다.
    line=$(echo "$body" | jq -c --arg ts "$ts" '. + {ts:$ts}')
  fi

  echo "$line" >> "$OUT"
  sleep "$INTERVAL"
done
```

**권한:** Git Bash 에서는 chmod 불필요. POSIX shell 에서 실행할 때만 `chmod +x scripts/soak-poll.sh`.

**행 갯수 예상:** 4 h × 12 polls/h = **48 lines** + a 동시간대 noise.

### 3.2 NDJSON 한 줄 예시
```json
{"ok":true,"service":"occt-worker","uptime_sec":7235,"pool":{"size":2,"busy":1,"recycle_count":3,"max_ops":200},"heap":{"rss_mb":421.7,"heap_used_mb":238.2},"soak":{"running":true,"ops_total":4318,"ops_failed":11},"ts":"2026-05-28T15:00:34Z"}
```

### 3.3 진행 중 빠른 진단 (선택)

PowerShell:
```powershell
Get-Content $ndjson | ForEach-Object {
  $j = $_ | ConvertFrom-Json
  "{0}  rss={1,6:F1}MB  ops={2,5}  fail={3,3}  recycle={4,2}" -f `
    $j.ts, $j.heap.rss_mb, $j.soak.ops_total, $j.soak.ops_failed, $j.pool.recycle_count
}
```

Git Bash:
```bash
jq -r '"\(.ts)  rss=\(.heap.rss_mb)MB  ops=\(.soak.ops_total)  fail=\(.soak.ops_failed)  recycle=\(.pool.recycle_count)"' \
  "$NDJSON"
```

---

## 4. 종료 시점 평가

### 4.1 자동 평가 스크립트 — `scripts/evaluate_soak.py`

레포에 다음을 추가 (`scripts/evaluate_soak.py`):

```python
#!/usr/bin/env python3
"""Evaluate a 4h soak NDJSON against ADR-009 §2 GA gate.

Usage:
  python scripts/evaluate_soak.py docs/soak-logs/<soak_id>.ndjson

Exit: 0 PASS, 1 FAIL, 2 inconclusive (samples < expected, parse error 등).
"""
from __future__ import annotations
import json, sys, statistics
from pathlib import Path

# ADR-009 §2 thresholds
HEAP_Q4_Q1_MAX = 2.0
RECYCLE_MIN    = 5
FAIL_RATE_MAX  = 0.005          # 0.5 % of pool ops
EXPECTED_SAMPLES_MIN = 40       # 4h * 12/h = 48; 40 = 잡음 흡수
EXPECTED_UPTIME_SEC  = 4 * 3600

def main(path: str) -> int:
    p = Path(path)
    if not p.is_file():
        print(f"FAIL: file not found: {path}", file=sys.stderr); return 2

    samples = []
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line: continue
        try:
            samples.append(json.loads(line))
        except json.JSONDecodeError:
            print(f"WARN: bad json on line {i}", file=sys.stderr)

    ok_samples = [s for s in samples if s.get("ok") is True]
    print(f"samples total={len(samples)} ok={len(ok_samples)}")

    if len(ok_samples) < EXPECTED_SAMPLES_MIN:
        print(f"INCONCLUSIVE: ok-samples {len(ok_samples)} < {EXPECTED_SAMPLES_MIN}")
        return 2

    rss = [s["heap"]["rss_mb"] for s in ok_samples if "heap" in s]
    n = len(rss)
    q1 = statistics.mean(rss[: n // 4 or 1])
    q4 = statistics.mean(rss[-(n // 4) or n:])
    ratio = q4 / q1 if q1 > 0 else float("inf")
    last = ok_samples[-1]
    recycle = last.get("pool", {}).get("recycle_count", 0)
    ops_total  = last.get("soak", {}).get("ops_total", 0)
    ops_failed = last.get("soak", {}).get("ops_failed", 0)
    fail_rate  = ops_failed / ops_total if ops_total else 1.0
    uptime     = last.get("uptime_sec", 0)

    print(f"heap RSS Q1={q1:.1f} MB  Q4={q4:.1f} MB  ratio={ratio:.2f}")
    print(f"pool recycle_count={recycle}")
    print(f"ops total={ops_total} failed={ops_failed} fail_rate={fail_rate*100:.2f}%")
    print(f"uptime_sec={uptime} (expected >= {EXPECTED_UPTIME_SEC})")

    fails = []
    if ratio > HEAP_Q4_Q1_MAX:
        fails.append(f"heap Q4/Q1 {ratio:.2f} > {HEAP_Q4_Q1_MAX}")
    if recycle < RECYCLE_MIN:
        fails.append(f"recycle {recycle} < {RECYCLE_MIN}")
    if fail_rate > FAIL_RATE_MAX:
        fails.append(f"fail_rate {fail_rate*100:.2f}% > {FAIL_RATE_MAX*100:.2f}%")
    if uptime < EXPECTED_UPTIME_SEC * 0.99:
        fails.append(f"uptime {uptime}s < {EXPECTED_UPTIME_SEC*0.99:.0f}s (>=1% downtime)")

    # 'ok:false' 샘플이 곧 crash 의미는 아님 (네트워크 hiccup 포함). 단,
    # 연속 ok:false 3회 이상이면 잠재 crash 로 본다.
    streak = max_streak = 0
    for s in samples:
        if s.get("ok") is True:
            streak = 0
        else:
            streak += 1
            max_streak = max(max_streak, streak)
    if max_streak >= 3:
        fails.append(f"ok:false consecutive max_streak={max_streak} (>=3 = suspect crash)")

    if fails:
        print("\nRESULT: FAIL")
        for f in fails: print(f"  - {f}")
        return 1
    print("\nRESULT: PASS  (ADR-009 §2 GA gate satisfied)")
    return 0

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1]))
```

### 4.2 실행 (PowerShell / Bash 공통)

```powershell
python "C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\scripts\evaluate_soak.py" `
  "C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\docs\soak-logs\soak-2026-05-28T13-00-00Z.ndjson"
```

```bash
python scripts/evaluate_soak.py docs/soak-logs/soak-2026-05-28T13-00-00Z.ndjson
```

Exit code:
- `0` → PASS, §5 결과 보고로.
- `1` → FAIL, §6 트러블슈팅 + 재실행 검토.
- `2` → INCONCLUSIVE (샘플 부족). polling 이 중간에 죽었거나 worker 가 응답을 거의 못 했음.

### 4.3 Polling 중단

PowerShell:
```powershell
Stop-Job -Name soak-poll; Remove-Job -Name soak-poll
```

Git Bash:
```bash
kill $(pgrep -f soak-poll.sh)
```

### 4.4 Soak 측 강제 종료 (조기 중단)

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $HEALTH_TOKEN" \
  "$WORKER_URL/soak/stop"
```

---

## 5. 결과 보고 양식

평가 후 다음 markdown 을 `docs/wave-1-ga-checklist.md` 의 gate #2 절에 첨부 (또는 `docs/soak-logs/<soak_id>.report.md` 신규 작성).

```markdown
### Soak run — <soak_id>

| 항목 | 값 | 기준 | 판정 |
|---|---|---|---|
| 시작 | 2026-05-28T13:00:00Z | — | — |
| 종료 | 2026-05-28T17:00:00Z | — | — |
| 샘플 | 47 / 48 expected | ≥ 40 | ✅ |
| Heap RSS Q1 | 187.4 MB | — | — |
| Heap RSS Q4 | 246.1 MB | — | — |
| **Heap Q4/Q1** | **1.31** | ≤ 2.0 | ✅ |
| **Recycle count** | **17** | ≥ 5 | ✅ |
| ops total / failed | 8,432 / 19 | fail < 0.5 % | ✅ (0.23 %) |
| uptime_sec | 14,402 | ≥ 14,256 (4h × 0.99) | ✅ |
| ok:false 최대 연속 | 1 | < 3 | ✅ |

**RESULT: PASS** — ADR-009 §2 GA gate #2 통과.

다음 단계:
- [ ] `wave-1-ga-checklist.md` 의 gate #2 evidence 에 본 보고 링크
- [ ] Phase 1 Week 1 Decision Review 통과 → Phase 2 fan-out spawn (`wave-2-phase-1-plan.md` Week 2)
- [ ] NDJSON / stderr.log 압축 후 `docs/soak-logs/` 에 commit (raw evidence 보존)
```

FAIL 시 양식:

```markdown
**RESULT: FAIL** — 원인:
- heap Q4/Q1 2.41 > 2.0 (누수 의심)

조치:
- [ ] §6 (a) 누수 분석 절차 진행
- [ ] PR <#> 에서 leak fix 후 재실행
- [ ] 재실행 결과 첨부 (24~48h 내)

GA gate 미통과. Phase 2 fan-out **보류**, 머지 큐는 fix PR 우선.
```

---

## 6. 트러블슈팅

발생 빈도 높은 순.

### (a) Heap 폭증 — Q4/Q1 > 2.0

증상: NDJSON 의 `heap.rss_mb` 가 시간 흐름과 정비례하게 우상향.

진단:
```bash
jq -r '"\(.ts) \(.heap.rss_mb)"' docs/soak-logs/<id>.ndjson > /tmp/rss.tsv
# Excel/Google Sheets 에 붙여 선형 fit 확인. 기울기 > 5 MB/h 면 누수 확정.
```

대응:
1. `occt-worker/src/pool.ts` 의 worker recycle 후 `worker.terminate()` 호출 확인.
2. Emscripten heap (`Module.HEAPU8`) 가 worker 단위로 분리됐는지 — global Module 공유 시 누수 (Wave 1 W12 PR 에서 fix 됐어야 함).
3. `OCCT_POOL_MAX_OPS` 를 200 → 100 으로 낮춰 recycle 빈도 ↑ 재실행.
4. fix 안 되면 ADR-009 §2 미통과. 머지 보류, Phase 2 spawn 차단.

### (b) Recycle = 0 (또는 < 5)

증상: 4h 다 돌았는데 `pool.recycle_count` 그대로.

원인 후보:
- `OCCT_POOL_MAX_OPS` 가 너무 큼 (예: 10000). soak op 총합 < threshold.
- soak op_mix 가 너무 가벼움 (tessellate 비율 ↑ 필요).
- 풀 자체가 안 돌고 있음 — `soak.running:false` 였거나 `ops_total` 이 0/매우 작음.

대응:
1. NDJSON 마지막 줄의 `ops_total` 확인. 4h 에 **최소 2,000** 이상은 나와야 정상. < 500 이면 soak 가 idle.
2. `SOAK_OP_MIX` 에서 tessellate 비율 0.7 이상 + `OCCT_POOL_MAX_OPS=200` 으로 재시작.
3. recycle 이 정말 안 일어나는 거면 pool 코드 회귀. PR 로 회복.

### (c) Unhandled crash (`ok:false` 연속 ≥ 3 또는 Railway 재시작)

증상: `/health` 가 5xx / no-response 가 15분 이상 지속. Railway dashboard 의 Deployments 탭에 "Restarted" 이벤트.

대응:
1. Railway → 해당 서비스 → Logs → 시간 범위 매칭. `SIGSEGV`, `Aborted`, `FATAL ERROR: Reached heap limit` 등 키워드.
2. crash dump 가 있다면 `occt-worker` 의 `Sentry` (`SENTRY_DSN` 설정 시) 에서 stack 확보.
3. **OOM 인 경우** — Railway 인스턴스 RAM 2 GB → 4 GB 로 일시 상향, soak 재실행. 그래도 OOM 이면 worker 코드 memory cap 필요.
4. crash 가 발생한 시점부터의 NDJSON 은 evidence 로 함께 첨부 (FAIL 보고에 raw log 링크).

### (d) 네트워크 단절 (로컬 polling 만 죽고 soak 는 살아있는 경우)

증상: stderr.log 에 `no-response` 가 일정 시간대 연속, 그 뒤 복구.

판별: Railway logs 에서 그 시간대에 worker 가 정상 응답 (다른 클라이언트로 `curl /health` 가능했는지) 확인. soak 자체는 in-process 라 외부 네트워크와 무관.

대응:
- polling 만 끊긴 거면 `evaluate_soak.py` 결과의 `ok:false 연속` 만 영향. 3회 미만이면 PASS 유지.
- 3회 이상 연속이면 INCONCLUSIVE → polling 만 다시 띄워 추가 데이터 수집은 무의미 (이미 soak 종료). **재실행 권장**.
- 다음번엔 Railway 측에서도 polling 컨테이너를 같이 띄워 외부 단절 영향 제거 (cron 잡 1분 주기 `/health` → R2 적재 방식).

### (e) Railway 인스턴스 재시작 (정전 / 플랫폼 측 maintenance)

증상: 어느 순간 `uptime_sec` 가 큰 값 → 작은 값으로 점프. Railway Deployments 탭에 "Restarted by system" 이벤트.

대응:
- soak 자체가 깨졌으므로 **해당 run 은 INCONCLUSIVE**. 결과 평가 의미 없음.
- Railway status page (https://status.railway.app) 확인. platform 이슈면 24h 뒤 재실행.
- 빈번하면 (월 2회+) Railway tier 상향 (Pro plan) 또는 Render/Fly 대안 검토 — ADR-009 §3 의 인프라 결정.

---

## 7. 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-05-28 | 초안 — Phase 1 Week 1 Agent A1 산출물. ADR-009 §2 기준값 (Q4/Q1≤2.0, recycle≥5, crash=0) 반영. polling + 평가 + 트러블슈팅 5종. |

---

## 8. 다음 단계 (이 런북 자체의 후속)

본 런북은 1회성이 아니다. 다음 단계에서 재사용한다:

- **Phase 1 Decision Review (Week 4):** soak run 1 회 추가 — Phase 2 진입 전 회귀 가드.
- **Phase 2 끝 (Month 3):** sheet metal / hole wizard handler 추가 후 회귀 soak.
- **Phase 3 끝 (Month 6):** CRDT collab 통합 후 24h soak 로 확장 (`SOAK_DURATION_SEC=86400`). 같은 evaluate 스크립트 그대로 사용 가능, EXPECTED 상수만 조정.

장기적으로 weekly cron 으로 6h soak 를 자동 실행하는 것이 목표 (Phase 4 spec).
