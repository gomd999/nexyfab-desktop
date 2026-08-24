# 통합 작업 기준 및 CI·릴리스 인계

- 작성 시각: 2026-08-24 (KST)
- 최종 갱신: 2026-08-24 (로컬 V10 통합 완료 기준)
- 기준 작업 디렉터리: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
- 통합 작업 브랜치: `integration/nexyfab`
- PR 작업 브랜치: `fix/integration-ci-portability`
- PR: <https://github.com/gomd999/nexyfab-desktop/pull/79>
- 구현 HEAD: `dd32f4db` (`[P1] feat(ai-design): render V10 chat workspace`)
- CI 실행: <https://github.com/gomd999/nexyfab-desktop/actions/runs/32697624503>

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
