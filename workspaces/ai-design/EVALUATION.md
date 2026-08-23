# AI Design scope 평가

## 현재 상태

- 평가: **회귀 기준 확보 / 경계 전환 초기**
- 담당 경계: `src/lib/ai/**`, AI·SCAD·design API, architecture/interior AI routes
- `npm run test:accuracy:common`: PASS (Vitest 60 tests + Node 7 tests)
- capability descriptor는 `LEGACY_COMPATIBILITY`; target 폴더는 메타데이터 중심이고 legacy source가 authoritative다.
- 첫 vertical slice: domain accuracy 평가 계약을 `capabilities/ai-design/domain-accuracy` adapter로 분리함

## 강점

- 공통 정확도 회귀 테스트가 있어 프롬프트/생성기 변경의 최소 안전망이 있다.
- AI API 범위가 registry에 명시되어 CAD와 병렬 작업할 수 있다.

## 개선 우선순위

1. 대표 AI design 요청 1개를 auth/job/artifact contract를 사용하는 adapter 경로로 이전한다.
2. 생성 결과의 schema, 재현성, 비용/지연시간을 fixture 기반으로 검증한다.
3. accuracy 테스트를 scope 변경 시 자동 실행하고 evidence freshness를 기록한다.
4. legacy route별 owner와 target capability 이전 순서를 문서화해 CAD·platform과의 경계를 명확히 한다.
