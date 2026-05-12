# Railway Env 설정 가이드 (nexyfab.com)

이 문서는 출시 전 Railway에 반드시 설정해야 할 환경변수 + 점검 명령을 정리합니다.

## 1. Railway에 설정해야 할 env

### Critical (없으면 핵심 흐름 작동 ❌)

| 변수 | 용도 | 예시 값 |
|------|------|--------|
| `DATABASE_URL` | Postgres 연결 (Railway가 자동 주입) | `postgres://...` |
| `CRON_SECRET` | 8개 cron 인증 (32자+ 랜덤) | `openssl rand -hex 32` 결과 |
| `NEXYFAB_ADMIN_EMAIL` | 운영자 알림 수신함 | `nexyfab@nexysys.com` |
| `NEXT_PUBLIC_AUTH_URL` | NexySys 통합 SSO 엔드포인트 | `https://auth.nexysys.com` |
| `TOSS_SECRET_KEY` | Toss 결제 server-side 승인 | `live_sk_...` (운영) / `test_sk_...` (스테이징) |
| `TOSS_WEBHOOK_SECRET` | Toss webhook signature 검증 | Toss 콘솔에서 발급 |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | 브라우저 결제 SDK | `live_ck_...` (운영) / `test_ck_...` (스테이징) |

### Already configured (parent .env에 있음)

| 변수 | 비고 |
|------|------|
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Resend 설정됨 (smtp.resend.com:465) |
| `JWT_SECRET` | 레거시 HS256 fallback용 |

### Optional but recommended

| 변수 | 용도 |
|------|------|
| `NEXT_PUBLIC_NEXYSYS_URL` | `https://nexysys.com` (forgot-password 등 cross-product 링크) |
| `NEXT_PUBLIC_BASE_URL` | `https://nexyfab.com` (cron alert 본문에 사용) |
| `NEXYFAB_DB_PATH` | `/app/data/nexyfab.db` (SQLite fallback 시, 볼륨 마운트와 일치해야 함) |

---

## 2. Railway CLI로 env 설정 명령

```bash
# 단일 변수 설정
npx @railway/cli variables --service nexyfab.com --set "CRON_SECRET=$(openssl rand -hex 32)"
npx @railway/cli variables --service nexyfab.com --set "NEXYFAB_ADMIN_EMAIL=nexyfab@nexysys.com"
npx @railway/cli variables --service nexyfab.com --set "NEXT_PUBLIC_AUTH_URL=https://auth.nexysys.com"
npx @railway/cli variables --service nexyfab.com --set "TOSS_SECRET_KEY=test_sk_..." 
npx @railway/cli variables --service nexyfab.com --set "TOSS_WEBHOOK_SECRET=..."
npx @railway/cli variables --service nexyfab.com --set "NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_..."

# 또는 대시보드에서 직접 입력 (권장 — 시크릿 노출 위험 ↓)
# https://railway.app/project/<id>/service/<id>/variables
```

`DATABASE_URL`은 Railway Postgres add-on을 연결하면 자동 주입되므로 수동 설정 불필요.

---

## 3. 마이그레이션 v77-v83 적용 확인

배포 직후 cold-start 시 lazy ALTER로 적용되지만, 명시적으로 한 번 돌리는 것이 안전합니다:

```bash
# Railway Postgres CLI로 확인
npx @railway/cli connect Postgres
# psql 프롬프트에서:
SELECT version, name FROM nf_schema_migrations WHERE version >= 77 ORDER BY version;
# 7건 (77,78,79,80,81,82,83) 보여야 함
```

빠진 게 있으면 `scripts/migrate-postgres.ts` 또는 lazy init이 첫 요청 시 자동 적용.

---

## 4. Preflight 검증 스크립트

Railway 대상으로 실행:

```bash
# 로컬에서 Railway env로 실행
npx @railway/cli run --service nexyfab.com -- npx tsx scripts/preflight-check.ts
```

10개 critical env + 7개 마이그레이션 + 4개 핵심 컬럼이 한 번에 검증됨. exit 0 = 출시 준비 완료.

---

## 5. 배포 명령

```bash
# 작업 폴더 (canonical):
cd /c/Users/gomd9/Downloads/nexysys_1/nexyfab.com/new

# 빌드 산출물 업로드 + 새 deployment 트리거
npx @railway/cli up --service nexyfab.com --detach

# 빌드 로그 모니터링
npx @railway/cli logs -n 100 --service nexyfab.com

# 첫 cron이 도는 다음 날 (8am) 운영자 메일 받는지 확인
```

---

## 6. 출시 후 첫 24시간 모니터링 체크리스트

- [ ] `/api/health/live` 200 응답 (Railway 헬스체크 통과)
- [ ] 가입 → 이메일 인증 메일 도착 (Resend 작동)
- [ ] RFQ 1건 등록 → 운영자 이메일 도착 (`NEXYFAB_ADMIN_EMAIL`)
- [ ] 운영자가 `/admin/concierge`에서 첫 매칭 진행
- [ ] 다음 날 오전 8시: concierge-digest 이메일 수신
- [ ] 다음 날 오전 8:30: pro-grace-expiry cron 정상 (만료 임박자 없으면 skip)
- [ ] Toss 테스트 결제 1회 → escrow 자동 생성 + 영수증 도착

---

## 트러블슈팅

| 증상 | 확인 |
|------|------|
| 배포 후 401 떨어지면 | `JWT_SECRET` / `NEXT_PUBLIC_AUTH_URL` 매칭 |
| Cron 안 돌면 | `CRON_SECRET` Railway env vs `railway.toml` cronJobs 섹션 일치 |
| 결제 후 escrow 없으면 | `TOSS_WEBHOOK_SECRET` 설정 + Toss 콘솔에서 PUT URL 등록 (`https://nexyfab.com/api/billing/toss`) |
| Email 안 도착하면 | `SMTP_PASS` 만료 (Resend 키 갱신) |
