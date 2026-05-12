# BM §4.4 로깅 의무 — 코드 커버리지 (G-M2)

**근거:** [bm-matrix.md](./bm-matrix.md) §4.4  
**점검일:** 2026-05-12 — 저장소 정적 검색·주요 경로 확인(직전 롤링: Stage 크론·7-5 집계 경로). 이후 배포에서 INSERT 누락이 있으면 본 표를 갱신한다.

---

## 요약

| §4.4 이벤트 | 테이블(스펙) | 구현 상태 | 비고 |
|-------------|--------------|-----------|------|
| 주문 결함 신고 | `nf_defects` | **부분** | API: `POST .../orders/[id]/defects`, `shadow-logger.logDefect`; 파트너·조회 라우트 존재 |
| 견적 거부 | `nf_quote_reject_log` | **부분** | 스키마·`shadow-logger` INSERT; 스펙 표기 `nf_quotes_reject_log`와 **테이블명 불일치**(실 DB는 `nf_quote_reject_log`) |
| 번들링 확정 | `nf_bundles`, `nf_bundle_orders` | **스키마만** | 마이그레이션에 테이블 있음; 앱 코드에서 **INSERT 검색 없음** — 롤링 구현 |
| 환불 처리 | `nf_refunds` (스펙) | **부분** | 에스크로·결제·`/api/nexyfab/admin/refund-queue` 등 **별도 청구/송금 모델**; §4.4의 단일 `nf_refunds` 테이블과 1:1 대응은 **문서 재정렬 필요** |
| Stage 전환 | `nf_stage_event` | **완료** | `stage-engine.ts` — Outbox append; 처리 워커 `stage-worker.ts`는 `demo-user` 행을 알림 없이 `demo_user_skipped`로 소진·픽업 제외(`bm-cron-runbook.md`) |
| 파트너 차원 신뢰(7-5) | `nf_partner_metric_events`, `nf_reviews` | **읽기 집계** | `partner-trust-aggregates.ts` + `GET /api/nexyfab/partner-trust-aggregates` — append는 기존 `recordMetric`·리뷰 API가 담당; 본 기능은 **집계·표시 전용**(신규 로그 테이블 없음) |
| CAD 접근 | `nf_cad_access_log` | **부분** | `logCadAccess` — **로그인 + fileId** 있는 DFM 경로 등(`dfm-check`); 익명 뷰는 의도적 미기록 |
| CBAM 로깅 | `nf_cbam_log` | **부분** | `shadow-logger.logCbam`; 호출부 전개는 주문·환경 플로우별 점검 필요 |

---

## 코드 앵커 (추적용)

| 테이블 / 헬퍼 | 파일 |
|---------------|------|
| 통합 shadow INSERT | `src/lib/shadow-logger.ts` |
| 결함 API INSERT | `src/app/api/nexyfab/orders/[id]/defects/route.ts` |
| CAD 접근 | `src/lib/shadow-logger.ts` `logCadAccess`, `src/app/api/nexyfab/dfm-check/route.ts` |
| Stage Outbox | `src/lib/stage-engine.ts` |
| Stage 워커(데모 소진) | `src/lib/stage-worker.ts` |
| 파트너 신뢰 차원 집계 | `src/lib/partner-trust-aggregates.ts`, `src/app/api/nexyfab/partner-trust-aggregates/route.ts` |

---

## 다음 액션 (롤링)

1. **번들링:** 번들 생성 UX/API 확정 시 `nf_bundles` / `nf_bundle_orders` INSERT 경로 추가 후 본 표를 “완료”로.  
2. **환불:** `bm-matrix.md` §4.4와 실제 청구 스키마(`nf_aw_invoices`, escrow `refunded` 등) **용어 통일**.  
3. **견적 거부:** UI에서 `quote_reject_log` 호출 여부 전수 확인.

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-11 | 초안 — 정적 grep 기준 스냅샷 |
| 2026-05-12 | Stage 워커 데모 소진·7-5 집계 행·앵커 추가; 점검일 갱신 |
