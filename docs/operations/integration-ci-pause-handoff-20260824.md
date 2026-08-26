# 통합 작업 기준 및 CI·릴리스 인계

## 2026-08-25 교차 저장소 복구 v3 부록

- Platform 구현 `2c79c2da`, 경로 비노출 보강 `f6496787`, release-bound 백업
  보호 `c54e6f60`에서 기존 commercial
  Precision 내구성 캠페인에 실제 PostgreSQL 덤프/격리 복원과 S3-compatible
  원본→백업→복원 전수 바이트 검증을 결속했습니다.
- 현재 HEAD 결속 영수증은 로컬 내구성 29/29 PASS
  (`67e1bafac0d4d747d0dd2d8ff1aa7b03d90bff64888a22e352cf714c6ad6d35a`)와
  교차 저장소 복구 v3 PASS
  (`575c30ebded3337f0cb9b50e24898bad30ddfd0746b1cb6fffb6c847b85a6b5d`)입니다.
- 복구 실행은 164개 테이블/104개 행, 최종 FK 83개/고아 0, 객체 8개/8,580
  bytes, DB 바인딩 입력 2·출력 3·스냅샷 3을 정확히 대조했습니다. 로컬 RPO
  age는 0 ms, 전체 RTO는 13,029 ms였습니다.
- 상용화 게이트는 v3 `release-bound` 영수증만 허용합니다. 체크인 영수증은
  `local-fixture`, Private Beta false, GA false이므로 실제 암호화 백업, provider/KMS,
  운영자·검토자, 인증 smoke, 파기 증거를 대체하지 않습니다.
- Release-bound 실행은 기존 immutable provider DB backup, KMS key-version/provider
  receipt 결속, 별도 endpoint/region object backup, versioning, Object Lock retention,
  KMS readback이 모두 없으면 fail closed합니다.
- CI는 `scripts/verify-backup-restore.mjs`와
  `scripts/verify-object-storage-restore*` 변경도 같은 digest-pinned 주간/경로 필터
  캠페인으로 재실행해야 합니다. Production과 staging은 변경하지 않았습니다.

## 2026-08-25 로컬 상용 내구성 폐쇄 부록 (historical baseline)

- 구현 커밋 `90c707a5`, `5c063e5a`, `fc828fd2`, `f42aee1c`에서 commercial Precision
  v3 경로를 immutable input v2, outbox/저널 원자적 claim·복구, 실제
  PostgreSQL/Redis/object-store 실행, 서명된 parser 권위 저장, workspace CAS까지
  닫았습니다.
- digest-pinned 일회성 캠페인은 24/24 체크를 통과했습니다. 체크인 영수증은
  `f42aee1cf67820d29bcb187cc8a7486cb5bc0776`에 결속되며 SHA-256은
  `b56527378bac7377a58b63fc6bb2c008fa11e578824a162a854ea5dfa2e058b4`입니다.
- 새 path-filtered/weekly CI workflow가 같은 캠페인을 반복합니다. Runtime
  evidence v2는 등록 worker의 실제 Ed25519 서명과 승격되는 각 체크의 정확한
  machine assertion provenance를 요구합니다.
- 로컬 native process와 자격증명은 fixture입니다. 이 부록은 기존 staging,
  production, credential rotation, 독립 검토, 제조 pilot, 보안·법무, 7일 운영
  HOLD를 대체하지 않습니다. Production은 변경하지 않았습니다.
- 기준 문서:
  `commercial-precision-local-durability-handoff-20260825.md`.

- 작성 시각: 2026-08-24 (KST)
- 최종 갱신: 2026-08-25 (AI Design·Precision CAD 전체 로컬 회귀 결속 기준)
- 기준 작업 디렉터리: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
- 통합 작업 브랜치: `integration/nexyfab`
- PR 작업 브랜치: `fix/integration-ci-portability`
- PR: <https://github.com/gomd999/nexyfab-desktop/pull/79>
- 구현 기준 소스 폐쇄 HEAD: `6e4c271e` (`[P1] test(cad): close full regression evidence drift`)
- CI 실행: <https://github.com/gomd999/nexyfab-desktop/actions/runs/32697624503>

## 2026-08-25 상용 Precision 런타임 게이트 부록

- 로컬 mechanical bounded 캠페인은 최신 소스에서 30/30 기능과 210/210 축이
  PASS했으며 판정은 `LOCAL_CANDIDATE`다. 독립 CAD·전문가·제조 증거가 아니다.
- integration merge `d22d2723`은 PostgreSQL/Redis/private object storage/outbox/lease,
  native worker, 세 출력, 서명 receipt/callback, authoritative persistence,
  negative/recovery/rotation 관측으로부터 HMAC 영수증을 파생한다.
- mechanical Private Beta는 15개 실행·공격 체크, commercial GA는 추가 5개
  production same-deployment 복구 체크를 모두 요구한다.
- `/api/health/release`도 동일 영수증을 현재 build/head/deployment/migration checksum에
  결박한다. `NEXYFAB_COMMERCIAL_MODE=1`만으로 runtime PASS가 되지 않는다.
- 현재 실제 native worker/evidence root/signing secret/외부 증거는 없으므로 repository
  receipt와 release는 의도대로 `HOLD`다. production은 변경하지 않는다.
- 다음 실행은 `docs/operations/commercial-precision-worker-v3.md`의 순서대로 staging
  canary·negative campaign을 수행하는 것이며, 이후 독립 CAD/전문가/제조·7일 운영·
  보안·법무 증거가 별도로 닫혀야 한다.

## 2026-08-25 AI Design·Precision CAD 전체 로컬 회귀 부록

- AI Design 통합 화면의 한국어/영어 이분기 잔여를 제거하고
  `ko/en/ja/zh/es/ar` 단일 카탈로그와 Arabic RTL 계약에 연결했다. 변경 commit은
  `498ca375`이며 집중 검사는 `7 files / 59 tests`, 관련 pre-commit 검사는
  `13 files / 76 tests` PASS다.
- current-head Precision 증거 commit `575cfcfb`에서 bounded mechanical
  `30/30 features`, `210/210 axes` 및 AI intent `10/10 cases`, `70/70 axes`가
  PASS했다. 판정은 계속 `LOCAL_CANDIDATE`다.
- 전체 회귀의 첫 실행에서 발견된 언어 분기 1건, runtime receipt source hash 1건,
  Node 증거 최신성/기대값 3건을 모두 닫았다. 회귀 폐쇄 commit은 `6e4c271e`다.
- 최종 Vitest는 `2,950 files / 30,188 tests` PASS, `10 files / 89 tests`
  environment/feature gated skip, `1 todo`다. Node suite는 `616 PASS / 5 skip /
  0 fail`이다. TypeScript와 production Next.js build도 PASS했고 `301/301`
  static pages와 bundle budget이 통과했다.
- 커널 identity는 현재 정책 소스와 WASM/worker bytes에 다시 결속됐고, secret scan은
  Git 후보 `10,154`개 파일, `325,732,738` bytes를 검사해 findings `0`이다.
- 로컬 빌드 중 `REDIS_URL` 미설정 경고가 확인됐다. 단일 프로세스 fallback은 상용
  다중 인스턴스 제한 저장소가 아니므로 실제 배포에서는 isolated Redis quota 증거가
  없으면 release를 계속 `HOLD`한다.
- 장시간 collaboration soak, live AI/provider, OpenSCAD CLI, 일부 WASM/performance
  캠페인은 환경 플래그/외부 실행기가 없어 의도적으로 skip됐다. 이를 PASS로 세지
  않으며 staging/GA 운영 캠페인에서 별도 실행한다.
- production 배포는 변경하지 않았다. 현재 결과는 소스·로컬 검증 폐쇄이며 상용 출시
  승인이 아니다.

## 현재 통합 결정

이 문서를 기준으로 `new` 작업 디렉터리에서 통합 수정과 검증을 진행한다. 추가 수정이 모두 끝날 때까지 긴 전체 회귀검증은 반복하지 않고, 변경 경로의 영향 테스트만 실행한다.

- 현재 변경은 커밋 및 PR 작업 브랜치까지 보존되어 있다.
- CI 빌드는 통과했다.
- 이전 E2E는 통합 수정 전 사용자 결정에 따라 의도적으로 취소했다.
- PR은 아직 병합하지 않았다.
- 이제 통합 소유 경로와 명시적으로 통합 결정된 변경을 `new`에서 수정한다.
- 각 수정 중에는 빠른 영향 테스트를 실행하고, 통합 수정 완료 후 전체 CI/E2E를 한 번에 실행한다.
- 보호된 `origin/integration/nexyfab`에는 직접 푸시하지 않고 PR 작업 브랜치를 통해 검토한다.
- 실제 배포와 Git 기록 재작성은 수행하지 않았다.

## 통합 작업 실행 기준

### 작업 위치와 소유권

- 기준 저장소는 `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`다.
- `worktrees/platform`, `worktrees/precision-cad`, `worktrees/ai-design`의 미완료 변경을 이 디렉터리에서 임의로 수정하거나 폐기하지 않는다.
- scope 전용 구현은 해당 scope에서 완료·인계한 뒤 통합한다.
- `.github/workflows`, 루트 의존성/lockfile, 공유 계약, 공통 테스트·증거처럼 registry상 통합 소유인 경로는 이 통합 작업에서 결정한다.
- 같은 파일에 여러 scope 변경이 겹치면 기계적으로 덮어쓰지 않고 계약·테스트 기준으로 병합한다.

### 브랜치와 커밋 기준

- 로컬 `integration/nexyfab`은 현재 `origin/integration/nexyfab`보다 9개 커밋 앞서 있다.
- 현재 HEAD는 원격 `origin/fix/integration-ci-portability`와 동일한 `9e064660`이다.
- 후속 통합 변경은 작고 검토 가능한 단위로 커밋한다.
- 최종 검증 전에는 원격 PR 브랜치에 불필요한 중간 푸시를 반복하지 않는다.
- 푸시할 때는 보호된 통합 브랜치가 아니라 PR 작업 브랜치 `fix/integration-ci-portability`를 갱신한다.
- 이 MD는 다음 통합 커밋에 포함하며, 문서만 푸시해 CI를 새로 시작하지 않는다.

### 작업 중 테스트 기준

- 변경 직후에는 관련 단위·계약·경계 테스트만 실행한다.
- DB, 인증, 릴리스 게이트, 공용 계약을 건드리면 해당 회귀 테스트는 작업 중에도 반드시 실행한다.
- TypeScript와 lint는 의미 있는 통합 묶음이 완성될 때 실행한다.
- 전체 Next.js build와 전체 Playwright E2E는 최종 통합 수정이 끝난 뒤 실행한다.
- Large assembly 성능, OCCT burn-in, 전체 milestone 검증은 병합 후 main 단계에서 실행한다.
- 테스트를 뒤로 미루는 것은 생략이 아니라 최종 HEAD에서 한 번에 유효한 결과를 얻기 위한 순서 조정이다.

### 병합 조건

- 작업트리에 의도하지 않은 파일이 없어야 한다.
- scope별 인계 커밋과 통합 대상이 명확해야 한다.
- 타입, lint, 단위/계약, DB 복원, 보안, 플랫폼 경계, 빌드, E2E 필수 검사가 모두 통과해야 한다.
- PR이 `MERGEABLE`이고 필수 검사 기준으로도 `BLOCKED`가 해소되어야 한다.
- 필수 검사가 취소·skip·실패 상태이면 병합하지 않는다. 단, PR에서 실행하지 않도록 설계된 main 전용 장기 검사는 예외다.

## 현재 상태 평가

### 종합 판정

현재 상태는 **기술 기반은 양호하지만 통합·릴리스 승인은 보류**다.

- 코드와 PR 사이에는 병합 충돌이 없다. GitHub 판정은 `MERGEABLE`이다.
- 그러나 E2E를 의도적으로 취소했기 때문에 보호 규칙상 PR 상태는 `BLOCKED`다.
- 타입, lint, 단위 테스트, 보안, DB 복원, 플랫폼 경계, 도메인 정확도, 프로덕션 빌드까지 통과했다.
- 통합 수정이 이제 시작되므로 현재 결과를 최종 회귀검증으로 간주하면 안 된다.
- 따라서 **통합 작업 진행은 가능**, **현재 즉시 병합·배포는 불가**로 판단한다.

| 평가 영역 | 상태 | 평가 근거 |
| --- | --- | --- |
| 소스 및 빌드 건전성 | 양호 | 타입, lint, 단위 테스트, Next.js 빌드 통과 |
| CI 공급망 보안 | 양호 | Actions 전체 SHA 고정, 최소 권한, 보호 규칙 및 Environment 승인 적용 |
| 의존성 재현성 | 양호 | Node/npm/Next/타입/ws 정렬, npm 10 lockfile 검증 |
| 데이터베이스 안전성 | 양호 | 신규 SQLite migration 회귀검사와 PostgreSQL 이중 적용·복원 드릴 통과 |
| 아키텍처 경계 | 양호 | FEA–Precision CAD 계약 분리와 workspace boundary 검사 통과 |
| 자동 회귀 신뢰도 | 조건부 | 로컬 1,703개 테스트는 통과했으나 최신 원격 E2E는 취소됨 |
| 통합 준비도 | 조건부 보류 | PR 충돌은 없지만 추가 수정 예정이며 필수 E2E가 미완료 |
| 프로덕션 릴리스 준비도 | HOLD | 운영 승인, 외부 증거, secret 회전, 장기 검증이 남음 |
| Git 기록 정리 준비도 | HOLD | dry-run과 백업은 양호하나 worktree 동결·협업자 조율·secret 회전 전에는 실행 금지 |

### 강점

- 변경 범위가 CI, 릴리스, 의존성, 계약 경계, CAD 구조, DB 안정성까지 일관되게 연결되어 있다.
- 보안 설정이 문서 수준이 아니라 GitHub 보호 규칙과 워크플로 실행 경로에 실제 반영됐다.
- 신규 DB와 복원 드릴을 함께 검증해 기존 DB에서만 통과하는 오류 가능성을 낮췄다.
- 실패 시 Playwright 보고서와 실제 결과를 남기므로 다음 E2E 실패의 진단 가능성이 높아졌다.
- 기록 정리는 원본에 직접 적용하지 않고 별도 번들·mirror dry-run으로 검증해 복구 가능성을 확보했다.

### 남은 핵심 위험

1. **P0 — 최신 E2E 미완료**
   - CI를 의도적으로 취소했으므로 브라우저 기반 핵심 흐름의 최종 상태는 아직 미확정이다.
2. **P0 — 통합 수정 진행**
   - 이후 변경이 현재의 테스트와 빌드 결과를 무효화할 수 있다.
3. **P0 — 과거 secret 회전 미완료**
   - 기록 정리만으로 노출된 비밀값의 효력을 제거할 수 없으므로 공급자에서 먼저 회전해야 한다.
4. **P1 — 장기 CAD 검증 미실행**
   - Large assembly 성능, OCCT B-rep burn-in, main 전체 milestone 검증이 남아 있다.
5. **P1 — 운영 증거 부족**
   - staging/production 복원, 인증 E2E, pilot 기간, 독립 검토와 rollback 증거가 완결되지 않았다.
6. **P1 — 여러 worktree의 미완료 변경 가능성**
   - 기록 재작성이나 최종 통합 전에 각 scope 작업을 커밋·인계·동결해야 한다.

### 현재 Go/No-Go 결정

| 작업 | 결정 |
| --- | --- |
| 추가 통합 수정 | **GO** |
| 현재 PR 즉시 병합 | **NO-GO** |
| 수정 완료 후 전체 CI/E2E | **GO, 필수** |
| staging 검증 | **수정 및 E2E 통과 후 GO** |
| production 배포 | **NO-GO / HOLD** |
| 실제 Git 기록 재작성·force-push | **NO-GO / HOLD** |

### 권장 결론

이제 통합 작업을 진행해도 된다. 작업 중에는 영향 테스트로 빠르게 회귀를 차단하고, 마지막 통합 커밋 기준 전체 CI/E2E가 초록이 된 뒤에만 병합한다. 이전 중단은 검증 면제가 아니라 **검증 시점을 최종 통합 수정 이후로 이동한 것**이다.

## 완료된 작업

### CI 및 릴리스 보안

- GitHub Actions 사용 항목을 변경 가능한 태그 대신 전체 커밋 SHA로 고정했다.
- `actions/checkout`을 v7.0.1 계열 SHA `3d3c42e5aac5ba805825da76410c181273ba90b1`로 정렬했다.
- `actions/setup-node`를 v7.0.0 계열 SHA `820762786026740c76f36085b0efc47a31fe5020`로 정렬했다.
- 14개 워크플로의 불변 SHA 검사 게이트를 추가했다.
- 기본 토큰 권한을 읽기 위주로 축소하고 배포 권한을 필요한 작업에만 부여했다.
- 릴리스 경로를 GitHub `production` Environment 승인과 연결했다.
- 브랜치 보호에 필수 검사, 관리자 적용, force-push 및 삭제 금지를 반영했다.
- 릴리스 준비 상태가 HOLD일 때 배포 경로가 실패하도록 fail-closed 처리했다.

### 테스트 및 플랫폼 품질

- 플랫폼 서비스, 워커, 컨테이너, 정책 검사를 CI 필수 경로에 추가했다.
- Playwright와 Vitest의 테스트 탐색 경로를 보강했다.
- CI E2E 제한 시간을 90분으로 조정했다.
- E2E 실패 시 `playwright-report/`와 `test-results/`를 함께 업로드하도록 보강했다.
- 신규 SQLite DB 마이그레이션과 동시 초기화 회귀 테스트를 추가했다.
- PostgreSQL 마이그레이션 이중 적용 및 복원 드릴을 CI 게이트로 확인했다.
- 결제/크론 API가 준비 상태를 노출하기 전에 인증과 origin 검사를 수행하도록 순서를 수정했다.
- 현재 제품 IA와 도메인 계약에 맞게 가이드 설계, HLR, 견적, 사이드바 E2E를 갱신했다.
- `AssemblyPresetPanel`의 실제 텍스트 대비를 4.41:1 수준으로 보정했다.

### 의존성 및 타입 정렬

- Node.js `22.23.2`, npm `10.9.8` 기준을 통일했다.
- Next.js `16.3.0`과 `@types/node` 버전을 정렬했다.
- `ws`를 직접 의존성으로 선언하고 관련 타입 해석을 정리했다.
- npm 10 기준 lockfile을 다시 생성하고 재현성을 확인했다.
- 테스트 환경의 `server-only` 별칭을 정리했다.

### 공유 계약 및 CAD 구조

- FEA와 Precision CAD가 공유하던 계약을 별도 경계로 분리했다.
- 대형 CAD UI 컴포넌트를 역할별 모듈로 분할했다.
- 통합 경계와 scope 소유권 검사를 추가했다.

### 이미지 및 로컬 증거

- 애플리케이션 이미지를 현재 소스 기준으로 재빌드했다.
- 이미지와 소스 digest, readiness/release 상태 증거를 갱신했다.
- 사용한 임시 컨테이너는 제거했다.
- production release는 외부 승인과 실제 운영 증거가 부족하므로 계속 HOLD 상태다.

### Git 기록 정리 사전점검

- 전체 저장소 `git fsck`를 수행했다.
- 전체 refs 번들을 만들고 검증했다.
- 별도 mirror에서만 기록 정리 dry-run을 수행했다.
- dry-run 제거 대상은 과거의 `public/send-mail.php`와 `public/uploads`로 한정했다.
- 정리 후보가 현재 트리에 남지 않았고, 대상 외 트리 동일성을 확인했다.
- 실제 공유 저장소의 기록 재작성과 force-push는 수행하지 않았다.

관련 백업:

- 실행 전 백업: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\nexyfab-execution-backup-20260824-095542`
- 기록 정리 dry-run: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\nexyfab-history-dryrun-20260824-121734`
- dry-run 원본 번들 SHA-256: `fe9ce3c1...`
- dry-run 정리 번들 SHA-256: `c52ffb3c...`

## 지금까지의 검증 결과

로컬 커밋 전 검사:

- 테스트 파일 238개 중 236개 통과, 2개 skip
- 테스트 1,703개 통과, 3개 skip, 실패 0개
- TypeScript 검사 통과
- lint-staged 통과
- 신규 SQLite DB를 schema version 88까지 올리는 마이그레이션 통과
- 관련 회귀 테스트 10개 통과
- 14개 GitHub Actions 불변 SHA 검사 통과
- Playwright 관련 시나리오 54개 탐색 확인, CI에서는 27개 실행 구성

취소 전 GitHub CI 통과 항목:

- TypeScript Check
- ESLint
- Unit Tests 및 Tauri crate 테스트
- Security Audit
- Robustness gate
- PostgreSQL migration + restore drill
- Platform service, worker, container, policy gates
- mechanical/civil/building/landscape/common/interior 정확도 검사
- PR 제목 검사
- workspace boundaries 검사
- 도메인 매트릭스 검사
- Next.js Build Check: 5분 24초에 통과

미완료 또는 의도적 연기:

- E2E Tests: 실행 중 CI를 의도적으로 취소했으므로 최종 통과를 주장하면 안 된다.
- Large-assembly perf benchmark: PR에서는 설계대로 skip, 통합/main 단계에서 실행한다.
- OCCT B-rep burn-in: PR에서는 설계대로 skip, 통합/main 단계에서 실행한다.
- Full milestone verify: main/master push 전용이므로 아직 실행하지 않았다.

## 주요 작업 커밋

- `2e3ed43a`: GitHub Actions SHA 고정
- `50618123`: 플랫폼 CI 경로 추가
- `10d0222e`: 릴리스 보안 강화
- `c9183ecc`: Node/Next/타입/ws 버전 정렬
- `978183a6`: FEA 공유 계약 분리
- `f3afd81c`: 증거 및 기록 정리 자료
- `7792ab08`: 테스트용 server-only 별칭
- `2af70be5`: npm 10 lockfile
- `1c2ee3bd`: 이미지 증거
- `980989c1`: PHP 업로드 경로 제거
- `a6d3494a`: Node CI 정렬
- `821ca058`: 릴리스 HOLD 경로
- `8bc9f810`, `95a29ecf`, `9d1d5100`: 증거 이식성 보강
- `24b3114c`: production Environment 연결
- `31a029a5`: 백업 소유권 정리
- `6af5d209`: PostgreSQL text array 처리
- `2ba68e74`: 제약 검증
- `390053e6`: Actions v7 정렬
- `d43e6de7`: Playwright/Vitest 탐색 보강
- `9e064660`: 신규 DB 및 E2E 릴리스 게이트 안정화

## 통합 작업 진행 순서

1. 통합 대상 변경의 출처, scope 소유권, 커밋과 변경 파일을 확인한다.
2. 현재 PR 작업을 보존한 상태에서 충돌을 계약·테스트 기준으로 해결한다.
3. 변경된 경로의 단위·계약·경계 테스트를 먼저 실행한다.
4. 의미 있는 통합 묶음별로 커밋하고 이 문서의 HEAD와 상태를 갱신한다.
5. 최종 통합 수정 후 TypeScript, lint, DB 마이그레이션, 플랫폼 게이트와 Next.js build를 실행한다.
6. PR 작업 브랜치를 푸시하고 전체 GitHub CI와 E2E를 실행한다.
7. E2E 시각 회귀가 Linux baseline 문제로 실패하면 업로드된 `test-results` 이미지를 검토한 뒤 정당한 baseline만 추가한다.
8. 모든 필수 검사가 초록일 때만 PR #79를 `integration/nexyfab`에 병합한다.
9. 병합 후 main 전용 장기 성능·OCCT·전체 milestone 검증을 실행한다.
10. 최종 HEAD 기준 전체 refs 번들을 새로 만들고 `git bundle verify`와 `git fsck`를 다시 수행한다.

## 사용자가 직접 처리해야 하는 항목

1. 과거에 노출된 reCAPTCHA 비밀키를 공급자에서 회전하고 이전 키를 비활성화한다.
   - Railway, Cloudflare, GitHub Secrets의 값을 새 키로 갱신한다.
   - 비밀키는 채팅이나 커밋에 붙여 넣지 않는다.
2. Platform, Precision CAD, AI Design 및 다른 작업 세션의 미완료 worktree를 커밋·인계하거나 동결한다.
3. production Environment 배포 시 최종 승인자로 승인한다.
4. staging/production 복원, 인증 E2E, 30일 pilot, 독립 리뷰어, 권리 확인 CAD/FEA 자료, rollback 증거를 수집한다.
5. 비밀키 회전과 worktree 동결 후 Git 기록 정리 시간을 정하고 협업자에게 재클론 필요성을 알린다.

## 금지 사항 및 현재 HOLD

- E2E가 완료되지 않았으므로 전체 회귀검증 통과로 표시하지 않는다.
- production release를 READY로 변경하지 않는다.
- dirty worktree와 협업자가 남아 있는 상태에서 기록 재작성이나 force-push를 하지 않는다.
- 백업 검증 없이 기록 정리를 실행하지 않는다.

## 2026-08-24 로컬 통합 재개 결과

이 문서 이후 실제 코드와 최신 AI Design/Precision CAD 인수 문서를 다시 대조하고,
`integration/nexyfab`에서 다음 통합을 완료했다.

- Platform: 공통 계약·경계 변경과 Platform 인수 내용을 통합했다.
- AI Design: V9/V10 통합 계약과 10개 상태 fixture를 실제 채팅 중심 워크스페이스에 연결했다.
- Precision CAD: GP02-GP11 생산자/소비자 체인과 native B-rep 보정을 통합했다.
- 프로젝트의 `AI Design` 진입에서 첫 프롬프트로 세션을 만들고 V10 화면으로 이동한다.
- 실제 SVG 2D와 Three.js 3D 캔버스가 같은 stable ID 선택을 공유한다.
- 서버가 concept preview를 발급하고, 명시적 확인과 revision 검증 뒤에만 적용한다.
- Precision handoff는 요청만 생성하며 exact execution, verification, release를 `false`로 유지한다.
- 최신 canonical handoff 자동 선택은 schema와 HEAD까지 검증해 계획 문서를 잘못 고르지 않는다.

주요 신규 통합 커밋:

- `bbdb7448`: V10 proposal 증거, concept preview/apply, Precision handoff 신뢰 경계
- `dd32f4db`: 프로젝트 진입, 채팅 중심 V10 UI, 실제 2D/3D 연동, 모바일/E2E

로컬 검증 결과:

- V10 집중 테스트 41개 통과
- 커밋 훅 관련 테스트 60개 및 18개 통과
- TypeScript 전체 검사 통과(Node 22, 8 GB heap)
- Next.js production build 통과, 정적 페이지 301/301 생성
- 번들 예산 통과: shared 723.6 KB, worst first paint 1764.0 KB
- Playwright desktop Chromium 및 mobile Chrome 2/2 통과
- workspace audit 통과: collision 0, descriptor issue 0
- Platform architecture check 통과: issue 0

남은 HOLD:

- 로컬 proposal 저장소는 10분 TTL의 단일 프로세스 fail-closed 구현이다. 다중 인스턴스 production 전
  Redis 또는 동등한 durable store로 교체해야 한다.
- `REDIS_URL`이 없는 상태의 rate limit은 인스턴스별이므로 production READY가 아니다.
- 과거 노출 credential 회전, 원격 push/deploy, GitHub 전체 CI, production 승인과 release는 수행하지 않았다.
- 기록 재작성과 force-push도 계속 금지한다.

## 2026-08-24 AI Design–Precision CAD exact 폐루프 통합 결과

최신 로컬 통합 HEAD `920e660d`에서 V10 Precision 요청 이후의 실제 exact
실행 경로를 추가로 닫았다.

### 완료된 소스 통합

- PostgreSQL migration `2026082403`과 SQLite migration `91`에 AI–Precision
  transactional outbox와 append-only receipt ledger를 추가했다.
- AI handoff coordinator가 runtime/complex revision, candidate,
  product-structure node, 현재 canonical CAD HEAD와 stable feature를 묶은 뒤
  idempotent exact job을 적재한다.
- 인증된 cron worker가 권위를 다시 확인하고 실제 Node OCCT current-head
  bundle을 실행한다.
- STEP, HLR SVG, dimension, BOM, verification, canonical manifest를 private
  content-addressed immutable object로 저장하고 SHA readback을 검증한다.
- 서명 PASS/FAIL 영수증만 AI aggregate와 읽기 모델에 반영된다. 브라우저와
  AI는 PASS나 제조 권한을 생성할 수 없다.
- post-dispatch 결과가 불확실하면 자동 CAD 재실행 대신
  `VERIFIED_UNKNOWN`으로 격리하며, 기존 불변 영수증과 aggregate reference가
  일치할 때만 재조정한다.
- cron route 인증, Railway 1분 일정, readiness fail-closed 환경 조건, migration
  checksum/deploy 검증을 연결했다.

### 최신 로컬 검증

- Production build: PASS, 정적 페이지 301개, bundle budget PASS.
- TypeScript, focused ESLint, diff check: PASS.
- 브리지/조정기/worker/route/PostgreSQL authority 집중 회귀: PASS.
- 실제 Node OCCT STEP current-head bundle: PASS.
- migration/deploy contract: 10 tests PASS.
- worker/storage 관련 commit gate: 46 files / 341 tests PASS.
- `workspace:integration-status`: `STRICTLY_INTEGRATED`; platform,
  precision-cad, ai-design 모두 ahead/behind 0, dirty 0.
- `workspace:audit`: collision 0, descriptor issue 0.
- AI scope check: TypeScript, 62 common-accuracy tests, 7 candidate manifests
  PASS.
- Precision scope check: TypeScript와 platform architecture PASS.
- Platform scope check: full source ESLint와 TypeScript PASS.

### 현재 판정과 다음 게이트

판정은 `RUNTIME_CONNECTED_LOCAL / PRODUCTION_HOLD`다. 구현과 로컬 결정론
회귀가 닫혔다는 뜻이지 상용 운영 증거가 완성됐다는 뜻은 아니다.

다음 순서는 staging PostgreSQL migration/restore, 실제 private object bucket,
Redis 다중 인스턴스, Railway cron/worker 재시작·lease·alarm,
`VERIFIED_UNKNOWN` 복구, authenticated browser read-model refresh, tenant/stale/
tamper negative E2E다. 이후 전체 GitHub CI/E2E, OCCT burn-in, large assembly,
독립 STEP 교환 검토, 전문가 리뷰, 실제 가공과 pilot 증거가 모두 같은 revision에
결속돼야 한다.

원격 push/deploy, production 승인, secret 공급자 회전, Git history rewrite는
이번 로컬 통합에서 수행하지 않았다. 따라서 PR 병합·production·제조·상용
release는 계속 `HOLD`다.

## 2026-08-25 staging 상용화 기반선 및 통합 결속 결과

이 절은 위의 2026-08-24 로컬 전용 상태보다 우선하는 최신 운영 인계다.
AI Design V9/V10, Precision CAD GP10/GP11 및 exact bridge 구현은 현재
integration 소스에 결속됐고, 격리된 Railway staging에서 플랫폼 기반선을
실증했다. 전체 판정은 **`STAGING_RUNTIME_CONNECTED / COMMERCIAL_RELEASE_HOLD`**다.

연결한 불변 문서:

- `workspaces/ai-design/HANDOFFS/20260824T153232+0900-ai-design-chat-first-v9.md`
- `workspaces/ai-design/HANDOFFS/20260824T170157+0900-ai-design-v9-v10-integration-addendum.md`
- `workspaces/ai-design/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260824T075706Z-gp10-mechanical-bounded-30-of-30.md`
- `workspaces/precision-cad/GP_10_MECHANICAL_EXACT_CLOSED_LOOP_ADR.md`
- `workspaces/precision-cad/INTEGRATION_ACTIONS.md`
- `workspaces/precision-cad/CURRENT.md`
- `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\worktrees\NEXYFAB_MASTER_PLAN.md`

### 배포 및 데이터 기반선

- source/build/git: `0210c8f9cbc4ccd0f97fbc3a6329317d0e510001`.
- deployment: `15750b22-c835-4ba7-8d64-a0f8c032da0c`, `SUCCESS`.
- image: `sha256:83d2a6118591e2c876d7e6103caf2865fcbc7c33d392244383a7eed87c378069`.
- 실제로 서로 다른 두 web instance `2ec8fc92-e9a3-4e1e-9412-14357c147877`,
  `6d6672f1-bd58-42b5-9db8-a5916f1c5a6b`가 `RUNNING`이다.
- 공개 readiness는 HTTP 200이고 PostgreSQL/Redis가 모두 `ok`다.
- release-health는 build/deployment/git/migration을 `PASS`로 보고하고,
  staging non-commercial boundary, i18n, seven-day evidence 때문에 HTTP 503
  `HOLD`를 반환한다.
- staging PostgreSQL은 migration `2026082501`과 등록된 source checksum,
  commercial table/constraint/trigger 검사를 통과했다. 상용 preflight의 DB
  blocker는 0이다.
- 실제 staging private bucket, Redis, exact-CAD health, OpenSCAD worker, FEA
  worker를 확인했다. production read-only source를 staging-owned isolated
  target에 복원한 검증도 `2026082501`까지 통과했으며 production은 수정하지 않았다.

정리된 진단 영수증:
`docs/evidence/operations/staging-commercial-readiness-20260825.json`.
이 JSON은 비밀값을 포함하지 않는 진단 기록이며 signed commercial release
receipt가 아니다.

### 다중 인스턴스와 stale source 재발 방지

처음 2-replica 변경은 `/app/data` Railway volume 때문에
`Replicas are not supported if you have a volume attached to your service.`로
container 생성 전에 실패했다. 실제 volume 내부는 `lost+found`뿐이고 20 KB였으며,
runtime은 PostgreSQL과 private S3를 사용하고 `NEXYFAB_DB_PATH`/`DATA_ROOT`를
사용하지 않았다.

staging에서만 volume을 detach했고 삭제하지 않은 리소스로 보존했다. detach와
scale 과정에서 Railway가 연결된 오래된 GitHub `main`을 자동 배포하려는 동작을
확인해 해당 deployment ID만 취소하고 검증 이미지를 복구했다. 이후 환경별
auto-deploy를 staging에서만 `false`로 설정했으며 production은 기존 `true`를
유지했다. 검증 배포 스크립트도 다음을 강제한다.

- 환경명이 정확히 `staging`일 것;
- commercial mode가 `0`, release channel이 `staging-hold`일 것;
- `NEXYFAB_BUILD_ID`와 `RELEASE_GIT_HEAD`가 예상 commit과 일치할 것;
- staging auto-deploy가 실제 Railway API에서 `false`일 것;
- workspace audit, platform architecture, reproducible build가 통과할 것;
- live health build ID가 target commit과 일치할 것.

### 실제 상용 preflight 판정

Railway 대상 변수와 실제 staging PostgreSQL을 사용해 commercial mode를
프로세스 안에서만 시뮬레이션했다. staging 환경변수는 변경하지 않았다. 실제 구성
blocker는 15개다.

1. SMTP host/user/password 3개.
2. Sentry DSN.
3. 실제 결제 provider의 완전한 API/webhook 한 세트.
4. exact 3-role server Ed25519 trust registry와 유효한 server trust.
5. Precision CAD commercial execution mode.
6. commercial worker의 Ed25519 registry, claim secret, transport secret,
   callback secret, server-owned callback URL.
7. 독립 external verifier의 Ed25519 registry와 transport secret.

로컬 SSH TCP forward가 Railway에서 닫혀 preflight에 Redis 연결 오류 1개가
추가됐지만 이는 blocker 수에서 제외했다. 동일 배포의 내부 Redis probe와 공개
readiness가 실제 PONG 경로를 통과했기 때문이다.

환경키만 채우는 것으로 worker 경계를 통과 처리하면 안 된다. 현재 commercial
worker v2 job은 입력 hash를 갖지만 executor가 내려받을 수 있는 immutable input
artifact locator가 없고, claim -> 실제 native execution -> signed callback을 수행하는
배포된 client 구현도 확인되지 않았다. 이 두 구현이 생기기 전에는 임의 registry나
secret을 생성하지 않는다.

로컬 후속 점검에서 일반 CAD job 경로의 `inputArtifacts`와
`/api/internal/cad-job-artifacts`에는 이미 private object key, SHA-256 readback 및
worker 인증 다운로드 경계가 있음을 확인했다. 반면 commercial precision execution
v2 계약은 이 경계를 사용하지 않고 hash만 전달하며, 저장소 어디에도 commercial
claim을 소비해 installer/native tool을 실행하고 세 출력 역할을 업로드한 뒤 Ed25519
영수증을 callback하는 배포 가능한 client가 없다. 그러므로 이 항목은 단순 설정 누락이
아니라 **실행 계약과 worker 구현의 P0 코드 공백**이다.

### i18n 배포 소스 후속 폐쇄

- `src/app/admin/jobs/page.tsx`에서 새로 추출된 12개 source pair를 ja/zh/es/ar
  카탈로그에 추가했다.
- 현재 배포 소스의 추출 결과는 2,711 source / 2,711 translated, missing 0, invalid 0,
  legacy debt 0이며 공식 카탈로그·커버리지 회귀와 영수증 fail-closed 테스트가 통과했다.
- `0210c8f9...`에 패키징된 release receipt는 여전히 2,699 pair를 보고하므로 해당
  스테이징 release-health 판정은 바꾸지 않았다. 다음 검증 배포에서 새 build/head에
  결속된 자동화 영수증을 만들고, 별도의 사람 기반 visual/RTL/email/PDF/export 6언어
  검토 영수증까지 있어야 i18n을 `QUALIFIED`로 올릴 수 있다.

commercial worker readiness도 같은 배포에 fail-closed로 강화했다. 이제 외부 health의
단순 HTTP 200은 거부하며, 등록된 worker identity가 24시간 안에 claim consumer,
immutable input readback, native execution, artifact upload, signed callback을 모두 PASS한
self-test receipt를 보고해야 commercial readiness가 통과한다. staging은 non-commercial
mode이므로 이 경계의 runtime 실행 상태는 의도대로 `skipped`; 실제 worker를 배포한 뒤
상용 mode 사전 검증에서만 `ok`가 될 수 있다.

### AI Design 및 Precision CAD의 정확한 상용 수준

- AI Design V10의 chat-first, 동기화된 2D/3D, preview/apply, revision-bound
  Precision 요청은 실제 통합 화면과 서버 경로에 연결됐다. 그러나 권한은
  `CONCEPT`/`DESIGN_CANDIDATE`이며 외부 exact/manufacturing 권위가 아니다.
- Precision CAD의 GP10 30/30은 열거된 bounded mechanical handler 범위다. 실제 OCCT
  STEP bundle과 bridge가 동작하지만 arbitrary CAD, stable topology edit survival,
  full XCAF/GD&T/PMI, 독립 native CAD exchange 또는 manufacturing qualification을
  의미하지 않는다.
- 따라서 두 시스템 모두 **강한 bounded engineering implementation**이지만 아직
  **전체 제품의 상용 자격을 획득하지 않았다**.

### 남은 출시 순서

1. commercial worker job에 immutable input artifact locator와 readback digest를
   추가하고 실제 worker claim/execution/signed callback client를 배포한다.
2. 서로 다른 실제 키 보유자가 관리하는 server 3-role, worker, external verifier
   Ed25519 registry와 transport를 구성하고 negative/replay/rotation을 검증한다.
3. 실제 SMTP, Sentry alert/on-call, 한 결제 provider와 webhook rehearsal을 연결한다.
4. 로컬에서 닫힌 i18n 2,711/2,711을 다음 build-bound 자동화 영수증에 결속하고,
   독립 6언어 visual/RTL/email/PDF/export 검토를 닫는다.
5. 동일 release binding으로 7일 운영·비용·경보·restart/lease/dead-letter·rollback
   영수증을 수집한다.
6. 독립 STEP/native CAD 교환, topology campaign, 분야 전문가, 실제 가공·조립·현장
   pilot과 권리·법무 승인을 결속한다.
7. 이 모든 항목이 통과한 뒤에만 commercial mode와 production release를 별도 승인한다.

production 배포·변수·데이터, 원격 push/merge, provider credential, Git history는
이번 staging 작업에서 변경하지 않았다.

## 2026-08-25 commercial Precision worker v3 소스 폐쇄

이 절은 위에서 P0 코드 공백으로 기록한 commercial worker v2 판정을 소스 수준에서
대체한다. 공용 v3 계약·migration 기반은 `8673bd45`, Precision 구현은 `18a243c6`,
통합 결속은 merge commit `414363a9`다. 판정은
**`SOURCE_CLOSED_LOOP_PASS / EXTERNAL_RUNTIME_NOT_RUN / RELEASE_HOLD`**다.

닫힌 소스 경계:

- commercial 실행은 v3 계약과 migration `2026082502`를 사용한다. 요청 시 canonical
  tool arguments와 job binding을 하나의 private content-addressed input object로 쓰고,
  authoritative SHA-256 readback 뒤 approval/journal/claim/outbox와 같은 PostgreSQL
  transaction에 exact identity를 기록한다.
- registered worker claim은 입력 DB row와 object-store hash를 재확인한 뒤에만 HTTPS
  input locator, artifact gateway, lease capability와 HMAC-bound transport를 반환한다.
- artifact gateway는 lease owner/capability/expiry를 검증하고 `model`, `report`,
  `verification` 세 역할만 fixed identity로 immutable upload 및 hash commit한다.
- callback은 PASS 영수증의 세 출력과 실제 committed row가 모두 일치하기 전에는
  `COMMITTED_OUTPUTS_REQUIRED`로 거부한다.
- `scripts/drawing-to-3d/commercial-precision-worker.mjs`가 claim 소비, canonical input
  검증, shell 없는 configured native process 실행, STEP/report 검사, 세 출력 commit,
  Ed25519 receipt 및 callback HMAC을 수행한다. self-test 전 health는 `NOT_READY`다.
- TypeScript와 architecture가 PASS했고, 관련 Precision/contract/route/worker 회귀는
  34 files / 216 tests PASS했다. 별도 native-process fixture에서 세 출력과 Ed25519
  서명도 검증했다.

닫히지 않은 운영·외부 경계:

- 실제 production-class native CAD adapter와 worker service는 아직 배포하지 않았다.
  실제 private key/registry/self-test receipt도 없으며 fixture를 운영 증거로 승격하지
  않는다.
- 기존 staging 배포 `0210c8f9...`와 migration `2026082501`은 이 v3 소스보다 오래됐다.
  새 통합 HEAD의 staging migration, build, deploy, canary 전까지 runtime 판정은
  `NOT_RUN`이다.
- 배포 절차와 secret 분리는
  `docs/operations/commercial-precision-worker-v3.md`를 따른다.

따라서 남은 출시 순서의 첫 항목은 "locator/client 구현"에서 다음으로 좁혀진다.

1. 새 통합 HEAD와 migration `2026082502`를 비상용 staging에 배포·검증한다.
2. 실제 native adapter와 별도 키 보유자가 관리하는 isolated worker를 배포하고 fresh
   canary, negative/replay/rotation, crash/restart/lease recovery를 통과한다.
3. server 3-role과 external verifier, SMTP/Sentry/payment, i18n human review, 7일 운영,
   독립 CAD/전문가/파일럿/법무 증거를 닫는다.
4. 모든 증거가 같은 release binding으로 통과한 뒤에만 commercial mode와 production을
   별도 승인한다.

## 2026-08-25 commercial worker v3 staging 배포 결속

이 절은 위의 v3 소스 폐쇄에서 `NOT_RUN`으로 남겨 둔 core staging migration/build/deploy를
후속 증거로 닫는다. 현재 판정은
**`CORE_STAGING_DEPLOYED / WORKER_RUNTIME_NOT_RUN / RELEASE_HOLD`**다.

### 배포 및 데이터 증거

- 배포 source/build/git은 `674c54f59ec908891962591314366afe0c8eea30`이다.
- Railway staging web deployment는
  `e9286b9d-7d9b-4f45-8404-e4ec838fdbd2`, 상태 `SUCCESS`다. 현재 runtime metadata image
  digest는 `sha256:64f2f0f1ee84bc2dd42e6e16993c4b9f12be3ac1b90f455b084799094fd94569`이고,
  두 deployment instance가 `RUNNING`이며 서비스 연결 volume은 0개다.
- staging PostgreSQL에 migration `2026082502`를 checksum
  `69c830cb4fa11fb7637f325098d0c0b1a920caeba9802fbbe4a8658f00055f30`으로
  적용했다.
- staging은 `NEXYFAB_COMMERCIAL_MODE=0`, release channel `staging-hold`를 유지한다.
  `NEXYFAB_BUILD_ID`와 `RELEASE_GIT_HEAD`는 배포 source와 exact-match한다.

### 공개 런타임 재검증

- `/api/health/live/`: HTTP 200 `ok`, build ID exact-match.
- `/api/health/ready/`: HTTP 200 `ok`, PostgreSQL `ok`, Redis `ok`, commercial boundary
  `skipped`/not required.
- `/api/health/release/`: HTTP 503 `HOLD`; build/deployment/git가 새 release에 결속되고
  migration version `2026082502`와 migration evidence `PASS`를 보고한다. runtime,
  i18n 및 7-day evidence는 `HOLD`, external verifier registry role은 0이다.
- forged `jobId`/`artifactId`와 lease 없는 v3 artifact gateway 요청은 HTTP 403
  `LEASE_CAPABILITY_INVALID`로 거부됐다.

### 변경하지 않은 경계와 다음 차단

- production에는 변수, migration, 데이터, 배포를 쓰지 않았다. 읽기 확인 시 기존
  2026-08-21 deployment `cf509f59-dfc8-49cb-8e19-09ddcf3cd5e8`가 유지됐고 v3 build,
  migration, worker health/key, external verifier registry 구성은 없었다.
- 실제 production-class native adapter, 격리 worker service, 실제 private signing key,
  public registry, fresh canary/self-test receipt는 생성하거나 배포하지 않았다. 따라서 core
  staging 배포를 worker runtime PASS 또는 commercial CAD qualification으로 승격하지 않는다.
- 다음 실행은 `docs/operations/commercial-precision-worker-v3.md`의 순서대로 실제 adapter와
  별도 키 보유 worker를 배포하고 canary, 위변조/replay/rotation,
  crash/restart/lease recovery를 닫는 것이다. 그 뒤 server 3-role/external verifier,
  provider, i18n 사람 검토, 7일 운영, 독립 CAD/전문가/pilot/법무 증거를 같은 release에
  결속해야 한다.
