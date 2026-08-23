# NexyFab 배포 경계 및 단계적 분리 계획

## 원칙

- scope는 작업·소유권 단위이고, deployable unit은 독립 실행·health check·rollback이 가능한 runtime 단위다.
- 기존 `src/**` legacy 경로를 즉시 삭제하지 않는다. adapter를 통해 새 unit과 병행한다.
- `deployEnabled`는 staging evidence와 rollback 준비가 확인된 뒤 unit별로 켠다.
- 각 변경은 한 vertical slice로 제한하고 integration branch에 작은 커밋으로 취합한다.

## 목표 배포 단위

| Scope | Unit | Runtime | 현재 상태 | 활성화 조건 |
|---|---|---|---|---|
| Platform | `studio-web` | Cloudflare/OpenNext | compatibility boundary, disabled | 독립 build + staging smoke + rollback |
| Platform | `core-api` | Railway Node | compatibility boundary, disabled | API contract + DB migration/restore + staging |
| Precision CAD | `cad-api` | Railway/Cloudflare | legacy routes를 adapter로 추출 | CAD contract/golden fixture + staging |
| Precision CAD | `cad-job-worker` | Queue/Worker | orchestrator partial | retry/DLQ/restore evidence |
| Precision CAD | `occt-worker`, `fea-worker` | Container | partial, disabled | isolated image + job health + rollback |
| AI Design | `ai-design-api` | API runtime | legacy compatibility | auth/job/artifact contract + accuracy regression |
| AI Design | `ai-design-worker` | Queue/Worker | 미분리 | deterministic fixture + retry/observability |

## 단계별 실행

### 1. Platform vertical slice

대표 health/authenticated API와 대표 studio route를 선택한다. 새 서비스 descriptor, 독립 build context, contract test를 추가하고 legacy route는 adapter로 남긴다.

### 2. Precision CAD vertical slice

shape-generator 또는 CAD job 중 하나만 선택해 `cad-api → job → occt` 흐름을 먼저 분리한다. FEA·추가 solver는 첫 slice가 staging에서 안정화된 뒤 확장한다.

### 3. AI Design vertical slice

대표 설계 요청 하나를 `ai-design-api → ai-design-worker`로 분리하고 auth/job/artifact contract를 통해 Platform과 연결한다. 정확도 회귀 테스트를 필수 gate로 둔다.

## 현재 판정

- 구조 테스트: PASS
- architecture validator: PASS
- 실제 runtime 배포 readiness: HOLD (`docs/evidence/platform-runtime/live-observation-current.json` 부재)
- 따라서 현재는 배포 활성화 단계가 아니라 분리·검증 단계다.
- slice별 로컬 readiness receipt: `docs/evidence/platform-runtime/slice-deployment-readiness.json`
- 재현 명령: `npm run platform:slices:receipt`, `npm run platform:slices:readiness`
- receipt의 staging/rollback 상태는 외부 환경이 없을 때 반드시 `NOT_RUN/HOLD`로 유지한다.

## 변경 허용 기준

각 slice는 다음을 모두 만족해야 다음 단계로 이동한다.

1. 소유 경계 충돌 0건
2. typecheck/lint 및 해당 scope 테스트 통과
3. 독립 build 또는 image 생성 성공
4. health/readiness endpoint 확인
5. staging smoke와 rollback receipt 확보
6. integration branch 취합 후 세 worktree clean 확인
