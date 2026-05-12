# Railway Cron Job Setup

NexyFab의 cron 라우트들은 모두 HTTP GET 엔드포인트로 구현되어 Railway의 **별도 cron service**가 정해진 일정에 호출하는 구조다. 메인 web 서비스에 cron 스케줄러를 두지 않는 이유:

- web replica가 늘어나면 같은 cron이 N번 실행됨
- web 재시작/배포 사이에 누락
- 잡 실행 로그가 web 로그에 섞여 디버깅 곤란

별도 cron service를 두면 단일 인스턴스 + 전용 로그 + 일정 설정을 Railway UI 한 곳에서 관리할 수 있다.

## 1. Cron 엔드포인트 목록

모든 엔드포인트는 `Authorization: Bearer ${CRON_SECRET}` 헤더가 필요하다.

| 엔드포인트 | 권장 빈도 | 목적 |
|---|---|---|
| `GET /api/cron/demo-session-prune` | 하루 1회 (예: 03:00 UTC) | 클레임되지 않은 데모 세션 7일 후 삭제 |
| `GET /api/cron/order-delays` | 하루 1회 (예: 09:00 KST) | 지연 주문 알림 |
| `GET /api/cron/quote-expire` | 하루 1회 | 만료 견적 처리 |
| `GET /api/cron/rfq-expire` | 하루 1회 | 만료 RFQ 처리 |
| `GET /api/cron/webhook-prune` | 하루 1회 | 처리된 webhook 이벤트 정리 |
| `GET /api/cron/prompt-variant-burnin` | 하루 1회 (예: 04:00 UTC) | A/B variant 회귀 검사 |
| `GET /api/cron/prompt-cost-budget` | 하루 1회 (예: 04:30 UTC) | AI 일일 비용 예산 알림 |
| `GET /api/cron/audit-prune` | 하루 1회 (예: 05:00 UTC) | audit 테이블 retention 정리 (기본 90일) |

## 2. Railway Cron Service 구성 (권장)

Railway 프로젝트에 새 service를 추가:

1. **Service 이름**: `nexyfab-cron`
2. **Source**: 같은 repo, 같은 branch (web service와 공유)
3. **Build**: `npm install --legacy-peer-deps` (Dockerfile 불필요 — runtime은 curl만 있으면 됨)
4. **Start command**: 비워두기 (cron schedule만 사용)
5. **Cron schedule** (Railway → Settings → Cron Schedule):
   ```cron
   # NexyFab daily cron jobs (all UTC)
   0 3 * * *  curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/demo-session-prune
   0 4 * * *  curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/prompt-variant-burnin
   30 4 * * * curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/prompt-cost-budget
   0 5 * * *  curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/audit-prune
   0 0 * * *  curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/quote-expire
   30 0 * * * curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/rfq-expire
   0 1 * * *  curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/webhook-prune
   0 0 * * *  curl -fSs -H "Authorization: Bearer $CRON_SECRET" https://api.nexyfab.com/api/cron/order-delays
   ```

   - `-fSs`: silent + fail-on-HTTP-error + show errors. Non-zero exit → Railway alert.
   - URL은 production 도메인 (api.nexyfab.com). preview/staging는 별도 service.

## 3. 환경변수 (cron service에 추가)

| 키 | 값 | 비고 |
|---|---|---|
| `CRON_SECRET` | 랜덤 32자 hex | web service와 **동일한 값** |

CRON_SECRET 생성:

```bash
openssl rand -hex 32
```

같은 값을 web service와 cron service 양쪽에 등록한다 (web이 `Authorization` 헤더 검증).

## 4. 검증

배포 후 즉시 한 번 수동 실행:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
     https://api.nexyfab.com/api/cron/prompt-variant-burnin
```

기대 응답: `200 { windowMs, sampleSize, verdicts, summary }`. 401이면 secret 불일치.

Railway Cron service 로그에서 실행 흔적 확인:

- 매일 같은 시각에 `200 OK` 로그가 떠야 한다.
- `prompt-variant-burnin` 응답 본문의 `summary.regress > 0` 이면 admin이 `/admin/prompt-stats`에서 확인 + `POST /api/nexyfab/admin/disabled-variants`로 kill switch 가능.

## 5. 알림 (선택)

`prompt-variant-burnin`이 regress를 발견하면 `console.warn`이 Railway 로그에 찍힌다. Slack/Discord 알림 연동:

1. Railway → Service → Notifications → 추가
2. 트리거: log line matches `\[variant-burnin\] REGRESS`
3. 채널: `#nexyfab-alerts` 등

## 6. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 401 Unauthorized | CRON_SECRET 불일치 | web/cron 서비스 둘 다 같은 값으로 재등록 |
| 503 Service Unavailable | DB 연결 실패 | DATABASE_URL 환경변수 확인 |
| 응답 없음 (timeout) | 잡이 너무 오래 걸림 | BATCH_LIMIT 줄이기 (소스 코드) |
| `prompt-variant-burnin` always `insufficient_data` | 트래픽 부족 | MIN_CALLS 임계값 (현재 50) 임시 조정 |

## 참고

- 데모 세션 cron 메모: `~/.claude/projects/.../memory/project_nexyfab_demo_cron.md`
- Variant 텔레메트리: `~/.claude/projects/.../memory/project_nexyfab_prompt_registry.md`
