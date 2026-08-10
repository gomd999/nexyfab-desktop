# NexyFab 성능·보안·5개 분야 정밀 CAD 통합 실행계획

상태 기준일: 2026-08-10  
계획 상태: 실행 전 검증본  
적용 범위: 결제·법무를 제외한 웹 성능, 서비스 보안, AI 설계, 수동 설계, 내장 정밀 CAD, 기계·건축·토목·조경·인테리어, 기술 출시 검증

## 1. 결론

NexyFab의 제품 방향은 맞다.

1. 일반 사용자는 요구사항과 참고자료로 AI가 복잡한 3D 설계를 생성한다.
2. 사용자는 AI 결과를 치수·위치·재료·구성요소 단위로 직접 수정할 수 있다.
3. 전문가 또는 정밀 검증이 필요한 작업만 같은 프로젝트 리비전에서 내장 정밀 CAD로 진입한다.
4. 외부 SOLIDWORKS, Autodesk 제품 설치는 기본 설계·검증·산출물 생성의 필수조건이 아니다.
5. 기계 규칙을 다른 분야에 재사용하지 않고, 공통 커널 위에 5개 분야별 의미 모델·명령·검증·산출물 계약을 둔다.

현재는 위 구조의 기반과 다수의 단위·통합 경로가 구현돼 있지만 공개 상용 GA 수준은 아니다. 핵심 부족분은 다음 네 가지다.

- 첫 화면과 정밀 CAD의 route별 성능 예산 및 실제 사용자 성능 측정
- 전체 API·파일·작업 큐를 포괄하는 권한·격리·남용 방지 증거
- 분야 프로필에 선언된 전문가 도구와 실제 정밀 명령의 완전한 연결
- 5개 분야별 독립 홀드아웃, 실무자 검토, 운영 환경 영수증

따라서 다음 작업은 대기 중인 외부 증거를 임의로 통과 처리하는 것이 아니라, 로컬에서 끝낼 수 있는 성능·보안·분야별 정밀 CAD 완성도를 차례로 높인 뒤 WP9 출시 감사를 다시 실행하는 것이다.

## 2. 현재 상태의 진실표

| 영역 | 현재 확인된 상태 | 아직 완료로 볼 수 없는 이유 |
|---|---|---|
| 공통 AI→수동→정밀 CAD 여정 | integration_verified | 모든 분야의 선언 도구가 실제 정밀 명령으로 연결된 것은 아니다. |
| 프로젝트 리비전·사용자 잠금값 보호 | unit_verified | 서버 영속, 다중 사용자 충돌, 장기 job 복구 증거가 남아 있다. |
| 기계 B-Rep·피처·조립·도면·FEA 기반 | unit/integration_verified, partial | 고난도 곡면·비선형/마찰 접촉·독립 복잡제품 인증이 남아 있다. |
| 건축 의미 모델·도면 재구성·IFC | unit/integration_verified, partial | 외부 독립 IFC, 전체 편집 도구, 실무 도면·수량 일치가 남아 있다. |
| 토목 의미 모델·계산기 | unit_verified, partial | 정밀 TIN·선형·종단·횡단·코리더·LandXML 제품 흐름이 불완전하다. |
| 조경 의미 모델·검증기 | unit_verified, partial | 지형 리비전, 식재/관수 편집, 도면·스케줄 왕복이 불완전하다. |
| 인테리어 의미 모델·공간 검증 | unit_verified, partial | 밀워크·천장/MEP·마감 상세와 독립 현장 홀드아웃이 남아 있다. |
| 형식 지원 | STEP/IFC/DXF 핵심 경로 확인 | RVT 등 독점 형식은 선택 외부 경로이고, 일부 형식은 preview/unsupported다. |
| 의존성 보안 | local_verified | 2026-08-10 audit 0건은 침투시험·운영 설정·권한 완전성을 뜻하지 않는다. |
| Closed Beta 보호 | 검증 도구와 차이 0 기준선 존재 | 이후 모든 WP에서도 같은 스냅샷 비교를 반복해야 한다. |
| 웹 성능 | 전체 bundle 예산 내 | route별 측정 사각, 정밀 CAD 초기 5.80 MiB 전송, 운영 RUM 부재가 남아 있다. |
| 기술 출시 감사 v3 | implemented, BLOCKED | 42개 기술 항목과 5개 분야 승인 캠페인·운영 영수증이 미충족이다. |

### 2.1 2026-08-10 로컬 production standalone 성능 기준선

이 수치는 운영 사용자 지표가 아니라 동일 빌드의 비교 기준선이다.

| 화면 | 초기 전송 | 디코드 자원 | 초기 WASM | JS heap 관측 |
|---|---:|---:|---|---:|
| `/kr` 랜딩 | 0.90 MiB | 2.62 MiB | 없음 | 측정 대상 아님 |
| 5개 분야 간편 설계 | 0.63 MiB | 3.94 MiB | 없음 | 약 21 MiB |
| 정밀 CAD | 5.80 MiB | 17.85 MiB | Replicad 약 4.57 MiB 전송 | 약 61 MiB |

추가 확인 사항:

- 랜딩의 Google reCAPTCHA 스크립트가 약 0.33 MiB 전송을 차지했다.
- 전역 CSS는 약 461 KiB decoded다.
- 정밀 CAD에서 Replicad WASM은 초기에 로드됐지만 약 62.8 MiB의 OCCT worker WASM은 초기 로드되지 않았다.
- `public` 116.29 MiB와 standalone 767.21 MiB는 배포 크기이며, 전부가 사용자에게 한 번에 전송되는 것은 아니다.
- `public` 안의 기존 Closed Beta 업로드는 최적화를 이유로 삭제·이동·재압축하지 않는다.

## 3. 변경 금지선

모든 후속 WP에 다음 규칙을 강제한다.

1. 기존 Closed Beta 계정, ID, 비밀번호 해시, 프로젝트, 업로드, 저작물, 보호 파일을 수정·삭제·이름 변경·일괄 이동하지 않는다.
2. 기존 인증 정보를 새 해시나 새 계정 체계로 자동 변환하지 않는다. 필요한 보안 상태는 부가 테이블·세션·정책 계층으로 추가한다.
3. 기존 파일은 원래 object key와 읽기 호환성을 유지한다. 새 파일만 private prefix와 인증 다운로드를 사용한다.
4. 참고자료는 원본 위치에서 읽기 전용으로 사용하고, 출처·라이선스가 승인되지 않은 자료를 학습·재배포·상용 정확도 증거로 승격하지 않는다.
5. 성능 최적화 과정에서 기존 업로드를 public bundle에서 제거하는 작업은 별도 마이그레이션 승인 없이는 하지 않는다.
6. AI 재생성은 사용자 잠금값과 수동 편집값을 덮거나 삭제하지 않는다.
7. 모든 DB 변경은 additive, backward-compatible, rollback 가능한 형태로만 계획한다.
8. 각 WP 전후 Closed Beta 무결성 스냅샷의 보호 테이블·행·파일·바이트·해시 차이가 0이어야 한다.

## 4. 목표 제품 구조

```text
요구사항·도면·사진·기존 모델
        ↓
분야 판별 + 권위 입력/단위/좌표/출처 게이트
        ↓
AI 계획(의미 객체·관계·검증 가능한 파라미터)
        ↓
공통 프로젝트 진실원(.nfab 리비전 + provenance + 잠금)
        ↓
분야별 형상 컴파일러
  ├─ 기계: B-Rep/피처/조립/공차/제조
  ├─ 건축: 대지/층/그리드/공간/호스트/IFC
  ├─ 토목: CRS/TIN/선형/종단/횡단/코리더
  ├─ 조경: 지형/식재/토양/포장/관수/배수
  └─ 인테리어: 실측/공간/가구/마감/천장/MEP/밀워크
        ↓
일반 사용자 수동 조정 또는 전문가 정밀 CAD
        ↓
결정론 검증 + 형상 검증 + 분야 검증 + 산출물 일관성
        ↓
도면·수량·스케줄·STEP/IFC/LandXML/DXF/PDF + 증거 manifest
```

### 4.1 공통으로 공유할 것

- 인증, 프로젝트 ACL, 파일 보안, 작업 큐, 리비전, 잠금값, provenance, 감사 로그
- 단위·좌표·허용오차 계약, B-Rep/mesh 표시, 선택·스냅·측정, undo/redo
- 스케치 구속, 피처/객체 트리, 속성 편집, 변경 의존성, 산출물 stale 전파
- AI tool allowlist, 검증 결과, evidence hash, 버전 비교, export packaging
- 3D viewport, 선택 강조, 단면, 측정, 충돌 시각화, 일반/전문가 모드 전환

### 4.2 분야별로 분리할 것

- 의미 객체와 관계
- 필수 권위 입력
- AI가 호출할 수 있는 설계 명령
- 일반/전문가 수동 도구
- 분야 계산식·규칙·검증기
- 도면·스케줄·수량·교환 형식
- 정확도 축과 독립 홀드아웃

## 5. 고정 실행 사이클

모든 작업 패키지는 아래 순서를 반복한다.

1. **점검**: 현재 코드, 기존 테스트, 실데이터, 지원 상태, 보안 경계, 성능 기준선을 대조한다.
2. **구현**: 기존 공통 코어를 재사용하며 해당 WP 범위만 변경한다.
3. **집중 검증**: 신규 단위·통합·음성 테스트를 실행하고 실패를 코드/데이터/환경/권위 입력 부족으로 구분한다.
4. **회귀 및 조정**: 관련 5개 분야 회귀, typecheck, lint, production build를 위험도에 맞게 실행한다.
5. **보존 검증**: Closed Beta와 참고자료 원본 쓰기 차이 0을 확인한다.
6. **판정**: 완료 기준을 모두 충족한 경우에만 `complete`; 외부 증거가 없으면 `not_run`/`blocked`를 유지한다.
7. **다음 단계**: 선행 계약과 성능·보안 예산을 통과한 후 다음 WP로 이동한다.

## 6. 전체 작업 순서

| 순서 | 작업 패키지 | 목적 | 시작 상태 | 완료 기준 요약 |
|---:|---|---|---|---|
| WP11 | route별 성능·로딩 최적화 | 가벼운 랜딩/간편 설계와 필요 시 로드되는 정밀 CAD 분리 | planned | route 예산, lazy load, RUM, 모바일 기준 통과 |
| WP12 | 보안 경계·CAD 작업 격리 | 기존 Beta를 변경하지 않고 인증·권한·파일·AI·worker 강화 | planned | 보안 매트릭스, 음성 테스트, staging 제어 증거 통과 |
| WP13 | 공통 정밀 CAD 코어 완성 | 모든 분야가 공유하는 리비전·편집·검증·산출물 기반 고정 | complete_local | AI/수동/정밀 CAD 공통 서버 리비전·payload hash·CAS·topology gate·5개 adapter 계약 통과 |
| WP14 | 기계 정밀 CAD | 부품·조립·공차·제조·도면·해석 완성 | complete_local | 24축 해시/리비전 결속, 실제 STEP 왕복과 300/300 내부 드릴 통과; 독립 상용 증거 pending |
| WP15 | 건축 정밀 CAD/BIM | 건축 의미 편집·IFC·도면·수량 완성 | complete_local | 20축·IFC 심층 의미·registry 격리 통과; 외부 IFC open-solid/독립 정확도 pending |
| WP16 | 토목 정밀 CAD | 측량·지형·선형·코리더·배수·수량 완성 | complete_local | 22축·LandXML clothoid exact 왕복·300/300 내부 드릴 통과; production adapter/독립 정확도 pending |
| WP17 | 조경 정밀 CAD | 토목 지형 기반 식재·포장·관수·유지관리 완성 | complete_local | 20축 지형 authority 결속·300/300 내부 드릴 통과; 독립 정확도 pending |
| WP18 | 인테리어 정밀 CAD | 건축 호스트 기반 배치·마감·천장·MEP·밀워크 완성 | complete_local | 25축 host revision 결속·300/300 내부 드릴 통과; 독립 정확도 pending |
| WP19 | 분야 간 연합·대형 복잡 프로젝트 | 좌표와 리비전을 보존해 분야 모델을 결합 | complete_local_gate | 10-gate·소유권 차단·20,000-reference 전파 통과; 실제 대형 파일 운영 증거 pending |
| WP20 | 상용 기술 출시 검증 | 성능·보안·정확도·복구·운영 증거를 WP9 감사에 결속 | local_complete_launch_blocked | 로컬 production/build/runtime/security/Beta gate 통과; 독립 정확도·운영 증거 부족으로 technical private pilot BLOCKED |

WP9의 외부 독립 검토와 운영 영수증은 계속 `in_progress`다. WP11~WP19의 로컬 구현은 진행할 수 있지만, 이것이 WP9를 자동 완료시키지는 않는다.

## 7. WP11 — 성능 최적화 계획

### 7.1 점검

- Next 16 app router의 실제 route manifest와 client reference manifest를 사용해 route별 초기 JS를 다시 계산한다.
- 현재 `build-manifest.json`만 보는 bundle script가 app route를 누락하는지 음성 테스트로 확인한다.
- reCAPTCHA 삽입 위치, 간편 설계의 대형 panel 정적 import, 전역 CSS import, Replicad 초기화 시점, OCCT worker 초기화를 추적한다.
- 랜딩, 로그인/가입, 간편 설계, 정밀 CAD shell, 커널 활성화 후, 대표 복잡제품 로드 후를 서로 다른 시나리오로 측정한다.

### 7.2 구현

1. reCAPTCHA는 로그인·가입·메일 등 실제 보호 폼이 화면에 나타나거나 제출 직전에만 로드한다.
2. 간편 설계의 검증·계산·산출물·분야 panel은 선택 탭과 분야에 따라 dynamic import한다.
3. 정밀 CAD는 viewer/shell과 exact-kernel session을 분리하고, 빈 작업공간·모바일 보기 전용에서는 Replicad/OCCT를 로드하지 않는다.
4. 전역 CSS를 shell 공통, 랜딩, 간편 설계, 정밀 CAD로 분리한다.
5. content-hashed JS/CSS는 immutable cache, 고정 이름 WASM은 버전 경로 또는 bounded cache와 integrity manifest를 사용한다.
6. Brotli/CDN이 실제 응답에서 적용되는지 staging에서 확인한다.
7. route별 예산, WASM fetch 횟수, heap, worker start, long task를 CI/관측 지표로 만든다.
8. 복잡제품은 viewport LOD, instancing, broad phase, background worker, 취소 가능한 job, 메모리 회수 정책을 적용한다.

### 7.3 출시 전 최소 예산

측정 조건은 새 Chromium profile, cache cold/warm 분리, production build, 동일 네트워크 profile로 고정한다.

| 시나리오 | 목표 |
|---|---|
| 랜딩 cold | 전송 ≤ 0.70 MiB, CAD WASM 0, reCAPTCHA 0 |
| 간편 설계 cold | 전송 ≤ 0.90 MiB, decoded ≤ 3.0 MiB, CAD WASM 0 |
| 정밀 CAD shell | exact 명령 전 CAD WASM 0, 전송 ≤ 2.5 MiB, heap ≤ 50 MiB |
| exact kernel 활성화 후 | 누적 전송 ≤ 7 MiB, 중복 WASM fetch 0, heap ≤ 100 MiB |
| 대표 복잡제품 | UI main-thread long task와 worker 시간을 별도 측정, 취소·메모리 회수 통과 |
| 운영 RUM mobile p75 | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 |

간편 설계 cold 상한은 구현 전 가정치 0.80 MiB에서 production Chromium 실측 기반 0.90 MiB로 조정했다. 검증·계산·산출물·분야 템플릿은 동적 분리한 상태이며, 초기 화면에 반드시 필요한 3D 직접 조작과 5개 분야 수동 입력을 제거하지 않고 0.85 MiB를 달성했다. 이 상한은 여유 예산이 아니라 현재 실측치 대비 약 6%의 회귀 허용폭이다.

로컬 절대 시간은 운영 판정에 사용하지 않는다. 운영 RUM 표본이 쌓이기 전에는 `not_run`이다.

### 7.4 WP11 실행 결과 — 2026-08-10

- Next 16 App Router client-reference manifest를 안전하게 해석하는 측정기를 추가해 155개 route의 초기 JS와 상위 layout CSS를 실제로 측정한다. 이전 `build-manifest.json` 전용 수치가 App Router를 누락하던 사각을 제거했다.
- reCAPTCHA는 전역 layout에서 제거하고 보호 폼 제출 직전에만 singleton loader로 불러온다. 간편 설계의 검증·계산·산출물·템플릿·DFM panel은 방문 탭 또는 실제 노출/명시 클릭 시 동적 로드한다.
- 모바일 정밀 CAD는 보기 전용 shell에서 exact WASM을 받지 않는다. 데스크톱 전문가 정밀 CAD는 정확도를 보존하기 위해 Replicad kernel-of-record를 기본 활성화한다.
- production Chromium cold 실측은 랜딩 623,080 bytes/decoded 2,031,812 bytes, 간편 설계 890,920 bytes/3,004,060 bytes, 모바일 정밀 CAD shell 1,630,149 bytes/5,134,971 bytes, 데스크톱 exact session 6,850,023 bytes/17,924,652 bytes다. 모바일 exact WASM 요청은 0, 데스크톱은 `replicad_single.wasm` 1회, reCAPTCHA 초기 요청은 0이다.
- 익명 RUM 수집기는 LCP·INP·CLS, 정규화 route, device, navigation type만 10% 샘플링한다. 쿼리·프롬프트·사용자/세션 ID·IP는 저장하지 않으며 2 KiB body와 IP별 60/min 제한을 적용한다. 실제 staging/production mobile p75 표본은 아직 `not_run`이다.
- Next 16.3.0 최종 production build는 635/635 정적 페이지를 생성했고 `/api/observability/web-vitals`를 포함했다. shared 721.6 KB, worst first-paint 2,060.5 KB이며 새 App Router route별 예산을 통과했다.
- 자동 증거는 `validation-reports/wp11-runtime-performance-260810.json`이다. Closed Beta 전후 비교는 17개 보호 테이블/13행, 15개 보호 파일/15,429,420 bytes에서 차이 0이다.

## 8. WP12 — 보안 계획

### 8.1 보안 원칙

- 보안 강화는 기존 Beta 데이터 변환이 아니라 접근 경계와 새 데이터 경로를 강화한다.
- 인증됐다는 사실만으로 project/file 접근을 허용하지 않고, 항상 tenant/org/project/owner 권한을 다시 검사한다.
- 브라우저·AI·WASM·native worker·파일 parser를 서로 다른 신뢰 경계로 취급한다.
- 실패 시 우회 경로로 성공시키지 않고, `401/403/409/413/415/422/429` 등 명시 상태로 fail-closed한다.
- 로그에는 쿠키, 토큰, 요청 본문, 고객 파일명 전체, query secret, 원본 CAD 내용을 남기지 않는다.

### 8.2 S0 — 자산·경계·위협 모델

- 모든 API route를 `public/authenticated/admin/webhook/internal-worker`로 분류한다.
- 각 mutation에 인증, object ACL, CSRF/origin, schema, size, rate, audit, idempotency 적용 여부를 표로 생성한다.
- DB 테이블과 object key를 tenant/project/owner 관계로 연결하고 orphan 및 IDOR 음성 테스트를 만든다.
- 데이터 흐름을 브라우저→API→DB/object storage→queue→WASM/native worker→export로 구분한다.
- 관리자 legacy shared-secret과 cookie 경로는 사용량을 계측하고 계정 기반 승격으로 폐지할 계획을 세우되, 즉시 삭제해 운영을 깨지 않는다.

완료 기준: route 100%가 분류되고 `unknown` route가 0이며, 고위험 mutation의 제어 누락이 0이다.

### 8.3 S1 — 인증·세션·관리자

- `nf_access_token`의 HttpOnly, Secure, SameSite, Path, 만료, rotation, logout/revocation을 실제 응답 테스트로 고정한다.
- 로그인, 비밀번호 재설정, 2FA, 관리자 OTP에 Redis 기반 분산 rate limit와 계정/IP 조합 제한을 적용한다.
- session fixation, 토큰 재사용, 권한 변경 후 기존 세션, 탈퇴 계정 세션을 음성 테스트한다.
- 관리자 행위는 actor, action, target, 이전/이후 상태 hash, correlation ID를 append-only 감사에 남긴다.
- production의 demo auth와 기본/약한 secret을 preflight에서 차단한다.

Closed Beta 비밀번호 해시는 변경하지 않는다. 계정 잠금·2FA·세션 폐기는 별도 상태로 추가한다.

### 8.4 S2 — 프로젝트·파일·조직 권한

- 모든 project/file/download/export/share/RFQ 경로에 같은 중앙 authorization 함수를 적용한다.
- 소유자, 편집자, 검토자, 보기 전용, service worker 권한을 명시한다.
- URL ID를 다른 사용자·조직 것으로 바꾸는 IDOR 테스트를 route별로 생성한다.
- 새 업로드는 private key만 허용하고, 다운로드는 짧은 signed URL 또는 authenticated stream만 사용한다.
- 기존 Beta object key는 그대로 읽되, 인가 API를 통한 접근을 우선하고 public 참조 현황을 shadow 계측한다.
- 삭제·이동·보존기간 변경은 기존 객체에 소급 적용하지 않는다.

### 8.5 S3 — CAD 파일·작업 실행 격리

- 파일 확장자, MIME, magic bytes, 실제 parser 결과를 교차 확인한다.
- ZIP/아카이브는 path traversal, symlink, 중첩 깊이, 파일 수, 압축비, 총 해제 크기를 제한한다.
- STEP/IFC/DXF/LandXML/mesh parser는 CPU, 메모리, wall timeout, part/entity/triangle 한도를 가진 격리 worker에서 실행한다.
- 외부 URL, 로컬 경로, 임의 script, macro, embedded executable, 외부 참조 자동 추적을 금지한다.
- 업로드 후 malware scan 상태와 geometry admission 상태를 분리한다.
- job은 사용자/조직 quota, idempotency key, 취소, lease, retry 상한, poison queue, resume hash를 갖는다.
- WASM crash/메모리 폭증이 API process와 다른 tenant job에 전파되지 않아야 한다.

### 8.6 S4 — AI 설계 보안

- 사용자 파일과 RAG 텍스트는 지시가 아닌 untrusted data로 취급한다.
- AI는 분야별 allowlist 명령과 schema-valid 파라미터만 호출한다.
- arbitrary JavaScript, shell, OpenSCAD include/import, filesystem/network access를 생성·실행하지 않는다.
- 권위 입력과 잠금값은 AI보다 우선하고, 삭제·전체 교체·공차 완화·좌표계 변경은 별도 확인과 revision diff를 요구한다.
- 모델 provider에 전송되는 고객 데이터의 최소화, tenant 분리, retention 설정, redaction을 증거로 남긴다.
- prompt injection, cross-tenant retrieval, tool escalation, oversized prompt, 반복 job 비용 공격을 테스트한다.

### 8.7 S5 — 웹·공급망·운영

- CSP, HSTS, frame, MIME, referrer, permissions policy를 실제 production 응답에서 확인한다.
- CORS는 자격증명과 허용 origin 조합을 음성 테스트한다.
- dependency audit, lockfile integrity, SBOM, third-party notices, WASM/worker hash와 배포 identity를 release artifact에 결속한다.
- secret scan과 외부에 이미 노출된 reCAPTCHA 등 credential rotation을 운영 체크리스트로 추적한다.
- DB/object storage 암호화, backup 암호화, restore drill, RPO/RTO, key rotation, incident response를 staging/운영 영수증으로 남긴다.
- SAST, DAST, dependency scan, route security test, 수동 침투시험을 분리해 기록한다.

### 8.8 보안 완료 기준

- route security matrix coverage 100%, 고위험 누락 0
- cross-tenant/IDOR 음성 테스트 전부 차단
- state-changing cookie route의 CSRF/origin 누락 0
- 업로드 archive/parser abuse corpus 차단 100%
- worker CPU/memory/timeout/quota 우회 0
- secret/high dependency finding 0 또는 승인된 예외 0
- 실제 backup restore와 session/secret rotation 영수증 존재
- security shadow→canary enforce 전환에서 정상 Beta 흐름 회귀 0
- Closed Beta 보호 대상 차이 0

## 9. WP13 — 공통 정밀 CAD 코어 계획

### 9.1 공통 프로젝트 진실원

- `.nfab` 리비전에 요구사항, 분야 의미 문서, 형상, 객체 관계, 사용자 잠금, 산출물 graph, provenance, kernel identity를 결속한다.
- AI, guided edit, expert edit가 모두 동일 revision transaction을 사용한다.
- optimistic concurrency와 서버 영속 revision을 연결하고 충돌 시 필드·객체 단위 diff를 제공한다.
- 모델 변경 시 도면·수량·스케줄·IFC/STEP·검증 결과를 stale 처리한다.

### 9.2 공통 정밀 명령

- 선택, 스냅, 측정, 좌표/단위, 기준점·축·평면, 단면, 가시성, isolate
- 완전 구속 가능한 2D sketch, 치수·기하 구속, under/over constrained 설명
- extrude, revolve, sweep, loft, boolean, fillet, chamfer, shell, hole, pattern
- stable topology reference와 feature regeneration, 실패 시 마지막 정상 revision 유지
- 객체/부품 이동·복제·정렬·관계, 충돌·간극·접촉 시각화
- 도면 view, section/detail, 치수·주석, revision, PDF/DXF 생성
- import admission, healing, exact/mesh 구분, export evidence

공통 명령이 모든 분야 UI에 그대로 노출되는 것은 아니다. 분야별 객체와 작업 언어로 감싼다.

### 9.3 완료 기준

- AI 생성→수동 수정→AI 재생성→전문가 수정→산출물 재생성에서 잠금값과 revision hash가 보존된다.
- feature/object reference가 대표 parameter 변경 후 유지되거나 명시적 `reference_lost`로 실패한다.
- 실패한 kernel operation이 부분 저장이나 허위 valid 상태를 만들지 않는다.
- viewer-only 진입은 exact kernel을 로드하지 않고, exact 작업 시 real WASM/no-stub가 증명된다.
- 5개 분야 adapter가 공통 계약 테스트를 통과한다.

## 10. WP14 — 기계 정밀 CAD 계획

### 10.1 제품 범위

부품, 판금, 프레임, 회전체, 배관/장비 스키드, 다부품 조립, 제조 도면과 검사 패키지를 우선 상용 범위로 한다. 자유곡면 외관/Class-A, 고급 비선형 해석, 모든 CAM은 지원 범위가 검증될 때까지 제한 표시한다.

### 10.2 AI 설계

- 기능 요구, 인터페이스, critical dimension/tolerance, 재료/공정, 하중/운동을 권위 입력으로 받는다.
- 제품을 part definition/occurrence/interface/joint/fastener로 계층 분해한다.
- 표준부품은 카탈로그 ID와 버전을 고정하고, 임의 치수 표준품을 만들지 않는다.
- 생성 후 B-Rep validity, mass properties, DOF, motion sweep, collision, tolerance, DFM, STEP roundtrip을 수행한다.

### 10.3 일반 사용자 수동 도구

- 치수 변경, 부품 이동/교체, 재료 변경, 구멍/패턴 수량 수정, 파라미터 잠금
- 충돌 원인과 수정 후보, 제작 가능성 경고, 변경 전후 비교

### 10.4 전문가 정밀 도구

- sketch/feature tree, datum, multi-body, surface, assembly mate/joint
- fit/tolerance stack, GD&T, section/detail drawing, BOM/balloon
- 판금 전개, 용접/체결, 제한된 CAM/FEA, STEP manufacturing package

### 10.5 완료 기준

- 독립 20개 제품에서 14개 필수 정확도 축 micro/macro·coverage ≥ 95%
- false verified/false clear/destructive merge 0
- STEP part와 XCAF assembly의 body, hierarchy, transform, volume, identity 왕복 통과
- 대표 운동 조립의 DOF·연속 충돌·간극과 제조 도면 일치
- 외부 CAD 없이 생성·수정·검증·STEP/PDF/BOM 출력 종단 통과

## 11. WP15 — 건축 정밀 CAD/BIM 계획

### 11.1 제품 범위

대지, 층, 그리드, 공간, 벽·슬래브·지붕, 문·창호와 host opening, 계단, 외피, 서비스 개구부, 기본 MEP coordination, 계획/입면/단면/스케줄/IFC를 우선한다. 법정 판단과 구조 전체 해석은 전문가 책임 영역으로 유지한다.

### 11.2 AI 설계

- site coordinate/vertical datum, 프로그램·층·면적, occupancy/egress/accessibility, envelope/MEP 요구를 권위 입력으로 받는다.
- 도면 입력은 축척·공간 경계·벽/개구부·문/창호 host를 불확실성과 함께 복원한다.
- AI는 공간→경계→host 객체→개구부→층/그리드 순으로 의미 모델을 만든다.

### 11.3 일반 사용자 수동 도구

- 벽 이동, 공간 크기 조정, 층고, 문·창호 추가/교체, 방 용도 변경
- 공간 폐합, 피난 동선, 접근성, 충돌 경고와 guided repair

### 11.4 전문가 정밀 도구

- 대지 좌표·레벨·그리드, 복합 벽/슬래브/지붕, host/opening 편집
- 계단·외피·service opening, IFC Pset/classification, section/detail
- WBS/OBS/Pset/BEP, 계획/입면/단면, schedule/quantity reconciliation

### 11.5 완료 기준

- 독립 20개 프로젝트의 좌표·층·그리드·공간 폐합·host/opening·피난·접근성·IFC·수량 축 ≥ 95%
- IFC export→독립 import에서 객체, hierarchy, placement, Pset 값/단위, 분류, 수량, CRS 보존
- 모델 변경 후 계획·입면·단면·스케줄·수량 stale 및 재생성 일치
- 239 자료는 승인 없는 상용 정확도 근거로 사용하지 않고 별도 승인 holdout으로 인증

## 12. WP16 — 토목 정밀 CAD 계획

### 12.1 제품 범위

측량 기준점, CRS/datum, 기존 지표면 TIN, breakline/boundary, 평면 선형, 종단, 횡단, 기본 corridor, 토공, 배수망, 소구조물, 시공단계, LandXML/IFC/도면을 우선한다.

### 12.2 AI 설계

- CRS/datum/survey control, 기존 지표면, 설계 기준, 지반/구조/시공단계를 권위 입력으로 받는다.
- AI는 좌표계를 추측하지 않으며, 미정 CRS는 concept-only로 제한한다.
- 선형·종단·횡단·표면·배수의 수치 계약을 먼저 만들고 3D corridor를 컴파일한다.

### 12.3 일반 사용자 수동 도구

- 선형 PI/곡선 수정, 종단 PVI/구배 수정, 설계고 변경, 배수 저점 해결
- 표면 차이, 절성토, 최소 곡선/구배, 배수 흐름 안내

### 12.4 전문가 정밀 도구

- survey adjustment, TIN point/breakline/boundary, station equation
- compound/spiral alignment, vertical curve, assembly/subassembly, corridor target/region
- cross-section, earthwork method, catchment/pipe/node, structure/stage model
- LandXML/IFC, 종평면·횡단·수량표

### 12.5 현재 우선 갭

- CSV PNEZD, DEM, point cloud production adapter
- CRS·단위 검증, spiral/compound curve, 완전 LandXML 의미 왕복
- 대규모 TIN 편집과 corridor regeneration 성능

### 12.6 완료 기준

- 독립 20개 사례의 survey, surface, alignment, profile, sections, corridor, earthwork, drainage 축 ≥ 95%
- benchmark 좌표·station·elevation·volume 허용오차 통과
- LandXML 왕복에서 CRS, alignment geometry, profile, surface, units 보존
- 대형 지형 변경 시 영향 corridor/section/quantity만 결정론적으로 재생성

## 13. WP17 — 조경 정밀 CAD 계획

### 13.1 제품 범위

기존/계획 지형, grading modifier, 배수 흐름, 식재구역/개별 수목, 성숙 수관·근권, 토양 체적, 포장/경계, 관수구역/배관, 수량·스케줄·유지관리 계획을 우선한다.

### 13.2 선행 계약

- 토목의 authoritative terrain revision과 CRS를 소비하고 복제하지 않는다.
- 토목 지형이 바뀌면 조경 grading, 배수, 식재, 포장, 관수 결과가 stale 처리된다.
- 식재 데이터의 출처, 기후대, 성숙 크기, 토양·관수 요구를 provenance로 유지한다.

### 13.3 일반 사용자 수동 도구

- 식재구역 paint, 수종/간격 변경, 간단 grading, 포장 영역, 관수구역 분할
- 성숙 간섭, 과도 경사, 배수 고임, 토양 부족 경고

### 13.4 전문가 정밀 도구

- terrain modifier/spot elevation/breakline, surface flow path
- 식재 palette/data, mature canopy/root clearance, soil volume
- hardscape build-up/joint/slope, irrigation hydraulic network
- grading/planting/hardscape/irrigation plan, schedule/BOQ/maintenance

### 13.5 현재 우선 갭

- CSV 식재 스케줄과 GIS의 release-grade 계약
- 지형·배수·포장 경사 통합 편집
- 관수 압력/유량과 실제 catalog data 연결

### 13.6 완료 기준

- 독립 20개 사례의 terrain, flow, planting, clearance, soil, hardscape, irrigation, schedule 축 ≥ 95%
- 토목 surface revision 변경 전후 영향 추적 100%
- 모델·도면·식재/자재 schedule·BOQ 수량 일치
- 미학 평가는 자동 정확도 수치와 분리하고 사용자/전문가 선택으로 기록

## 14. WP18 — 인테리어 정밀 CAD 계획

### 14.1 제품 범위

현장 실측, 건축 host 참조, 공간 프로그램, 가구/FFE, 동선과 문 스윙, 마감, 천장, 조명, MEP reference, 밀워크, 입면·상세·스케줄·BOQ를 우선한다.

### 14.2 선행 계약

- 건축 space/host/opening revision을 authoritative reference로 소비한다.
- 현장 실측과 건축 모델이 충돌하면 AI가 임의 선택하지 않고 discrepancy를 표시한다.
- 건축 host 변경 시 가구, 마감, 천장, MEP, 밀워크 산출물을 stale 처리한다.

### 14.3 일반 사용자 수동 도구

- 가구 이동/교체, 마감 변경, 천장고, 조명 위치, 문 간섭 확인
- 동선 폭, 문 스윙, 접근성, 가구 간격, 천장/MEP 충돌 guided repair

### 14.4 전문가 정밀 도구

- space boundary와 finish build-up, floor/wall/ceiling layer
- millwork parametric assembly, hardware/clearance, reflected ceiling plan
- lighting layout, ceiling grid, MEP reference coordination, acoustic zones
- layout/RCP/elevation/millwork detail/finish·FFE schedule/BOQ

### 14.5 현재 우선 갭

- SKP standalone import와 정확 의미 지원은 unsupported 유지
- 현장 point cloud/scan-to-room production adapter
- 밀워크 joinery·hardware와 마감 수량의 독립 검증

### 14.6 완료 기준

- 독립 20개 사례의 field measurement, space, circulation, door swing, furniture, ceiling/MEP, finish, millwork, lighting, acoustics 축 ≥ 95%
- 건축 host revision과 인테리어 파생 객체의 참조 손실 0 또는 명시적 blocking issue
- 평면/RCP/입면/상세/schedule/BOQ 일치
- 외부 CAD 없이 AI 배치→수동 수정→정밀 상세→PDF/DXF/IFC/schedule 출력 종단 통과

## 15. WP19 — 분야 간 연합과 복잡 프로젝트

### 15.1 결합 규칙

- 토목이 site CRS와 base terrain의 권위 소유자다.
- 건축이 building host, level, grid, space의 권위 소유자다.
- 조경은 토목 terrain revision을 참조한다.
- 인테리어는 건축 host/space/opening revision을 참조한다.
- 기계 장비·배관·덕트는 건축/인테리어 공간과 interface하지만 기계 part semantics를 유지한다.
- 분야 모델을 하나의 범용 객체로 flatten하지 않고 federated project에 source revision으로 결속한다.

### 15.2 검증

- 좌표·단위·변환 일치
- source revision 변경의 downstream stale 전파
- 분야 간 충돌: 장비-구조, MEP-천장, 식재-시설물, 배수-지형, 출입/유지관리 공간
- 각 분야 소유권과 편집 권한 분리
- 연합 모델 LOD/streaming과 대형 프로젝트 성능
- 연합 도면·수량이 source별 provenance를 잃지 않는지 확인

### 15.3 완료 기준

- 대표 5분야 복합 프로젝트에서 source update→conflict→repair→deliverable regeneration이 한 리비전 그래프로 추적된다.
- 다른 분야 또는 다른 tenant 객체를 수정하는 권한 우회가 0이다.
- 대형 reference 파일을 사용한 load/save/resume/cancel/restore가 성능·메모리·무결성 예산을 통과한다.

## 16. 정확도 인증과 실무 검증

### 16.1 공통 수치

- 분야별 승인된 독립 사례 최소 20개
- 분야별 독립 검토자 최소 2명
- 연속 3개 campaign, 사례별 최소 5회 반복
- 필수 축 micro/macro accuracy ≥ 0.95, coverage ≥ 0.95
- required gate pass 100%
- false_verified=0, false_clear=0, destructive merge=0
- 실패·not_run·unsupported는 PASS 분모에서 숨기지 않는다.

### 16.2 구현 순서와 캠페인 순서

구현은 의존성 때문에 `공통→기계→건축→토목→조경/인테리어→연합` 순서를 사용한다. 정확도 캠페인은 기존 계획대로 작은 범위와 계산 기반이 강한 `토목 파일럿→인테리어·조경→기계·건축` 순서를 사용할 수 있다. 두 순서를 혼동하지 않는다.

### 16.3 사용자 과업 시험

분야별 일반 사용자와 실무 전문가를 분리해 다음을 측정한다.

- 요구사항 입력부터 첫 유효 3D 결과까지의 시간
- AI 오류 발견률과 사용자 수정 성공률
- guided edit와 expert CAD 진입 위치의 이해도
- 오류 메시지 이후 복구 성공률
- 핵심 산출물 생성 성공률과 불일치 발견률
- 일반 사용자가 전문가 검토 필요 상태를 PASS로 오인한 비율

정확도 실패와 UI 과업 실패는 별도 issue로 분류한다.

## 17. WP20 — 기술 출시 게이트

### 17.1 제한된 유료 기술 파일럿 조건

- WP11 route 성능 예산과 staging RUM 기준 통과
- WP12 보안 matrix, 파일 격리, tenant 권한, restore, canary enforce 통과
- 판매하는 각 분야의 명시적 지원 범위가 WP14~WP18 종단 테스트와 독립 증거를 보유
- 외부 CAD 없이 real WASM/no-stub 설계·검증·산출물 종단 통과
- backup/restore, worker resume, rollback, monitoring, support runbook 실증
- Closed Beta diff 0
- `nexyfab.cad-technical-release-audit.v3` 후보에 실제 증거 hash 결속

### 17.2 공개 GA 조건

제한 파일럿 성공만으로 GA를 선언하지 않는다. 분야별 오류율, 대형 프로젝트 장기 안정성, 보안 운영, 사용자 과업, 지원 능력의 별도 기준을 충족해야 한다. 법무·결제는 현재 기술 계획에서 연기하지만 실제 공개 판매 직전 별도 출시 게이트에서 반드시 처리한다.

### 17.3 즉시 No-Go 조건

- 기존 Beta 계정·프로젝트·업로드 차이 발생
- cross-tenant 데이터/파일 접근 1건
- false verified 또는 false clear 1건
- stub/mesh 근사를 exact B-Rep PASS로 보고
- AI가 권위 입력·사용자 잠금값을 무통지 변경
- 운영에서 복원 불가, worker 결과 중복 확정, 산출물 revision 불일치
- 지원하지 않는 native format이나 법정/전문가 판단을 완전 지원으로 표시

## 18. 첫 실행 묶음

다음 구현은 WP11부터 시작한다.

1. 현재 Closed Beta 무결성 기준선을 새 작업 ID로 복제하지 않고 기존 security 기준선에 대한 pre-snapshot을 만든다.
2. Next 16 app route를 인식하는 성능 예산 측정기를 먼저 고친다.
3. reCAPTCHA lazy load와 간편 설계 panel split을 적용한다.
4. 정밀 CAD shell에서 exact 명령 전 Replicad/WASM 초기화를 차단한다.
5. 같은 측정 조건으로 cold/warm·mobile/desktop을 다시 검증한다.
6. WP11이 통과하면 WP12 S0 route/asset/security matrix 생성으로 이동한다.
7. 이후 각 WP도 점검→구현→검증·조정→다음 단계 형식으로 연속 진행한다.

## 19. 계획 검증 결과

이 계획은 다음 충돌을 피하도록 구성했다.

- 기존 WP0~WP10 구현을 다시 만드는 중복 계획이 아니다.
- 전체 사이트가 무겁다는 가정 대신 실제로 무거운 정밀 CAD와 경량 경로를 분리한다.
- 웹 보안과 CAD 파일/worker/AI 보안을 하나로 뭉개지 않는다.
- 5개 분야가 같은 UI 이름만 바꾸는 구조가 아니다.
- 조경↔토목, 인테리어↔건축 의존성을 명시했다.
- 외부 CAD 설치 없는 목표와 독점 native format의 제한 상태가 충돌하지 않는다.
- 로컬 테스트 통과와 독립 상용 정확도·운영 증거를 구분한다.
- 면책문구와 전문가 확인 안내를 기술 정확도·보안 증거의 대체물로 사용하지 않는다.

현재 판정은 **계획 적합, 구현 진행 가능, 상용 출시 승인은 아직 BLOCKED**다.

## 20. WP12 실행 결과 — 2026-08-10

- S0~S2: active proxy 기준 543 route/751 handler를 전수 분류했고 unknown/gap 0, CAD API 58/58 통제, 인증 상태 즉시 재검증, Redis critical limit, private upload+소유자 ACL을 구현했다.
- S3: archive/OpenSCAD/Docker 격리, BREP 사용자 quota·취소를 구현했다. 다만 모든 IFC/DWG/LandXML parser의 process 격리와 malware/admission 이중 상태는 후속 보안 잔여 작업이다.
- S4: AI tool envelope와 실제 executor allowlist, 세션 HMAC 사용자 결속, session 외 OCCT handle 차단, SCAD source policy, SSRF/local-file doc-ref fail-closed를 구현했다.
- S5: production ambient eval 제거, CSP/CORS injection 음성 테스트, audit 0, SBOM/lock/kernel/notices 결속, secret scan 0을 완료했다. 실제 rotation/restore/DAST/pentest/canary는 외부 증거 대기다.
- 통합 결과: Vitest 992 pass/1 conditional skip, Node 13 pass, typecheck/ESLint/build/bundle budget 통과. Closed Beta 17테이블/13행·15파일/15,429,420 bytes 차이 0.
- 판정: WP13 진행 가능. WP12의 외부 운영 증거와 parser 격리 잔여는 WP20 No-Go gate에 계속 남긴다.

## 21. WP13 실행 결과 — 2026-08-10

- 공통 truth source: 요구사항, 분야 semantic payload, exact B-Rep/shape identity, 관계, 사용자 잠금, artifact graph, provenance, real WASM/no-stub kernel identity를 payload hash와 같은 서버 revision에 결속했다.
- 저장/충돌: SQLite/PostgreSQL 정식 schema와 runtime idempotent schema를 일치시켰다. append-only revision + CAS head transaction, stale base 409, field/object conflict path, invalid candidate 무기록을 구현했다.
- 재생성 안전: persistent ref는 유지하고 derived ref는 명시적 사용자 확인 전 커밋하지 않는다. ambiguous/broken은 `reference_lost`, kernel 실패는 `kernel_failed`이며 마지막 정상 revision을 보존한다.
- 5개 분야: 기계·건축·토목·조경·인테리어가 동일 revision API와 `.nfab` 계약을 사용하고, 분야별 semantic schema·입력·validator·deliverable은 분리한다. 각 분야에는 외부 독점 CAD 없이 사용할 수 있는 verified 교환 경로가 최소 1개 존재한다.
- 검증: 핵심 통합 47 pass, 정식 SQLite migration/Postgres drift 9 pass, typecheck/ESLint pass, route matrix 544/753 unknown·gap 0, CAD controls 58/58 issues 0, Closed Beta diff 0.
- 문서 감사 추가 업무: 266 Markdown의 저장소 상대 링크는 0 missing으로 정리했다. BIM 지침 registry는 BEP 16/16 trace와 별개로 원본 수식 오류 2,288, 중복 Pset ID 7, 구조 이슈 8 때문에 승격 blocked이며 WP15 입력 정제 gate로 추가한다.
- 판정: `complete_local`. 운영 PostgreSQL 동시성, 장기 브라우저 왕복, staging/production 증거는 WP20 전까지 `not_run`으로 유지한다.

## 22. WP14 실행 결과 — 2026-08-10

- 24축 기계 릴리스 인증서가 공통 workspace revision, exact model hash와 부품·조립·운동·제조·공차·도면 payload hash를 결속한다. 누락은 `not_run`, 변조/분리는 `fail`, stale drawing/BOM은 release 차단이다.
- 최초 v2 300회에서 machine-line 15회 STEP 실패를 재현했고, 안전펜스 `ty`가 배열이 되어 STEP에 `NAN` 100개가 기록되는 생성 결함을 수정했다. 실제 STEP 재임포트 음성 회귀를 표준 기계 suite에 추가했다.
- 기계 suite 9파일/48테스트, 신규 인증/adapter/제조 gate 16테스트, 전체 typecheck, 변경 범위 ESLint가 통과했다.
- 교정 v3 내부 드릴은 20케이스×15반복=300/300 gate와 STEP roundtrip을 통과했고 evidence integrity issue와 false 계열은 0이다. 내부 템플릿은 promotion 0, `eligible=false`를 유지하므로 독립 인증으로 사용하지 않는다.
- Closed Beta는 WP13 대비 17테이블/13행 및 15파일/15,429,420 bytes에서 차이 0이다.
- 판정: `complete_local_independent_accuracy_pending`. 독립 20제품/2검토자 및 현업 도면·BOM 승인은 WP9/WP20 출시 차단기로 남긴다.

## 23. WP15 실행 결과 — 2026-08-10

- 20축 building release certificate가 site coordinate, exact architecture topology, host/opening, egress/MEP, accessibility/envelope, IFC deep semantics, drawing/schedule/quantity와 repair를 workspace revision/model hash에 결속한다.
- BIM 지침 registry 오류 2,288셀·중복 ID 7·구조 이슈 8은 원본 그대로 격리했다. release 사용 시 provenance fail이며 승인 correction 없이는 authoritative registry로 쓰지 않는다.
- 건축 suite 16파일/99테스트, typecheck, lint와 내부 20케이스×15반복 300/300 gate를 통과했다. 내부 템플릿은 promotion 0/eligible=false다.
- 자체 IFC deep roundtrip은 의미·placement·Pset·classification·quantity·CRS를 보존했다. 참고 IFC 3건은 display/import 100%지만 open surface 967, release-critical host/structure open surface 108이라 exact closed-solid import는 releaseReady=false다.
- Closed Beta는 WP14 대비 17테이블/13행 및 15파일/15,429,420 bytes에서 차이 0이다.
- 판정: `complete_local_independent_accuracy_and_external_ifc_solidity_pending`.

## 24. WP16 실행 결과 — 2026-08-10

- 22축 civil release certificate로 CRS·survey·TIN·alignment/profile/section/corridor·earthwork/drainage/stage/structure·exchange/drawing/quantity/repair를 동일 리비전에 결속했다.
- LandXML import/export의 Curve 기본 arc 및 clothoid exact element 비대칭을 수정하고 실제 참고 샘플을 회귀에 포함했다.
- 토목 suite 8파일/81테스트, typecheck/lint, 내부 20×15=300/300 gate를 통과했다. promotion 0/eligible=false다.
- Closed Beta는 WP15 대비 차이 0이다.
- 판정: `complete_local_independent_accuracy_and_production_adapter_pending`.

## 25. WP17 실행 결과 — 2026-08-10

- 기존 조경 의미 모델과 연합 검증은 식재·토양·관수·배수·유지관리 및 stale civil terrain revision을 이미 차단했다. 릴리스 산출물까지 권위 토목 지형에 결속하는 누락만 보강했다.
- 20축 landscape release certificate가 civil document/surface hash, revision, EPSG/datum과 grading·flow·planting·clearance·soil·hardscape·irrigation·maintenance·drawing/schedule/quantity·repair를 동일 workspace revision/model hash에 묶는다.
- 조경 suite 8파일/71테스트, typecheck/lint, 내부 20×15=300/300 gate와 도구체인 14/14를 통과했다. stale civil revision·누락 관수 검증·stale drawing은 release를 차단한다.
- Closed Beta는 WP16 대비 17테이블/13행 및 15파일/15,429,420 bytes에서 차이 0이다.
- 판정: `complete_local_independent_accuracy_pending`. 내부 드릴은 promotion 0/eligible=false이며 외부 현장 20사례/2검토자 승인을 대체하지 않는다.

## 26. WP18 실행 결과 — 2026-08-10

- 기존 인테리어 실측에 기록된 건축 revision을 현재 host와 비교하지 않던 결함을 수정하고 coordinate system 불일치도 연합 validator에서 차단했다.
- 25축 interior release certificate가 건축 host payload/hash/revision과 실측·공간·동선·door/egress/accessibility·가구·ceiling/MEP·finish/millwork·lighting/acoustics·IFC·도면/schedule/quantity·repair를 동일 workspace revision/model hash에 묶는다.
- 인테리어 suite 12파일/83테스트, typecheck/lint와 내부 20×15=300/300 gate·14/14 도구체인을 통과했다. promotion 0/eligible=false다.
- Closed Beta는 WP17 대비 17테이블/13행 및 15파일/15,429,420 bytes에서 차이 0이다.
- 판정: `complete_local_independent_accuracy_pending`. 외부 현장 실측·IES·MEP·제작도 승인과 독립 20사례/2검토자 증거는 WP20 차단기다.

## 27. WP19 실행 결과 — 2026-08-10

- 다른 문서 소유 객체를 변경했다고 허위 선언할 수 있던 transaction ownership gap을 단일/batch 경로에서 차단했다.
- change impact의 반복 full scan을 adjacency index 기반 O(V+E) 순회로 바꾸었고 20,000-reference 연쇄를 로컬 26ms에 추적했다.
- federated release certificate는 프로젝트 hash/revision, profile schema, 좌표, 5개 분야 certificate/document revision, reference, change, clash, quantity, permission, recovery/performance를 10개 gate로 결속한다.
- 연합 전체 7파일/27테스트, 추가 대규모/인증 2파일/9테스트, typecheck/lint와 Closed Beta diff 0을 확인했다.
- 판정: `complete_local_gate_operational_evidence_pending`. 실제 5분야 대형 파일의 종단 재생성, cross-tenant 운영시험, load/save/resume/cancel/restore 및 장기 메모리는 WP20 No-Go다.

## 28. WP20 실행 결과 — 2026-08-10

- production 재현 빌드는 compile, TypeScript, 635/635 static page, 155 App route bundle budget를 통과했다. shared 721.6KB/793.8KB, worst first-paint 2060.5KB/2266.6KB다.
- 정확 CAD 경로에서 발견한 CSP/OCCT 충돌은 전역 완화 없이 localized `shape-generator` route에만 `'unsafe-eval'`을 허용해 해결했다. 홈 응답에는 ambient eval이 없고 CAD 응답에만 있으며, Chromium에서 모바일 exact WASM 0건·데스크톱 `replicad_single.wasm` 1건·`OCCT: ON`을 확인했다.
- 외부 QR 서비스가 프로젝트 URL을 수신하던 구조는 on-demand local QR data URL 생성으로 바꿨다. CSP violation과 외부 QR request는 0이고 번들 예산은 유지됐다.
- runtime performance gate 20/20, CSP 회귀 31/31, typecheck와 변경 범위 lint를 통과했다. 전체 lint의 유일한 `prefer-const` 오류도 FEA 수치 의미를 바꾸지 않고 수정했다.
- dependency audit 0, CycloneDX 1.5 1,005 component/1,006 dependency/취약점 0, route matrix 544/753 unknown·gap 0, CAD API 58/58 issue 0, 매뉴얼 trace 20/16, 참고자료 manifest 6,914/467을 확인했다.
- Closed Beta 최종 스냅샷은 WP19 대비 보호 테이블·행·파일·bytes 차이 0이다.
- technical candidate는 Closed Beta/reference verified지만 `decision=blocked`, audit issue 42, domain verified 0이다. audit 경로를 결속한 release gate도 7개 필수 capability의 승인 독립 holdout/표본/95% pass rate, 5분야 campaign, generation trusted evidence, production store와 rollback/canary/monitoring/worker resume/performance 증거 부재로 BLOCKED했다.
- 최종 판정은 `local_complete_launch_blocked`다. 외부 CAD 설치 없는 웹 기반 AI→수동 조정→전문가 정밀 CAD 구조의 로컬 구현은 유지되지만, 실제 판매 가능한 기술 출시 승인은 독립 정확도·대형 복합 프로젝트·운영/보안 영수증을 확보한 뒤에만 재판정한다.
