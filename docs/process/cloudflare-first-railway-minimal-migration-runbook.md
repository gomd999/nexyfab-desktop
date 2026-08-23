# Cloudflare 우선 · Railway 최소화 전환 실행서

기준일은 2026-08-13이다. 이 문서는 현재 Railway 단일 Next.js origin을 즉시 삭제하는 지시서가 아니다. 각 배포 단위를 독립 검증하고 복구 가능성을 확인한 뒤 순서대로 줄이는 실행 계약이다.

## 목표 배치

- Cloudflare: Studio Web, Edge Gateway, Cron, Collaboration, Job Orchestrator, OpenSCAD, FEA, OCCT Exact, IFC/STEP
- Railway: Core transaction API, Native CAD fallback
- 권위 저장소: Railway PostgreSQL은 유지하고, CAD artifact는 R2를 사용한다.
- Redis는 권위 저장소가 아니다. Job 전달이 Cloudflare Queues/Workflows로 검증된 뒤에만 Railway Redis job transport를 퇴역한다.

권위 목록은 `config/platform/runtime-placement.v1.json` 하나로 관리한다. 서비스별 `service.json`은 독립 build/test/deploy 단위이며 생산 자동 승격은 금지한다.

## 전환 순서

1. Cloudflare staging에 각 단위를 별도 배포하고 build ID, contract version, rollback artifact를 기록한다.
2. 동일 immutable CAD corpus와 동일 request hash를 Cloudflare 및 기존 경로에서 실행한다.
3. 결과 byte hash, shape identity, receipt, timeout/cancel, tenant 격리를 비교한다.
4. Cron → Redis job transport → 일반 CAD worker → IFC/STEP·OCCT → Studio Web origin 순으로 canary한다.
5. 각 단계는 1% → 10% → 50% → 100%에서 사람이 승인한다. 한 단계의 실패를 다음 단계가 면제하지 않는다.
6. 전환 후에도 Core API, PostgreSQL, 라이선스가 필요한 Native CAD fallback만 Railway allowlist에 남긴다.

## 즉시 중단과 rollback 조건

- artifact hash 또는 shape identity 불일치
- tenant/project 권한 우회
- Queue 전달을 계산 PASS로 오판
- 취소 후 output publish
- 오류율·지연·비용 표본 누락 또는 설명되지 않은 관찰 공백
- PostgreSQL, R2, dead-letter queue, collaboration snapshot 복구 훈련 실패
- 이전 build/route로 독립 rollback 불가

중단 시 해당 배포 단위의 traffic만 직전 경로로 되돌린다. DB schema는 expand/contract 순서를 사용하며 rollback target이 읽지 못하는 파괴적 변경은 canary 전에 금지한다.

## 30일 판정

`node scripts/platform/evaluate-runtime-placement-readiness.mjs`가 PASS하려면 다음이 모두 필요하다.

- 연속 30일 이상, 설명되지 않은 표본 공백 0
- 모든 live check의 hash-addressed receipt
- Railway active service가 `core-api`, `native-fallback`과 정확히 일치
- PostgreSQL/R2/Queue/Collaboration 복구 훈련 PASS
- Cloudflare와 Railway 동일 코퍼스 parity PASS
- 측정된 Railway 월 비용 감소

증거 형식은 `docs/process/schemas/runtime-placement-evidence.v1.schema.json`, 시작 템플릿은 `docs/process/templates/runtime-placement-evidence.v1.template.json`이다. PASS에는 `sha256:<64 hex>` receipt가 필요하며, 중복 check id, 24시간을 넘긴 최신 표본, 30일 미만 기간은 실패 폐쇄된다.

현재 live 증거 파일이 없으면 결과는 의도적으로 `HOLD / NOT_RUN`이다. 로컬 테스트나 Wrangler dry-run은 30일 운영 증거를 대체하지 않는다.
