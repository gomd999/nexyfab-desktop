# NexyFab 운영자 수행 체크리스트

이 문서는 로컬 코드로 대신할 수 없고 서비스 소유자 권한, 외부 계정, 실제 결제수단 또는 실장비가 필요한 작업만 정리한다.

주의:

- 실제 비밀키를 Git, 이 문서, 이슈, 채팅 또는 스크린샷에 기록하지 않는다.
- 값은 Railway/배포 플랫폼의 staging·production 환경 변수 저장소에 각각 입력한다.
- staging과 production은 DB, Redis, S3 prefix/bucket, 결제키를 공유하지 않는다.
- 모든 날짜 증거는 ISO 8601 UTC 형식으로 기록한다. 예: `2026-08-08T03:00:00Z`.

## 1. 담당자 지정

- [ ] `ONCALL_OWNER`: 장애 대응 책임자 이름과 연락 방법 지정
- [ ] `SUPPORT_OWNER`: 고객 문의 책임자 지정
- [ ] `ROLLBACK_OWNER`: 배포 복구 승인·실행 책임자 지정
- [ ] 장애 채널과 결제 긴급 연락 경로 생성

완료 후 배포 환경에 담당자 이름을 넣고 연락처 원본은 사내 비공개 운영 문서에 보관한다.

## 2. Staging 인프라 생성

### PostgreSQL

- [ ] staging 전용 PostgreSQL DB 생성
- [ ] SSL 필수 연결 문자열 발급
- [ ] production과 다른 사용자·비밀번호 확인
- [ ] 자동 백업과 보존기간 설정
- [ ] `DATABASE_URL` 등록

검증:

```powershell
npm run migrate -- up
npm run migrate -- status
npm run commercial:preflight
```

### Redis

- [ ] staging 전용 Redis 생성
- [ ] TLS 연결 URL 발급
- [ ] max memory와 eviction 정책 확인
- [ ] `REDIS_URL` 등록
- [ ] 애플리케이션 인스턴스 2개에서 rate limit 공유 확인

### CAD 객체 저장소

- [ ] 비공개 S3/R2 bucket 생성
- [ ] staging 전용 access key 생성
- [ ] bucket versioning 또는 보존 정책 설정
- [ ] CORS 허용 origin을 staging 도메인으로 제한
- [ ] 공개 listing 차단
- [ ] `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` 등록

### 이메일·관측·Cron

- [ ] SMTP 또는 Resend 계정과 발신 도메인 인증
- [ ] `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` 등록
- [ ] Sentry 프로젝트 생성 및 `SENTRY_DSN` 등록
- [ ] 32자 이상의 `CRON_SECRET` 생성
- [ ] 안정적인 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 생성 후 모든 인스턴스에 동일하게 등록

## 3. 결제 sandbox 리허설

Toss, Stripe, Airwallex, Dodo 중 최소 한 공급자를 완전하게 설정한다.

- [ ] sandbox API 키 등록
- [ ] webhook 서명키 등록
- [ ] staging webhook URL 등록
- [ ] 정상 결제
- [ ] 결제 실패
- [ ] 동일 webhook 중복 전송
- [ ] 순서가 뒤바뀐 webhook
- [ ] 전액 환불
- [ ] 결제 성공 후 주문 처리 재시도
- [ ] 중복 과금·중복 주문이 없음을 관리자 타임라인에서 확인

완료 후:

```text
LAST_PAYMENT_REHEARSAL_AT=<완료 시각 ISO UTC>
```

결제 공급자 reference, 테스트 주문 ID, 환불 ID를 비공개 증거 저장소에 보관한다.

## 4. 실제 백업 복구훈련

- [ ] 최신 staging PostgreSQL 백업 생성
- [ ] 이름에 `_restore_drill`이 포함된 별도 빈 DB 생성
- [ ] 로컬에 `psql` 설치 확인
- [ ] 아래 명령 실행

```powershell
$env:BACKUP_FILE='C:\secure\backups\latest.sql.gz'
$env:RESTORE_DATABASE_URL='postgresql://.../nexyfab_restore_drill'
npm run backup:verify-restore
```

- [ ] 출력된 table count와 backup bytes 저장
- [ ] RFQ·quote·order·`nf_manufacturing_lineage` 표본 참조 확인
- [ ] 복원 시작/종료 시각과 RTO 기록
- [ ] 훈련 DB 폐기

완료 후:

```text
LAST_RESTORE_DRILL_AT=<완료 시각 ISO UTC>
```

절대로 production DB를 restore target으로 사용하지 않는다. 스크립트도 `_restore_drill`이 없는 DB를 거부한다.

## 5. Rollback 리허설

- [ ] 현재 정상 commit SHA와 deployment ID 기록
- [ ] 후보 버전 staging 배포
- [ ] 이전 성공 deployment로 rollback
- [ ] 10분 이내 복구 여부 기록
- [ ] `/api/health/live`, `/api/health/ready`, `/api/occt/diagnostic` 확인
- [ ] 로그인 → CAD → DFM → RFQ → 자동저장 확인
- [ ] rollback 후 기존 주문과 CAD 파일 다운로드 확인

자동 health/build/OCCT 확인:

```powershell
$env:ROLLBACK_BASE_URL='https://staging.example.com'
$env:EXPECTED_BUILD_ID='<rollback 대상 commit/build ID>'
npm run rollback:verify
```

DB schema는 파괴적 down migration 대신 호환 migration과 forward-fix를 기본으로 한다.

## 6. Firefox·WebKit CI

로컬 Playwright 다운로드는 외부 캐시 lock으로 완료되지 않았다. GitHub Actions의 `Commercial CAD browser matrix`를 수동 실행한다.

- [ ] chromium 통과
- [ ] firefox 통과
- [ ] webkit 통과
- [ ] mobile-chrome 통과
- [ ] 실패 시 업로드된 Playwright report 보관

CI는 브라우저 설치 후 `npm run browser:preflight -- <browser>`로 실행 파일을 먼저 확인한다.

## 7. 실제 GPU 성능 인증

소프트웨어 렌더러가 아닌 실제 GPU가 있는 Windows 장비에서 실행한다.

```powershell
$env:PW_ENFORCE_GPU_BUDGET='1'
npx playwright test e2e/viewport-performance.spec.ts --project=chromium --workers=1
```

- [ ] 저사양 내장 GPU 결과
- [ ] 일반 업무용 PC 결과
- [ ] 권장 외장 GPU 결과
- [ ] GPU/드라이버/브라우저/화면 해상도 기록
- [ ] S/M/L/XL JSON 증거 보관

## 8. 분야별 정확도 승인

기계·토목·건축·조경·인테리어 각 분야에서 개발에 사용하지 않은 holdout과 전문가 검토자가 필요하다.

- [ ] 분야별 holdout 100건 이상 준비
- [ ] S/M/L/XL 난이도 라벨 검토
- [ ] 전문가 blind review 수행
- [ ] 자동 수치 결과와 전문가 판정 병합
- [ ] 실패 유형과 적용 제외 범위 기록
- [ ] 승인된 evidence directory를 배포 환경의 `DOMAIN_ACCURACY_EVIDENCE_DIR`로 지정

독립 검증이 끝나기 전에는 “복잡 제품 95% 정확도”를 공개 보장하지 않는다.

## 9. 법무·정책 승인

법률 전문가에게 다음 정책을 실제 서비스 흐름과 대조 검토받는다.

- [ ] 이용약관
- [ ] 개인정보처리방침
- [ ] 환불·취소 정책
- [ ] 설계 오류·DFM 조언·제조물 책임 범위
- [ ] CAD 소유권, 처리 라이선스, 보존·삭제
- [ ] 기업 고객 NDA와 하위처리자 조건

완료 후:

```text
LEGAL_POLICY_APPROVED_AT=<승인 시각 ISO UTC>
```

## 10. 최종 상용 게이트

모든 값을 staging에 등록한 뒤 실행한다.

```powershell
$env:NEXYFAB_COMMERCIAL_MODE='1'
npm run commercial:preflight
npm run commercial:release-gate
```

두 명령이 모두 PASS하고 결제·복구·브라우저·GPU 증거가 보관되기 전에는 유료 공개 서비스를 활성화하지 않는다.

## 현재 코드에서 완료된 항목

- [x] 운영 빌드 3회 연속 10분 이내 성공
- [x] 번들 예산 통과
- [x] Chromium CAD Q8 통과
- [x] S/M/L/XL geometry 계측 파이프라인 통과
- [x] PostgreSQL migration/restore CI 정의
- [x] 복구 대상 DB 안전장치
- [x] 상용 환경·운영 증거 fail-closed 게이트
- [x] Firefox/WebKit CI matrix와 브라우저 실행 파일 preflight
- [x] 제조 artifact lineage와 승인 게이트
