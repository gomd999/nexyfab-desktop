# Platform scope 평가

## 현재 상태

- 평가: **기반 안정 / 전환 진행 중**
- 담당 경계: `apps/**`, `services/**`, `workers/**`, `collab-worker/**`, `cron-worker/**`
- 검증: architecture check PASS, typecheck PASS, lint PASS
- 첫 vertical slice: `GET /api/health/live` 로직을 `apps/core-api` 경계로 추출하고 `platform-status` 화면을 추가함
- `apps/core-api`: legacy-route compatibility boundary, deploy disabled
- `apps/studio-web`: legacy-root compatibility, migration pending, deploy disabled

## 강점

- 백엔드·프론트엔드·worker의 소유권이 registry로 명시되어 충돌을 자동 검출한다.
- 공통 contract package와 platform validator가 import 경계를 보호한다.
- 별도 worktree에서 독립 작업 후 integration으로 취합할 수 있다.

## 개선 우선순위

1. 대표 API 한 묶음과 대표 화면 한 route를 adapter 뒤로 이동해 실제 end-to-end vertical slice를 완성한다.
2. service별 contract/integration 테스트와 배포 health check를 추가한다.
3. deploy disabled 사유와 활성화 조건을 문서화하고 staging smoke test를 CI gate로 만든다.
4. 대형 `ShapeGeneratorInner.tsx`를 분할해 lint/Babel 처리 비용과 변경 충돌을 줄인다.
