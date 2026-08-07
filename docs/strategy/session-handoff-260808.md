# NexyFab 새 세션 인계 문서 — 2026-08-08

## 1. 작업 위치와 Git 상태

- 작업 디렉터리: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
- 저장소 루트: 동일 경로
- 브랜치: `feat/landing-chat-first`
- 기준 HEAD: `1e78a8c8`
- 현재 worktree에는 기존 사용자 변경과 이번 작업 변경이 많이 섞여 있으며 아직 커밋되지 않았다.
- 새 세션은 `git reset`, `git checkout --`, `git clean`을 실행하지 말고 기존 변경을 보존해야 한다.
- 생성된 `.next-release`와 임시 서버는 정리된 상태다.

## 2. 현재 제품 판단

- 내부 테스트: 가능
- 제한된 클로즈드 베타: 가능
- 무료 공개 베타: 외부 staging 게이트 완료 후 가능
- 실제 결제 포함 공개 서비스: 아직 차단
- 기업 고객 생산 주문: 복구·결제·법무·분야 정확도 승인 후 권장
- 복잡 제품 95% 정확도: 평가 체계는 구축됐지만 독립 holdout과 전문가 승인이 없어 아직 입증되지 않음

## 3. 이번 연속 작업에서 완료한 핵심 기능

### CAD·OCCT

- 실제 OCCT/WASM Worker 경로와 활성화 검증
- STEP 실제 round-trip 및 burn-in 테스트 확대
- 손상·과대 입력 방어와 STEP 입력 정책
- Worker timeout, 취소, 재시작 기반
- Boolean 품질 정책과 async 품질 검사
- fillet/chamfer 회피·안정성 보완
- 홀 프로파일과 스케치 홀 변환 정확도 개선
- 메시 나사와 실제 OCCT 나사 경로 분리
- 실제 OCCT thread 적용 경로와 테스트
- 제조용 synthetic fallback 방지 원칙 강화

### 복잡 제품·분야 정확도

- 기계·토목·건축·조경·인테리어 정확도 프로그램
- 분야별 candidate 20건 생성 계약
- 자동 assertion과 증거 schema
- review packet, campaign, report, promote 도구
- 독립 승인 evidence 없이는 release를 막는 fail-closed gate
- 복잡 제품 benchmark v2와 interior 정확도 기준 보강

### 제조 lineage·RFQ·주문

- SQLite migration v78 `manufacturing_artifact_lineage`
- PostgreSQL lineage table과 RFQ/quote/order 연결 컬럼
- artifact ID, SHA-256, document version 전파
- 관리자 authorize/revoke API
- 승인되지 않은 artifact의 제조 흐름 차단
- quote/order/admin API 응답 lineage 계약 보강
- 관리자 감사 및 주문 이벤트 기반 보강

### UI·사용자 흐름

- `/ko → /kr`, `/zh → /cn` canonical redirect
- expert route의 `expert=1` 서버/클라이언트 계약 통일
- hydration mismatch 제거
- 현재 Shell의 DFM과 RFQ 진입 연결
- Q8 test ID 및 자동저장 검증
- landing의 대형 `ChatHero` 동적 로딩

### 렌더링·성능

- FPS, frame p95, triangles, draw calls HUD
- demand 렌더 idle을 프레임 지연으로 오인하던 문제 수정
- scene graph 기반 실제 visible mesh triangle 집계
- S/M/L/XL 실제 WebGL fixture 추가
  - S: 25,000 triangles
  - M: 100,000 triangles
  - L: 500,000 triangles
  - XL: 1,100,000 triangles
- 일반 CI는 구조·tier를 검사하고 전용 GPU에서만 FPS/p95를 강제
- `e2e/viewport-performance.spec.ts` 추가

### 빌드·배포

- `NEXT_DIST_DIR` 격리 빌드 지원
- postbuild static sync와 bundle budget이 격리 distDir 지원
- Sentry client capture를 `@sentry/browser`로 분리
- CAD 클라이언트의 Prisma/OpenTelemetry import trace 제거
- standalone tracing에서 런타임과 무관한 대형 디렉터리 제외
  - `.claude`, `.git`, `src-tauri`, `out`, `out2`
  - docs, e2e, tests, test-results, playwright-report, validation-reports
- 런타임 `data`, `public`, OCCT Worker는 추적 대상 유지

### 운영 자동화

- 상용 configuration fail-closed gate
- 운영 증거 fail-closed gate
- PostgreSQL schema capability preflight
- 백업 restore target 안전장치
- rollback build/DB/OCCT 검증기
- Playwright 브라우저 executable preflight
- Commercial CAD 다중 브라우저 CI matrix
- build ID health 응답
- 상용 환경 변수 placeholder 보강

## 4. 실제 검증 결과

### 정적·단위 검증

- 전체 TypeScript 검사 통과
- 대상 ESLint 통과
- `git diff --check` 통과
- CAD/lineage/viewport/상용 준비 핵심 묶음: 11개 파일, 44개 테스트 통과
- 브라우저·복구·rollback·정확도 후보 안전장치: 12개 Node 테스트 통과
- 추가 상용 준비·증거 Vitest: 8개 통과
- SQLite 제조 lineage migration v78 검증 통과

### 운영 빌드

standalone tracing 최적화 후 완전히 삭제한 격리 디렉터리에서 3회 연속 성공:

1. 546.1초
2. 515.3초
3. 484.8초

공통 결과:

- 628개 정적 페이지 생성
- postbuild 성공
- shared/worst first-paint 691.6KB
- 예산 763.3KB 통과
- 3회 모두 10분 이내

### 브라우저 E2E

- 운영 standalone Q8 + S/M/L/XL: 6개 모두 통과, 3.1분
- 마지막 세 번째 standalone Q8: 2개 통과, 51.5초
- 검증 흐름: 기본 Box → canvas → DFM → RFQ → 자동저장, undo/redo
- Chromium 설치 확인
- Firefox/WebKit은 로컬 바이너리 미설치
- `npx playwright install firefox webkit`은 외부 Playwright cache lock/다운로드 지연으로 10분 내 완료되지 않음
- 제품 실패가 아니라 실행 환경 준비 미완료 상태

## 5. 현재 남은 경고와 차단 요소

### 코드/빌드 경고

- Next 16의 middleware convention deprecated 경고: 향후 `proxy` convention 전환 필요
- 서버 API `eng-chat`의 Sentry→Prisma/OpenTelemetry critical dependency 경고
- `nodeOcctLoader` dynamic dependency 경고
- 이 경고들은 현재 빌드 실패나 Chromium Q8 실패를 만들지는 않음

### 현재 로컬 preflight

`npm run commercial:preflight` 결과:

- blocker: `DATABASE_URL` 없음
- DB capability 검증 불가
- warning: cross-product URL 일부 미설정
- warning: 로컬 결제키는 staging 테스트 키

`npm run browser:preflight` 결과:

- Chromium: PASS
- Firefox: MISSING
- WebKit: MISSING

### 실제 상용 release gate에 필요한 외부 조건

- PostgreSQL
- Redis
- 비공개 S3/R2 bucket과 access key
- SMTP 또는 Resend
- Sentry DSN
- Cron secret
- 안정적인 Server Action encryption key
- 완전한 결제 provider API/webhook 설정
- `NEXYFAB_COMMERCIAL_MODE=1`
- on-call/support/rollback 책임자
- 최근 실제 restore drill
- 최근 결제·환불 rehearsal
- 법무 정책 승인
- 5개 분야 승인 evidence directory

## 6. 새 세션에서 가장 먼저 읽을 문서

1. 이 문서: `docs/strategy/session-handoff-260808.md`
2. 전체 누적 기록: `docs/strategy/cad-occt-work-completed-and-detailed-next-plan-260807.md`
3. 사용자가 수행할 작업: `docs/operations/owner-action-checklist.md`
4. 상용 운영 runbook: `docs/operations/commercial-launch-runbook.md`

## 7. 사용자가 직접 해야 하는 작업

상세 명령과 완료 증거는 `docs/operations/owner-action-checklist.md`에 있다.

우선순위:

1. staging PostgreSQL 생성 및 `DATABASE_URL` 등록
2. Redis와 비공개 S3/R2 생성
3. SMTP/Sentry/Cron/Server Action key 등록
4. 결제 sandbox와 webhook 등록
5. 실제 `_restore_drill` DB 복구훈련
6. staging rollback 리허설
7. GitHub Actions Firefox/WebKit/mobile browser matrix 실행
8. 실제 GPU 3등급에서 S/M/L/XL 실행
9. 5개 분야 holdout과 전문가 blind review
10. 법무 정책 승인과 운영 책임자 지정

실제 비밀값은 저장소나 MD에 쓰지 않고 배포 secret에만 입력한다.

## 8. 새 세션 권장 실행 순서

### 외부 staging이 아직 없을 때

1. worktree 변경을 기능군별로 분류하되 되돌리지 않기
2. middleware→proxy 전환 영향 조사
3. server-only Sentry/Prisma build warning 축소
4. nodeOcctLoader warning 축소
5. 브라우저 matrix CI workflow 정적 검토
6. CAD corpus 장시간/메모리 테스트 자동화 확대

### staging 자격증명을 받은 뒤

```powershell
npm run migrate -- up
npm run migrate -- status
npm run commercial:preflight
npm run commercial:release-gate
```

복구훈련:

```powershell
$env:BACKUP_FILE='C:\secure\backups\latest.sql.gz'
$env:RESTORE_DATABASE_URL='postgresql://.../nexyfab_restore_drill'
npm run backup:verify-restore
```

rollback 검증:

```powershell
$env:ROLLBACK_BASE_URL='https://staging.example.com'
$env:EXPECTED_BUILD_ID='<expected build ID>'
npm run rollback:verify
```

GPU 인증:

```powershell
$env:PW_ENFORCE_GPU_BUDGET='1'
npx playwright test e2e/viewport-performance.spec.ts --project=chromium --workers=1
```

## 9. 주요 신규 명령

```powershell
npm run commercial:preflight
npm run commercial:release-gate
npm run browser:preflight
npm run backup:verify-restore
npm run rollback:verify
npm run verify:lineage-migration
npm run test:accuracy:common
npm run test:accuracy:mechanical
npm run test:accuracy:civil
npm run test:accuracy:building
npm run test:accuracy:landscape
npm run test:accuracy:interior
```

## 10. 변경 관리 주의사항

- 현재 변경량이 크므로 새 세션에서 전체 파일을 일괄 revert하지 않는다.
- 기능별 checkpoint/commit 전에는 각 묶음의 테스트 명령과 증거를 기록한다.
- `occt-worker`와 `public/occt-worker`의 복제 파일은 동기화 관계를 유지한다.
- `.next-release`, 임시 DB, Playwright report는 소스가 아니다.
- `.env.local` 또는 상위 `.env`의 값을 출력하거나 문서에 복사하지 않는다.
- 95% 정확도는 독립 holdout 승인 전까지 공개 보장하지 않는다.

## 10.5 2026-08-08 세션 실행 기록 (§8 "외부 staging이 아직 없을 때" 완주)

1. **worktree 146개 변경 → 기능군 16커밋 완결** (b3e19637 ~). docs/evidence/(149MB)만 관례대로 비추적 유지. 각 커밋은 pre-commit 훅(lint-staged+전체 tsc+vitest related)을 통과했다.
2. **CAD 품질게이트 근본수정 (c0e85a35)** — 커밋 과정에서 related 전체 실행 시 13개 테스트가 실패하는 것을 발견(§4의 "44개 통과"는 표적 묶음만 실행한 결과였다):
   - `boundaryEdgeCount`를 T-정션 인지형으로 교체. 실측: box−cylinder 골든의 경계엣지 482/482가 콜리니어 덮임(T-정션 산물), 동일평면 큐브 subtract/union도 부피 500/1500 정확 — 종전 원시 계수는 정상 mesh CSG boolean 전부를 fail-closed시켰다.
   - watertight 차단은 mesh 클래스에만 적용. OCCT tessellation은 면별 삼각화라 곡면 이음에서 코드(chord) 불일치가 정상이며(접선 fillet 카나리아 재현), B-rep 유효성은 커널 계약이다.
   - `requireValidBrepResult`의 단일바디 요구 제거 — subtract 분할은 정당하고, 용접 컴포넌트 계수가 융합 솔리드를 2개로 오판해 정확한 OCCT 결과를 크래시 있는 mesh 폴백으로 강등시켰다(REF-PART 1 보스 union).
3. **middleware→proxy 전환 완료 (d2d47a7a)** — Next 16.2.6 소스로 실증: proxy는 항상 Node.js 런타임(runtime segment config=E1031), middleware+proxy 공존=빌드 에러 E900, src/ 사용 시 src/*만 스캔(루트 middleware.ts는 종전대로 dormant). `src/middleware.ts`→`src/proxy.ts`+export 개명. 검증: 클린 빌드에서 deprecation 경고 소멸·`ƒ Proxy` 인식·번들 691.6KB 예산 통과, standalone에서 admin 428/expert 게이트 307/expert=1 200/legacy locale 308 curl 실측, Playwright 9/9(landing 7+Q8 2, 1.0m). ⚠️ rename 자체는 e9abcf97에 섞여 들어감 — 그 커밋 단독 checkout 금지(export 부재).
4. **eng-chat Sentry/Prisma 경고 축소 + 서버 오류 삼킴 회귀 수정** — error-capture.ts의 `import('@sentry/nextjs')` 우선 경로는 (a) Prisma/OTel critical dependency 경고의 유일한 원천이었고 (b) 서버는 어디서도 Sentry.init을 하지 않으므로 **초기화 안 된 captureException이 no-op으로 이벤트를 버리고 envelope 폴백을 가로채는** 회귀였다. envelope POST 단일화.
5. **nodeOcctLoader 경고 축소** — 변수 지정자 dynamic import에 `webpackIgnore: true` 추가(런타임 동작 동일, 부재 시 graceful fallback 유지).
6. **브라우저/정확도 CI 정적 검토 → 결함 3건 수정 (e9abcf97)** — ① ci.yml restore drill의 `createdb "$RESTORE_DATABASE_URL"`은 URI를 DB 이름으로 오용(로컬 소켓 접속 + 'postgres://…'라는 이름의 DB 생성) → psql CREATE DATABASE로 교체 ② domain-accuracy-matrix.yml만 `npm ci`(--legacy-peer-deps 누락 — 설치 단계 실패) ③ Playwright webServer timeout 600s는 실측 빌드 485-546s와 거의 동일 → 1500s, matrix job 30→50분. 4개 워크플로우 YAML 파스 검증.
7. **CAD corpus 장시간/메모리 자동화 (§8-6)** — `stepBurnInSoak.test.ts`: 한 커널 인스턴스에서 전체 burn-in 코퍼스를 N회 반복, 반복별 pass-rate 열화와 워밍업 후 RSS 성장(예산 256MB)을 게이트. `npm run test:occt:soak`(--expose-gc), 주간+dispatch `occt-kernel-soak.yml`. 실측(4회): 17/17 전회, RSS 687.5→625.1MB(성장 -62.4MB, 누수 없음).

추가 확인된 함정: 기존 dist 디렉터리 재사용 재빌드는 §21.3의 비결정 `Cannot read properties of undefined (reading 'length')` 예외를 재현한다 — dist 완전 삭제 후 클린 빌드가 정식 경로. next build는 tsconfig.json에 `.next-<dist>/types` include를 자동 추가한다(기계 churn — 커밋하지 말 것).

## 11. 완료 정의

유료 공개 서비스는 아래가 모두 충족돼야 한다.

- 상용 preflight PASS
- commercial release gate PASS
- PostgreSQL migration 및 실제 restore drill PASS
- 결제·환불 rehearsal PASS
- Chromium/Firefox/WebKit/mobile 핵심 matrix PASS
- 실제 GPU S/M/L/XL 예산 PASS
- rollback 10분 이내 PASS
- 법무 승인과 운영 책임자 지정
- 5개 분야 승인 evidence 확보

현재는 코드·Chromium·빌드 재현성은 상당 부분 충족됐고, 외부 운영 인프라와 독립 검증이 남은 상태다.
