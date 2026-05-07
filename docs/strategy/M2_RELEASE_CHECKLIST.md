# M2 릴리스 체크리스트 (모델링 신뢰 · v1)

**상태:** 코드·문서 기준 **M2 v1 완료** (2026-04-30). 아래 A절은 출시 전 **팀 검증**용.

**일괄 자동(M2–M7 일부):** `npm run verify`. E2E까지: `npm run verify:e2e` (`E2E_BASE_URL` 또는 `CI=true`).

**자동 게이트(M2만):** `npm run m2` (실패 시 릴리스 보류)  
**권장 회귀:** `npm run m1` (교환·M0 기준선)

---

## A. 릴리스 게이트 (필수)

1. **정상 재생성**  
   스케치 익스트루드 + 필렛 1개 수준의 부품을 저장 → 새로고침·재열기 → 동일하게 보이는지.

2. **의도적 실패**  
   필렛 반경 과대 또는 불리언 도구·본체 불일치로 **해당 피처에만** 에러가 걸리는지.

3. **진단 UI**  
   피처 트리 에러 배지·펼침 시 원시 메시지 + `[code]` + 힌트(한국어 `hintKo`, 그 외 로케일 영문 `hintEn`). 토스트 힌트 동작.

4. **롤백**  
   실패 후에도 뷰포트가 완전히 비지 않고, 이전 유효 메시가 남는지.

---

## B. 운영·품질 (배포 후 첫 주 권장)

5. **텔레메트리·DB (선택)**  
   `nf_audit_log`에서 `action LIKE 'telemetry.feature_pipeline.%'` 및 `metadata.diagnosticCode` 샘플 확인 — [M2_MODELING.md §6](./M2_MODELING.md) SQL.

6. **Sentry (설정 시)**  
   태그 `diagnosticCode`, `pipelineStage`, `featureType`로 필터링 가능한지 한 건 확인.

---

## C. 지속 (운영)

- [M2_MODELING.md §7](./M2_MODELING.md) 운영 런북(주간/월간) 따름.  
- 원시 메시지 다수가 `unknown`이면 `features/featureDiagnostics.ts`에 패턴 추가.
