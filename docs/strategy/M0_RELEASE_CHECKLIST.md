# M0 릴리스 수동 체크리스트

**자동(일괄):** `npm run verify` — typecheck 후 **M0→M7** + `security:smoke`(엔지니어링 게이트 전체). 단독 M0만이면 `npm run m0`. CI `test` 잡과 맞추려면 `npm run commercial:gate-a`(선행 병렬 스모크 + 전체 Vitest 포함).  
**자동+E2E:** `E2E_BASE_URL` 설정 후 `npm run verify:e2e`(또는 `VERIFY_E2E=1` + CI/URL).  
**자동:** `npm run m0` 통과 후 이 목록을 진행한다.  
각 항목은 **☐ → ☑**로 표시하고, 실패 시 이슈 번호를 남긴다.

## 핵심 플로우 (웹 Shape Generator)

| ☐ | 단계 |
|---|------|
| ☐ | `/en/shape-generator/` 접속, 페이지·캔버스 로드 (제목·뷰포트) |
| ☐ | 갤러리에서 shape 선택 또는 기본 생성 → 3D 뷰에 메시 표시 |
| ☐ | 파라미터 슬라이더 1회 변경 → 뷰 갱신 |
| ☐ | **Save scene** / `.nfab` 다운로드 (또는 저장) |
| ☐ | 새로고침 또는 **Load**로 방금 저장한 파일 열기 → 상태 복원 |
| ☐ | (선택) `tests/golden/m0-minimal.nfab.json`을 `.nfab`로 저장해 열기 → 박스 표시, 오류 없음 |

## 회귀 스모크 (자동과 병행)

| ☐ | 단계 |
|---|------|
| ☐ | `npm run test:e2e` — 최소 `commercial-release-smoke` + `shape-generator` 스펙 (시간 허용 시 전체) |

## 알려진 크리티컬

| ☐ | 단계 |
|---|------|
| ☐ | **P0/P1** 버그 없음, 또는 목록화·완화·타깃 스프린트 지정 |

## 서명

- 검증자: ________________
- 날짜: ________________
- 빌드/커밋: ________________
