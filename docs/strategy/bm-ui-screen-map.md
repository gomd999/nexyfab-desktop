# BM §1.2 UI 기능 번호 ↔ 화면·라우트 매핑 (G-U1)

**목적:** `bm-matrix-stage-ui.ts`의 **기능 번호 32개**와 실제 제품 화면을 연결해 롤링 QA·카피 작업 시 참조한다.  
**게이트 단일 출처:** `mergePlanLimitsWithBmStage`, `useFreemiumGate`, 세션의 `nexyfabStage` — 세부는 [BM_MATRIX_CODE_GAP.md](./BM_MATRIX_CODE_GAP.md) G-U2/G-U3.

**매핑 검증일:** 2026-05-12 (경로는 저장소 구조 기준 **근사치**; 세부 컴포넌트는 필요 시 하위 링크 추가).

---

## 매핑 표

| ID | 기능 (bm-matrix §1.2) | 주요 사용자 경로 (예시) | 비고 |
|----|-------------------------|-------------------------|------|
| 1 | DFM 자동 검증 | `/[lang]/shape-generator` (분석·DFM), `/[lang]/nexyfab/dfm` | 항상 노출 계열 |
| 2 | Tooling BEP | shape-generator / 비용·공정 UI | 코드 내 BEP 표현 검색으로 세부 확정 |
| 3 | 재료·공정 어드바이저 | shape-generator, RFQ 작성 플로우 | |
| 5 | RFQ 자연어→구조화 | `/[lang]/nexyfab/rfq`, 관련 API | |
| 7 | AI 매칭 | `/[lang]/nexyfab/admin/rfq-matching`, 매칭 결과 UI | |
| 23 | 다품종 번들링 | 주문·프로젝트 번들 UX | 테이블 INSERT는 미연결 — [bm-logging-coverage.md](./bm-logging-coverage.md) |
| 8 | HS Code 추론 | 주문·견적·통관 입력 플로우 | Stage C+ 해금 |
| 25 | Escrow 플로우 | `/api/nexyfab/escrow/*`, 주문 결제 후 상태 | |
| 12 | 단계별 프로젝트 | `/[lang]/nexyfab/projects`, 프로젝트 상세 | |
| 21 | 마진 분해 | 파트너/관리 마진 뷰, shadow `logMargin` | C열 티저 주의 |
| 22 | 재주문 원클릭 | RFQ repeat, 주문 재생성 | |
| 13 | FAI 워크플로우 | 주문 품질·검사 단계 UI | |
| 14 | FAI 체크리스트 자동생성 |同上 | |
| 15 | 공정별 사진 체크포인트 | 파트너 오더 이벤트·업로드 | |
| 17 | 파트너 PWA(사진 수신) | `/partner/*` 모바일 친화 화면 | |
| 20 | 다차원 스코어카드 | `/partner/dashboard`(차원별 신뢰 Phase 7-5), `admin/partners`(모달), `GET /api/nexyfab/partner-trust-aggregates`, 기존 관리·파트너 KPI·`AISupplierPanel` | 7-5 집계는 단일 신용점수 없음 — [bm-logging-coverage](./bm-logging-coverage.md) |
| 16 | 간트/WIP 대시보드 | 제조 대시보드 계열 | |
| 11 | 납기 리스크 예측 | 오더·마일스톤 분석 | |
| 9 | 견적 비교 매트릭스 | RFQ 견적 비교 UI | |
| 10 | 견적 요약 에이전트 | 견적 상세·요약 | |
| 18 | 결함 택소노미 | `/api/nexyfab/orders/[id]/defects`, 결함 목록 | Stage E+ |
| 19 | RMA 워크플로우 | RMA·환불 큐 연계 | |
| 27 | CAD 워터마킹 뷰어 | 파일 공유·뷰어 | |
| 28 | 접근 로그 이상탐지 | `nf_cad_access_log`, 관리 관측 | |
| 35 | 2FA + 장치 신뢰 | `/[lang]/nexyfab/settings`, 보안 설정 | |
| 36 | 사내 권한 매트릭스 | 팀·조직·역할 설정 | |
| 37 | 전체 Audit log (뷰) | `/[lang]/nexyfab/settings/audit` | |
| 24 | 예측 재고 발주 | (도메인별) 재고·발주 화면 | |
| 38 | Webhook/API | 개발자·통합 설정 | Stage F 해금 |
| 39 | 메신저 봇 | 통합·알림 | |
| 40 | 데이터 내보내기 | GDPR export 등 | |
| 41 | 계약서 조항 추출 | 내부/문서 파이프라인 — §1.2 하단 “백엔드 전용” 참고 | |

---

## 유지 방법

1. 기능 번호·행 수 변경 시 **`bm-matrix-stage-ui.ts`** 와 **본 표**를 같은 PR에서 수정.  
2. Vitest `bm-matrix-stage-ui` 동반 테스트가 있으면 표 수정 후 테스트 실행.

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-11 | 초안 — G-U1 롤링용 경로 매핑 |
| 2026-05-12 | ID 20 비고 — 7-5 파트너 신뢰 UI·API 경로 반영; 검증일 갱신 |
