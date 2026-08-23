# NEXYCAD 정밀 CAD 구현 상태 — 2026-08-13

## 1. 현재 판정

Freeze v4의 전문 CAD 정보구조를 기준으로 작업공간 UI만 복제한 것이 아니라, 건축·토목·조경·인테리어·통합 조정의 의미 모델 편집, 불변 revision 명령, 프로젝트 초안 저장, 조정 이슈, 서버 소유 exact revision binding, 정확 충돌 Job과 lease/receipt 제어면까지 연결했다.

기본 통합 모델의 `concept_bounds`는 여전히 `PREVIEW`이지만, 별도 immutable artifact 경로에는 hash 검증 input/output gateway, 실제 OCCT exact executor, Cloudflare Queue/Workflow/Container 계약과 IFC/STEP 상호운용 영수증이 구현됐다. 로컬 계산 PASS를 생산 배포나 construction/manufacturing release PASS로 해석하지 않는다. 실제 Cloudflare/Railway parity, 별도 구현 계열의 STEP C4 영수증, DWG/RVT worker와 운영 증거가 없으므로 전체 AEC·기계 정밀 CAD 상용 완료 판정은 **BLOCK/HOLD**다. vendor CAD 연결은 기본 출시 조건이 아니라 제품별 선택 profile이다.

## 2. 구현 범위

| 범위 | 상태 | 실제 동작과 경계 |
|---|---|---|
| 정밀 CAD 허브 | IMPLEMENTED | 기계 작업공간과 분리된 건축·토목·조경·인테리어·통합 조정 진입점과 fidelity 표시 |
| 공간 CAD 명령 | IMPLEMENTED | 도메인·revision·명령 payload 검증, stale/cross-domain 거부, 성공 시 revision 증가와 모든 검증 무효화 |
| 프로젝트 초안 | IMPLEMENTED | 인증·tenant·편집 권한·domain별 optimistic revision을 적용한 의미 모델 저장/복원 |
| 건축 authoring | IMPLEMENTED / PREVIEW | 층·벽·슬래브·문·창 의미 모델과 2D/3D 파생 화면. protected topology 실사용은 인증 필요 |
| 토목 authoring | IMPLEMENTED / PREVIEW | 명시 EPSG, 개념 TIN·선형·종단·횡단·코리더·배수 모델. 승인 측량/TIN·수리 조건은 `NOT_RUN` |
| 조경 authoring | IMPLEMENTED / PREVIEW | 부지·보행로·식재·토심·개념 경사 모델. 승인 지형·수종 공급원·관수 수리는 `NOT_RUN` |
| 인테리어 authoring | IMPLEMENTED / PREVIEW | 방·벽·문·가구·카운터와 피난 graph. 법정 입력이 없으면 governed check를 `NOT_RUN`으로 유지 |
| 통합 조정 | IMPLEMENTED / PREVIEW | 모델 브라우저, 좌표/offset, federated plan, 경계상자 간섭 후보, 이슈 생성·상태 변경·stale 추적 |
| 조정 이슈 저장 | IMPLEMENTED | viewer read, editor mutation, tenant 격리, `updatedAt` 충돌 검출. exact 증거 없이 이슈를 exact로 승격하지 않음 |
| exact project revision 선택 | IMPLEMENTED | integrity가 확인된 동일 프로젝트 CAD revision metadata만 목록화하고 discipline별 명시 선택·초안 복원 지원 |
| 정확 충돌 Job 입력/큐 | IMPLEMENTED | EPSG와 중복되지 않은 exact revision을 요구하고 서버 저장 envelope/content/shape hash를 재검증. enqueue 시 실행·출시는 `NOT_RUN` |
| Job worker 제어면 | IMPLEMENTED / NOT_CONFIGURED | 전용 secret, worker/kernel identity registry, lease·heartbeat·만료 재claim·5회 제한·CAS 완료/실패, 모든 pair를 묶은 non-stub OCCT receipt 계약 |
| 정확 충돌 커널 executor | IMPLEMENTED_LOCAL / DEPLOY_NOT_RUN | immutable byte/hash 재검증, 실제 OCCT common volume과 STEP 정규화, timeout/cancel/retry receipt를 로컬 검증. 운영 identity/secret과 Cloudflare 배포는 `NOT_RUN` |
| AI → canonical patch | IMPLEMENTED_LOCAL | revision-bound Intent·Locks·Candidate·Diff·Evidence, Preview→명시 Apply→단일 Undo와 stale/`NOT_RUN` 전파를 로컬 unit/browser로 검증 |
| IFC/STEP federation과 왕복 | IMPLEMENTED_LOCAL / EXTERNAL_NOT_RUN | 단일 STEP OCCT 왕복, XCAF byte 보존, IFC hash-bound IR과 별도 순수 TypeScript AP242 C4 16/16 및 NexyFab 커널 2회 재개방을 로컬 검증. 커널 반환의 occurrence 기하·배치는 `PASS_LOCAL`이지만 이름·품번·occurrence label 보존은 `FAIL_LOCAL`; 외부 CAD 재개방·서명은 `NOT_RUN` |
| RVT/DWG federation과 왕복 | BLOCKED / NOT_RUN | 현재 host에 AutoCAD/Revit 및 승인 exchanger/worker가 없어 지원으로 승격하지 않음 |
| 상용 release | BLOCKED | 로컬 exact 30개는 완료했지만 외부 STEP C4 서명, 인증 프로젝트 E2E, 운영 secret/Redis/DB, GD&T/PMI 승인, 외부 검토·제작 증거가 필요 |

## 3. 정확 충돌 Job의 실패 폐쇄 계약

`Prepare exact B-Rep clash job`은 다음 조건을 모두 만족할 때만 요청을 만들 수 있다.

1. 승인되거나 사용자가 명시한 공통 좌표계가 연결돼야 한다.
2. 모델 수는 2~100이어야 한다.
3. 모든 모델이 `exact_brep`이어야 한다.
4. 모든 모델에 artifact id, SHA-256 content hash, SHA-256 shape identity hash가 있어야 한다.
5. artifact id는 같은 프로젝트의 무결한 exact CAD revision이어야 하며 두 모델이 같은 revision을 중복 사용할 수 없다.
6. tolerance와 offset이 유한하고 허용 범위 안이어야 한다.

큐 이후 실행 완료는 모든 모델 pair 수와 일치하는 non-stub OCCT receipt, 요청 hash, 승인 worker/kernel identity, receipt hash가 모두 맞을 때만 `execution=PASS`가 된다. 이 결과만으로 construction/manufacturing release를 승인하지 않으며 `releaseVerification`은 `NOT_RUN`이다.

현재 브라우저 기본 문서에서 확인된 결과는 다음과 같다.

- `JOB BLOCKED`
- `coordinate_system_not_connected`
- architecture/interior/mep 각각 `exact_brep_required`, `exact_artifact_required`, `exact_content_hash_required`, `exact_shape_identity_required`
- `EXECUTION NOT_RUN`
- `RELEASE NOT_RUN`

## 4. 검증 기록

| 검사 | 결과 | 관측 |
|---|---|---|
| Chrome DevTools MCP 연결 | PASS | 로컬 3100 coordination 작업공간 접근·클릭·접근성 snapshot·console 확인 |
| 정확 Job 브라우저 차단 | PASS | 개념 모델에서 위 blocker 전부 표시, 임의 enqueue 없음, console error/warn/issue 0 |
| worker API 로컬 fail-closed | PASS(조정 후) | 첫 `/jobs` POST는 trailing-slash 308 뒤 로컬 HTTPS 오류로 FAIL; 정식 `/jobs/` 호출은 `503 WORKER_NOT_CONFIGURED`, reload 후 console error/warn/issue 0 |
| 정밀 CAD 회귀 | PASS(재실행) | 최종 명시 범위 26파일, 127/127. 첫 sandbox 실행은 `spawn EPERM`으로 FAIL했고 승인 환경에서 동일 범위를 재실행 |
| Job SQLite lifecycle | PASS(조정 후) | 첫 fixture는 epoch 불일치를 실제 validation이 거부해 FAIL; Job 생성 시각 기준으로 조정 후 revision binding→queue→lease→heartbeat→receipt→PASS와 release `NOT_RUN` 확인 |
| TypeScript | PASS | 최신 독립 검사 33.5초 exit 0 및 생산 빌드 TypeScript 단계 완료 |
| 생산 빌드 | PASS | 최종 463.7초, compile 3.7분, TypeScript 2.2분, static 290/290, spatial project API와 `/api/internal/spatial-cad/jobs` 포함 |
| 번들 예산 | PASS | shared 723.1/781.3 KB, worst first-paint 1584.1/1660.2 KB |
| Vite 설정 미래 호환 | PASS | `vitest.config.mts`와 `import.meta.dirname`으로 전환 후 동일 Vitest 실행에서 native config 경고 0 |
| Edge Runtime | WARNING | Next.js Edge Runtime 폐기 예정 경고가 남음 |
| 다중 인스턴스 rate limit | BLOCKED | `REDIS_URL` 미설정으로 in-memory limiter 사용 |
| exact worker 운영 설정 | PARTIAL_LOCAL / NOT_RUN | 전용 auth·identity·receipt와 executor는 로컬 구현·검증했으나 실제 Cloudflare secret/resource/deploy와 Railway parity는 미실행 |
| standalone 운영 기동 | BLOCKED | `.env.local`에 필수 JWT/admin/site URL과 durable DB 운영 값이 없어 임의 secret을 만들지 않음 |
| 인증된 실제 프로젝트 E2E | NOT_RUN | API 단위 권한/tenant 회귀는 PASS지만 실제 사용자·조직·프로젝트 브라우저 왕복은 미실행 |
| Figma MCP identity | PASS | 연결은 확인했으나 계정 좌석은 View |
| Figma editable-file E2E | NOT_RUN | 편집 가능한 대상 파일/좌석이 없어 read/write 검증 미실행 |

생산 사이트는 이번 구현에서 수정하거나 배포하지 않았다. 모든 구현과 검증은 로컬 저장소 기준이다.

## 5. 다음 구현 순서

1. Cloudflare staging에 Worker·Queues·Workflows·R2·네 Container를 실제 배포하고 승인 identity/secret을 설정한다.
2. Railway 최소 staging에 Core API·PostgreSQL·Native fallback만 구성하고 동일 immutable corpus parity를 실행한다.
3. 로그인된 실제 조직/프로젝트에서 초안·AI Apply·Job·충돌 결과·tenant 격리 E2E를 실행한다.
4. PostgreSQL·R2·dead-letter queue·collaboration snapshot의 실제 복구 훈련과 서비스별 rollback을 수행한다.
5. vendor 연결 없이 별도 구현 계열 STEP 파서/작성기로 동일 AP242 조립체를 재개방·재출력하고 수치·hash·서명 영수증을 만든다. DWG/RVT는 worker가 생기기 전까지 `NOT_RUN`으로 유지한다.
6. Cron→Redis job transport→일반 CAD worker→IFC/STEP·OCCT→Studio Web origin 순으로 Railway workload를 canary 퇴역한다.
7. 30일 비용·성능·오류·복구 영수증을 연속 수집하고 fail-closed runtime gate를 재실행한다.
8. 독립 검토·제작 pilot을 완료한 뒤에만 상용 release gate를 다시 판정한다.

## 6. 주요 구현 위치

- 공간 명령: `src/lib/cad/spatialCadCommand.ts`
- 통합 조정 모델: `src/lib/cad/coordinationSpatialModel.ts`
- 프로젝트 초안/이슈/Job 저장: `src/lib/cad/spatialCadDraftStore.ts`, `spatialCadIssueStore.ts`, `spatialCadJobStore.ts`
- 프로젝트 API: `src/app/api/nexyfab/projects/[id]/spatial-cad/`
- exact revision 목록: `src/app/api/nexyfab/projects/[id]/cad-revisions/route.ts`
- 내부 worker API: `src/app/api/internal/spatial-cad/jobs/route.ts`
- 정밀 CAD UI: `src/app/[lang]/shape-generator/_shell/spatial/`
- 스키마: `src/lib/db.ts`, `src/lib/db-postgres-migrations.sql`, `src/lib/db-adapter.ts`

## 7. 상용 정밀 CAD 연속 구현 갱신 — 2026-08-13 23시 KST

이번 갱신은 기존 배포 사이트를 수정하지 않은 로컬 구현·검증 결과다.

| 범위 | 현재 상태 | 판정 경계 |
|---|---|---|
| 초보자 AI → Expert CAD UX | IMPLEMENTED_LOCAL | 요구사항을 `AUTHORITATIVE/ASSUMED/MISSING/CONFLICT`로 분류하고, 미확정 대안·stale revision은 Apply 전에 차단한다. 화면 전환만으로 검증을 승격하지 않는다. |
| 150개 입력 qualification | PASS_LOCAL / EXECUTION_NOT_RUN | 5범주×30피처의 기대 판정 150/150 일치. 실제 AI model·전체 geometry·verification 실행은 각 150건 `NOT_RUN`이다. |
| 대표 chat→exact CAD | PASS_LOCAL | 첫 상용 10피처 대표 intent에서 revision/input hash와 100×60×8mm 및 혼합단위 6.35mm를 exact bbox·edit·NFAB에 결속, 70/70축 PASS. 실제 AI model과 외부 campaign은 `NOT_RUN`. |
| 30피처 구현 등록 | WIRED 30/30 | 등록·candidate test는 실행축 PASS 근거가 아니다. |
| 실제 로컬 7축 폐쇄루프 | LOCAL_CANDIDATE | 30/30피처, `PASS 210 / FAIL 0 / NOT_RUN 0`. create·edit·regenerate·save/reopen·undo·STEP export/reimport·3면 HLR을 실제 product OCCT 경로와 byte/hash 증거로 검증했다. variableShell exact는 axis-aligned bbox-faithful box로 제한되며 일반 형상은 fail-closed다. |
| Assembly→Drawing 영속 handoff | PASS_LOCAL / COMMERCIAL_HOLD | tenant/project/revision/content-hash CAS, immutable bytes/SHA, 8MiB, 7일 expiry, editor POST/viewer GET, SQLite route E2E와 bounded prune가 PASS. 운영 scheduler·production cookie·PostgreSQL 동시성은 `NOT_RUN`. |
| Drawing/BOM/제조 package | PASS_LOCAL_BOUNDED / BLOCKED | revision-bound single-part FeatureTree를 서버에서 OCCT 재생성해 exact STEP·3면 HLR·overall bbox 치수·qty-1 BOM을 hash/byte 교차결합했다. GD&T/PMI·human approval은 `NOT_RUN`, 제조 release는 `BLOCKED`. |
| 독립 STEP AP242 C4 | PASS_LOCAL_BOUNDED / SEMANTIC_FAIL_LOCAL / COMMERCIAL_NOT_RUN | 별도 순수 TypeScript Part 21 parser/writer가 AP242 protocol, occurrence별 RRWT→IDT, 부품별 치수·배치·이름을 검사하고 16/16 PASS했다. NexyFab OCCT의 2-solid, 57,600mm³, bbox 100×60×20mm, 3면 HLR 및 occurrence별 치수·배치는 `PASS_LOCAL`이지만 이름·품번·label은 커널 자동값으로 바뀌어 `FAIL_LOCAL`. 외부 CAD 서명·일반 곡면 B-Rep은 `NOT_RUN`. |
| Cloudflare-first 구조 | PASS_LOCAL | architecture 검사: service 11, data store 5, API group 69, domain 6, contract package 4, issue 0. |
| Cloudflare/Railway 운영 | HOLD / NOT_RUN | live evidence가 없어 배포·인증 E2E·parity·복구·rollback·30일 관찰 10항목 전부 `NOT_RUN`. |

현재 기계 피처 receipt SHA-256은 `79d9344b7d101580b7e1574759a8eff652cbe942e6a389056b488aba28a77930`이며, design revision은 `3cf6a0f9c8efcf153a2cfefde087a2112c086fc412d2feeaeb9ce52542838564`다. 300개 evidence 파일의 SHA-256/byte 길이 불일치는 0이고 STEP/NFAB/3-view SVG는 각각 30개다. single-part STEP→HLR→BOM candidate receipt SHA-256은 `9349cfccfa50847d1b44d55db543913741daa543c3407a92fde15f8eb5e2f10c`, PASS 30/NOT_RUN 0이지만 치수·GD&T·PMI·사람 승인이 `NOT_RUN`이라 제조 release는 0/BLOCKED다. 대표 intent runtime receipt는 최종 revision에 재결합되어 SHA-256 `7997eaa01687d429c99c002a769afa0f36c9b0b5462fc7357bd339c28f3089fc`, 10건×7축 PASS이며 AI model·외부 campaign은 `NOT_RUN`이다. 최신 Assembly handoff receipt SHA-256은 `1ec46707ef0fffa7403c9eb436951a5bb6367f9b69de9fca5c344940442cab68`이며 로컬 PASS/전체 HOLD다.

새 실행 명령은 다음처럼 의미를 분리한다.

```text
npm run mechanical:features:local:check   # 저장된 evidence를 독립 재검산
npm run mechanical:features:local:gate    # 현재 30×7 complete local candidate PASS
npm run mechanical:intents:local:check    # intake qualification만 검증
npm run assembly-handoff:readiness:check  # 로컬 영속 경로 PASS, 운영은 HOLD
```

## 8. 2026-08-14 프로덕션 번들·브라우저 조정 결과

- 고정 번들 예산은 수정하지 않았다. 제조 readiness 판정을 Three.js/STL/ZIP writer와 분리하고, AI/Expert switch 및 Assembly shell/handoff를 동적 로딩 경계로 이동했다.
- 최종 initial JS는 shape-generator `7,165 B / 8,000 B`, Assembly `4,105 B / 20,000 B`, Drawing `301,366 B / 320,000 B`다. Drawing은 조정 전 `688.0 KB`에서 `294.3 KB`로 줄었다.
- 최종 `npm run build` 재실행은 487.3초에 Next.js compile, TypeScript, 정적 페이지 `291/291`, standalone postbuild와 고정 bundle budget을 모두 PASS했다. shared 723.2KB/781.3KB, worst first-paint 1,584.2KB/1,660.2KB다. `REDIS_URL` 미설정 경고는 운영 다중 인스턴스 rate limit 증거가 없다는 뜻이므로 면제하지 않는다.
- Chrome DevTools에서 기계 Expert CAD의 리본/Feature Tree/3D viewport/Inspector/status rail을 확인했고 Guided AI ↔ Expert CAD 양방향 전환도 PASS했다. 전환으로 검증 상태는 자동 승격되지 않았다.
- guided 요구확정→Preview→Apply→Undo의 revision race를 수정했다. 최종 production standalone Chromium에서 `AUTHORITATIVE`→`LOCAL DETERMINISTIC/AI MODEL NOT_RUN`→Preview→keyboard Apply→revision `CREATED`→keyboard Undo→`RESTORED`→Expert 전환을 39초에 PASS했고, AI model request 0, axe serious/critical 0, page/console error 0이었다.
- 실제 Assembly 샘플을 Drawing으로 넘기는 중 `expert=1` 누락으로 홈으로 리다이렉트되는 결함을 발견해 수정했다. 재검증에서는 Drawing이 handoff revision을 읽고 Solver/STEP/Drawing/BOM verification/GD&T를 `NOT_RUN`, 제조 package를 `BLOCKED`로 유지했으며 STEP+PMI export도 비활성화됐다.
- Drawing Lighthouse 첫 snapshot은 접근성 `92`였고 작은 회색 텍스트 대비 4곳과 13×13px PDF radio 2곳이 실패했다. 대비색과 24×24px target으로 조정한 최종 production snapshot은 Accessibility/Best Practices/SEO/Agentic Browsing 모두 `100`, 34개 감사 PASS, 실패 0이다.
- 기계 화면 콘솔은 기능 오류 없이 Three 생태계 내부 `THREE.Clock` 폐기 예정 경고 1건이 있었고, Drawing 화면 콘솔은 오류·경고 0건이었다.
- Figma MCP identity는 PASS지만 좌석은 `View`이므로 editable-file E2E는 계속 `NOT_RUN`이다.
- 플랫폼 architecture inventory는 새 handoff prune route를 포함해 service 11, data store 5, API group 69, cron group 23, domain 6, contract package 4, issue 0으로 PASS했다. production scheduler 관찰은 manifest의 `NOT_RUN` gap으로 유지한다.
- 최종 commercial release gate는 license/kernel/API controls까지 PASS하더라도 external commercial feature receipt `0/30`, 상용 `nexyfab`/독립 parser C4 receipt, 제조 pilot이 없어 `mechanical:contracts:check`에서 exit 1이다. 전체 상용 상태는 `HOLD`이며 이 실패를 로컬 30피처 PASS로 대체하지 않는다.
- runtime placement gate도 Cloudflare/Railway staging, 인증 project E2E, parity, PostgreSQL/R2 복구, queue/DLQ, collaboration recovery, rollback, 30일 관찰 10항목 모두 live evidence 부재로 `NOT_RUN`/HOLD다.
- 독립 STEP C4의 로컬 공백을 더 닫았다. `scripts/standalone-step-ts-adapter.mjs`는 OCCT/replicad를 호출하지 않는 별도 Part 21 parser/writer이며, flat/nested stitcher의 PRODUCT_DEFINITION·root/child representation·PDS→CDSR→RRWT→IDT chain과 양방향 동치 변환을 cross-bind한다. 독립 후보 receipt SHA-256은 `bca27f4ffa3498d5fafaed5d9303241c7262319304c06fbff28399b169754532`, NexyFab 커널 open→export→reopen receipt는 `a3420955b722fb0ff2f3b68fb4f5f307c62c3ad436e6c4232245a8776f231e54`다. 추가 kernel-structure receipt `54f9c79663b2e966e5497a70b2b18e96c4c11965e6f651ab898be08ae004ed32`는 occurrence 기하·변환을 `PASS_LOCAL`, 이름·품번·label을 `FAIL_LOCAL`, 전체를 `HOLD`로 판정한다. 외부 CAD 재개방·operator 서명·일반 곡면 B-Rep은 `NOT_RUN`이다.
