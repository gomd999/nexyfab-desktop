# BM · Stage 크론 실행 순서 (Runbook)

> **목적:** `quarterly_order_krw` 갱신 → 분기 히스토리 롤 → Stage 재평가 → 아웃박스 알림이 한 줄로 맞도록 한다.  
> **인증:** 배치 잡은 공통으로 `Authorization: Bearer $CRON_SECRET` **또는** 헤더 `x-cron-secret: $CRON_SECRET`(라우트별 지원) 또는 관리자 세션을 사용한다. 실제 허용 방식은 각 `route.ts` 주석을 따른다.

## 권장 순서 (운영)

| 순서 | 엔드포인트 | 역할 |
|------|------------|------|
| 1 | `POST /api/jobs/rolling-quarterly-metrics` | 최근 N일 납품·완료 기준으로 `nf_users.quarterly_order_krw` 갱신, 필요 시 stale 유저 `evaluateStage` |
| 2 | `POST /api/jobs/quarterly-stage-roll` | 분기 확정 시 히스토리 시프트 + `evaluateStage(..., quarterly_volume)` (월 1회 의미, 분기 첫날 등) |
| 3 | `POST /api/admin/stage-worker` | `nf_stage_event` 미처리 행 알림·메일 처리 |

**참고:** 일반 주문 확정 시에는 결제 웹훅 등에서 이미 `recordOrderCompletion` → `evaluateStage`가 돈다. 위 순서는 **롤링 메트릭·분기 경계** 보강용이다.

## 환경 변수

- `CRON_SECRET` — 크론 전용 베어러/헤더 검증에 사용.
- 알림 링크 기준 URL은 `stage-worker`의 `baseUrl` 바디 또는 `PUBLIC_BASE_URL` / `NEXT_PUBLIC_APP_URL` 계열을 확인한다.

## 관측

- Stage 전환·데드레터: `GET /api/admin/stage-overview` (관리자 인증).
- 실패 재시도 소진: `nf_stage_event`에서 `processed_at IS NULL` 및 `retry_count` 상한 — 운영에서 주기 확인.
- **데모 격리:** `user_id = 'demo-user'` Stage 아웃박스는 `stage-worker`가 알림 없이 `processed_at`만 채워 소진한다. `rolling-quarterly-metrics`의 `quarterly_order_krw` 갱신과 `evaluateStaleUsers` 스캔에서도 `demo-user` 행은 제외한다.

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-11 | 초안 — rolling-quarterly → quarterly-stage-roll → stage-worker 순서 고정, stage-worker에 `CRON_SECRET` 허용 |
| 2026-05-12 | stage-worker·rolling-quarterly·`evaluateStaleUsers`에 `demo-user` 제외/아웃박스 소진 정리 |
