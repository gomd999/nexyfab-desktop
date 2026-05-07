# M1 릴리스 수동 체크리스트 (교환 + 클라우드 저장)

**전제:** `npm run m1` 자동 통과. **전체 코드 게이트(일괄):** `npm run verify` — **M0→M7** + `security:smoke` ([verify-milestones.mjs](../../scripts/verify-milestones.mjs)). 교환 정책 문서: [M1_EXCHANGE.md](./M1_EXCHANGE.md).

## CAD 가져오기·내보내기

| ☐ | 항목 |
|---|------|
| ☐ | Shape Generator에서 **가져오기**로 STEP/STL 각 1개 — 뷰에 메시, 실패 시 토스트가 **구체적**인지 (빈 파일은 `formatCadImportError` 계열) |
| ☐ | **STEP 내보내기**(플랜 허용 시) 또는 STL — 파일 생성·다운로드 |
| ☐ | 가져온 뒤 **로컬 .nfab 저장 → 재열기** (M0와 동일 스모크) |

## 클라우드 (Cloudflare R2 + 프로젝트 API)

| ☐ | 항목 |
|---|------|
| ☐ | **로그인** 후 **클라우드 저장** — 성공 토스트, 대시보드에 프로젝트 반영 |
| ☐ | 저장한 프로젝트 **다시 열기** — `sceneData` 복원(형상·어셈블리 가능 범위) |
| ☐ | (스테이징) `S3_ENDPOINT` 등 R2 env 설정 시 **`/api/nexyfab/files` 업로드** — 대시보드 파일 목록·용량 표시 |

## 회귀

| ☐ | 항목 |
|---|------|
| ☐ | `npm run test:e2e` — `commercial-release-smoke` + `shape-generator` (시간 허용 시) |

---

**서명:** 검증자 ______ / 날짜 ______ / 커밋 ______
