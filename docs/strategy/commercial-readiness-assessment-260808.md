# NexyFab 상용 준비도 평가 및 실행 계획 — 2026-08-08

실측 기준: `npm run commercial:preflight`(blocker 2)·`npm run commercial:release-gate`(blocker 18)·`npm run browser:preflight`(Chromium만 PASS), 그리고 260808 세션의 클린 빌드 2회·standalone E2E 9/9·소크 4회 실측.

범례: **👤 = 사용자 계정/결제/하드웨어 권한 필요(에이전트 대행 불가)** · 🤖 = 에이전트가 로컬/코드로 수행 가능 · 👤+🤖 = 사용자가 자격증명/환경을 만들면 에이전트가 이어서 검증

---

## 1. 단계별 판정

| 단계 | 판정 | 근거 |
|---|---|---|
| 내부 테스트 | ✅ 가능 | 빌드 재현성·Chromium Q8 그린 |
| 제한된 클로즈드 베타 | ✅ 가능 | 게이트·lineage 안전망 동작 실증 |
| 무료 공개 베타 | ⏸ 외부 staging 게이트 후 | preflight blocker: DATABASE_URL 등 |
| 실제 결제 포함 유료 서비스 | ⛔ 차단 | release gate 18 blocker (fail-closed 정상 작동) |
| 기업 고객 생산 주문 | ⛔ 비권장 | 복구·결제 리허설·법무·분야 승인 전 |

한 줄 요약: **코드·품질게이트·재현성은 상용 수준 근접. 운영 인프라·독립 검증이 전무해 "돈을 받는 순간"의 리스크를 아직 소화할 수 없음.**

## 2. 충족된 것 (실측 근거)

- **빌드 재현성**: 클린 격리 빌드 연속 성공(260807 3회 485~546s + 260808 2회), 628페이지, 번들 691.6KB/예산 763.3KB, **경고 0**(Sentry/Prisma·nodeOcctLoader 경고 제거 완료). Next 16 proxy 컨벤션 전환 완료.
- **핵심 여정**: Chromium 프로덕션 standalone에서 Q8(Box→캔버스→DFM→RFQ→자동저장)·undo/redo·locale·S/M/L/XL 계측 전부 통과.
- **보안 게이트 실동작**: 관리자 API 428 step-up · 전문가 게이트 307 · x-admin-secret 통과 후 라우트 재검증 — Node 런타임(proxy)에서 curl 재실증.
- **제조 안전망**: manufacturing lineage v78 — 서버측 소유·승인·SHA-256 대조, 409 fail-closed, G9 승인 없이는 상거래 연결 불가. 상용 관점에서 가장 견고한 부분.
- **품질게이트 자체의 품질**: 260808에 T-정션 오검출·brep watertight 오적용·단일바디 과잉강제 3건 근본수정 → 골든·카나리아·refpart 그린. Sentry 서버 오류 삼킴 회귀도 수정(그 전까지 서버 오류 수집이 사실상 불능이었음).
- **장시간 안정성 1차 증거**: OCCT 커널 소크 4회 반복 17/17, RSS 누수 없음(-62.4MB). 주간 CI 게이트 신설.

## 3. 차단 요소 (release gate 18 blocker → 5묶음)

1. **인프라 부재**: PostgreSQL(현 SQLite)·Redis·S3/R2·SMTP·Sentry DSN·CRON_SECRET·Server Action 암호화 키
2. **결제**: provider API+webhook 완결 조합 0개, Toss는 테스트 키
3. **운영 책임**: ONCALL/SUPPORT/ROLLBACK 담당자 미지정, 복구훈련·결제 리허설 기록 0회
4. **법무**: 정책 승인 기록 없음
5. **정확도 증거**: 5개 분야 승인 evidence 없음 — **"95% 정확도"는 독립 holdout·전문가 blind review 전까지 공개 주장 금지**

브라우저 커버리지는 Chromium 단일(Firefox/WebKit 로컬 미설치, CI matrix는 260808 정적 결함 수정으로 실행 가능해졌으나 미완주). GPU 실기기 S/M/L/XL 예산 인증 미실행.

## 4. 정직한 리스크

- 과거 "통과" 보고는 표적 묶음 기준이었음이 260808에 두 번 확인됨(related 전체 13건 실패, CI 정적 결함 3건). 남은 영역에도 같은 유형의 미검증 구간이 있다고 가정할 것 — 특히 **결제·환불·webhook 경로는 sandbox end-to-end 리허설 0회**.
- SQLite 단일 인스턴스는 수평 확장 불가, 백업의 실제 복원 가능성 미증명(복구훈련 0회).

---

## 5. 실행 계획 (우선순위 순)

### Phase 0 — 지금 즉시, 외부 자격증명 없이 (🤖 + 일부 👤)

| # | 작업 | 담당 | 비고 |
|---|---|---|---|
| 0-1 | 21커밋 push (`git push`) | 👤 승인 → 🤖 실행 | 원격 백업·CI 트리거의 전제. 브랜치는 260807에 최초 push됨 |
| 0-2 | GitHub Actions에서 ci.yml 완주 확인(특히 신설 migration-restore·domain-accuracy 잡) | 🤖 (push 후) | 260808 수정된 createdb·npm ci 플래그의 실전 검증 |
| 0-3 | Firefox/WebKit 로컬 설치 재시도(`npx playwright install firefox webkit` — 외부 캐시 lock으로 이전 실패) 또는 CI matrix로 대체 | 🤖 | 실패해도 CI matrix가 대체 경로 |
| 0-4 | Commercial CAD browser matrix workflow_dispatch 1회 완주 | 🤖 (push 후) | 4브라우저 × OCCT 스위트 최초 완주 기록 |
| 0-5 | occt-kernel-soak workflow 1회 dispatch(15회 반복) | 🤖 (push 후) | 로컬 4회보다 강한 증거 |

### Phase 1 — staging 인프라 개설 (전부 👤 — 계정/결제 권한 필수)

`docs/operations/owner-action-checklist.md`에 상세 명령 있음. **실제 비밀값은 저장소/MD에 쓰지 말고 배포 secret에만.**

| # | 작업 | 담당 |
|---|---|---|
| 1-1 | 👤 staging PostgreSQL 생성(Railway/Neon 등) + `DATABASE_URL` 등록 | 👤 |
| 1-2 | 👤 Redis 생성(Upstash 등) + `REDIS_URL` | 👤 |
| 1-3 | 👤 비공개 S3/R2 버킷 + access key 4종 | 👤 |
| 1-4 | 👤 SMTP 또는 Resend 자격증명 | 👤 |
| 1-5 | 👤 Sentry 프로젝트 + `SENTRY_DSN`(+클라 `NEXT_PUBLIC_SENTRY_DSN`) | 👤 |
| 1-6 | 👤 `CRON_SECRET`·`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 생성·등록 | 👤 |
| 1-7 | 👤 결제 sandbox(Toss live 전환 전 단계) + webhook secret 등록 | 👤 |

### Phase 2 — staging 게이트 완주 (👤+🤖: 자격증명 받으면 에이전트가 실행·검증)

| # | 작업 | 담당 | 명령 |
|---|---|---|---|
| 2-1 | 마이그레이션 적용·상태 확인 | 🤖 | `npm run migrate -- up` ×2(멱등)· `-- status` |
| 2-2 | commercial preflight PASS 확인 | 🤖 | `npm run commercial:preflight` |
| 2-3 | **실제 복구훈련**: 최신 백업→`_restore_drill` DB 복원 | 👤+🤖 | `BACKUP_FILE`·`RESTORE_DATABASE_URL` 지정 → `npm run backup:verify-restore` → 성공 시 👤 `LAST_RESTORE_DRILL_AT` 기록 |
| 2-4 | staging rollback 리허설(10분 이내) | 👤+🤖 | `ROLLBACK_BASE_URL`·`EXPECTED_BUILD_ID` → `npm run rollback:verify` |
| 2-5 | 결제·환불 sandbox end-to-end 리허설(**현재 0회 — 최대 미검증 구간**) | 👤+🤖 | 성공 시 👤 `LAST_PAYMENT_REHEARSAL_AT` 기록 |
| 2-6 | staging 전체 여정 E2E(가입→생성→RFQ→견적→주문) | 🤖 | Playwright, staging URL 대상 |

### Phase 3 — 성능·브라우저 인증 (👤 하드웨어 + 🤖)

| # | 작업 | 담당 |
|---|---|---|
| 3-1 | 👤 실제 GPU 3등급 장비에서 `PW_ENFORCE_GPU_BUDGET=1` S/M/L/XL 실행·기준선 저장 | 👤(장비)+🤖(실행) |
| 3-2 | L/XL 예산 초과 시 LOD→instancing→컬링 순 최적화 | 🤖 |
| 3-3 | 브라우저 matrix(Chromium/Firefox/WebKit/mobile) 릴리스 경로 상시화 | 🤖 |

### Phase 4 — 정확도 독립 검증 (👤 외부 인력 필수)

| # | 작업 | 담당 |
|---|---|---|
| 4-1 | 👤 5개 분야 holdout 세트에 대한 **전문가 blind review 섭외·수행**(승인 0/88이 병목) | 👤 |
| 4-2 | 캠페인 실행·리포트·promote (`test:accuracy:*`·`accuracy:domain-report`·review packet 도구) | 🤖 |
| 4-3 | 👤 승인 evidence를 `DOMAIN_ACCURACY_EVIDENCE_DIR`에 배치 → certification workflow PASS | 👤+🤖 |
| 4-4 | 그 전까지 마케팅/랜딩에 95% 수치 노출 금지 유지 | 🤖(감시) |

### Phase 5 — 상용 선언 (👤 의사결정)

| # | 작업 | 담당 |
|---|---|---|
| 5-1 | 👤 ONCALL/SUPPORT/ROLLBACK 담당자 지정(env 기록) | 👤 |
| 5-2 | 👤 법무 정책(약관·환불·개인정보·CAD 보존) 승인 + `LEGAL_POLICY_APPROVED_AT` | 👤 |
| 5-3 | 👤 결제 live 키 전환 + `NEXYFAB_COMMERCIAL_MODE=1` | 👤 |
| 5-4 | `npm run commercial:release-gate` **PASS** = 유료 공개 가능 판정 | 🤖 |
| 5-5 | canary 배포 + SLO 관찰 후 전면 오픈 | 👤+🤖 |

## 6. 요약: 사용자만 할 수 있는 것 (👤 전체 목록)

1. **push 승인**(0-1) — 이후 CI 완주는 에이전트 몫
2. **외부 계정 개설·결제**: PostgreSQL·Redis·S3/R2·SMTP/Resend·Sentry (1-1~1-5)
3. **비밀키 발급·배포 secret 등록**: CRON_SECRET·Server Action 키·결제 API/webhook (1-6~1-7)
4. **리허설 완료 선언 기록**: LAST_RESTORE_DRILL_AT·LAST_PAYMENT_REHEARSAL_AT (2-3·2-5)
5. **GPU 실기기 제공** (3-1)
6. **분야 전문가 blind review 섭외** (4-1) — 95% 주장의 유일한 열쇠
7. **담당자 지정·법무 승인·live 키·COMMERCIAL_MODE=1** (5-1~5-3)

Phase 1의 ①DATABASE_URL ②Redis ③S3 세 개만 등록돼도 preflight가 열리고 무료 공개 베타 게이트가 시작된다.
