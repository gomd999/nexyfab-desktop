# NexyFab CAD/OCCT 완료 현황과 상세 후속 실행 계획

- 기준일: 2026-08-07 (Asia/Seoul)
- 작업 루트: `nexyfab.com/new`
- 브랜치/기준 HEAD: `feat/landing-chat-first` / `1e78a8c8`
- 문서 목적: 이번 연속 작업에서 실제로 완료·검증한 항목과 앞으로 수행할 작업의 단일 인수인계 기준
- 관련 상위 문서:
  - `docs/strategy/current-status-evaluation-and-execution-tracker-260807.md`
  - `docs/handoff-260807-p0-p2.md`
  - `docs/strategy/ai-complex-product-95-plan-260806.md`
  - `docs/adr/014-occt-kernel-promotion.md`
  - `docs/adr/017-topological-naming-k22-spike.md`

## 1. 현재 결론

NexyFab의 기계 CAD 핵심 경로는 단순 메시 생성 단계를 넘어 실제 OCCT BREP 생성·편집·Boolean·STEP 왕복이 가능한 상태다. 홀, 필렛, 모따기, 부분 회전, 위상 이름 전파, 정확 원통, 드릴 팁, 짧은 원통 나사산까지 실제 커널 증거가 있다.

그러나 다음 표현은 아직 사용할 수 없다.

- “복잡 제품 95% 정확도 달성”
- “모든 CAD 형상을 완전 보존”
- “SolidWorks/Inventor급 조립 구속조건 완성”
- “NPT/BSPT 실제 테이퍼 나사 완성”
- “대형 나사와 대용량 STEP이 브라우저에서 항상 안정적”
- “현재 변경분이 운영에 배포됨”

현재 출시 판단은 다음과 같다.

| 범위 | 판단 | 근거/조건 |
|---|---|---|
| 개발자 내부 테스트 | 가능 | 실제 Node/Browser OCCT 회귀 통과 |
| 초대형 클로즈드 베타 | 가능 | 사용 범위 제한, 실패 형상 수동 검토 필요 |
| 무료 공개 베타 | 조건부 가능 | 업로드 제한, timeout, 복구, 지원 정책 필요 |
| 실제 결제 포함 공개 서비스 | 보완 필요 | 결제·환불·보안·백업·운영 도구 게이트 미완료 |
| 기업 생산 주문 | 아직 권장하지 않음 | 책임 정책, 독립 검증, 복구 훈련, 제조 승인 필요 |

## 2. 이번 연속 작업에서 완료한 것

### 2.1 OCCT 커널과 위상 안정성

- 실제 커널 성공/실패/근사 상태를 구분하고 실패를 조용히 성공으로 바꾸지 않는 품질 게이트를 강화했다.
- Boolean 결과 유효성 검사와 결정론적 복구 경로를 추가했다.
- fillet/chamfer에 실제 OCCT 유효성 검사와 축소 반경 재시도를 적용했다.
- extrude, revolve, Boolean, fillet, chamfer, STEP import를 거치는 동안 영속 edge/face 이름을 전파한다.
- Boolean `Generated/Modified` 이력으로 seam과 생성 면을 이름 붙이고 연속 편집에 사용한다.
- 부분 회전을 실제 각도로 생성하며 full/partial revolve의 위상 참조를 검증한다.
- variable fillet과 선형 law fillet을 지원한다.
- 현재 WASM에서 충돌하는 G1/G2 및 다중 제어점 오버로드는 무리하게 사용하지 않고 안전한 C1/C2 경로와 제한을 유지한다.

### 2.2 Worker 안정성 및 파일 방어

- 연산별 timeout과 Worker 재시작 경로를 마련했다.
- STEP 입력 크기·형식 검증과 실패 시 명시적 오류를 적용했다.
- 장시간 반복 작업의 메모리 burn-in 테스트 기반을 추가했다.
- 실제 Browser Worker와 Node 커널 양쪽에서 STEP export/import를 검증한다.
- 원본 Worker와 `public/occt-worker` 배포 복사본의 byte-identical 게이트를 유지한다.
- `node scripts/copy-occt.js`를 공식 Worker 동기화 명령으로 사용한다.

### 2.3 정확한 홀 형상

- 균일 반경·순차 각도·폐곡선 조건을 만족하는 64각형 원형 루프를 실제 OCCT 원기둥으로 승격한다.
- 조금이라도 불규칙한 루프는 일반 prism 경로를 유지해 잘못된 원 판정을 방지한다.
- 관통홀, 막힌 홀, counterbore, countersink를 실제 Boolean과 STEP으로 검증했다.
- 막힌 드릴 홀에 기본 118도 원뿔 팁을 추가했다.
- 드릴 팁 각도는 60도 이상 180도 미만으로 검증한다.
- 홀 깊이를 드릴 팁 정점까지의 깊이로 해석한다.
- `auto | blind | through` 종료 모드를 추가했다.
- 스케치 생성 경로는 홀 깊이와 부모 두께를 비교해 종료 모드를 저장 시점에 확정한다.
- 명시적 blind 홀은 SCAD와 OCCT 모두 원통 몸통과 원뿔 팁을 표현한다.
- 기존 `terminationMode` 없는 데이터는 `auto` 추론으로 호환한다.

### 2.4 메시 나사산 안전성

- 기존 V-thread 메시 생성, 좌/우 나사, 내/외부 나사, 규격표, 도면 표기, STEP 메타데이터 경로를 재검증했다.
- 메시 Boolean 실패 시 나선 커터를 완성 부품처럼 반환하던 위험 경로를 제거했다.
- 기본 동작은 `THREAD_BOOLEAN_FAILED`로 fail-closed한다.
- 명시적인 preview 옵션에서만 커터 단독 강등을 허용한다.
- 정상 결과는 `booleanApplied=true`, 강등 결과는 `degradedReason`을 기록한다.

### 2.5 실제 OCCT BREP 나사산

- 원통 표면의 2D 파라메트릭 직선을 3D 나선 edge로 변환한다.
- 삼각 나사 프로파일을 `BRepOffsetAPI_MakePipe`로 스윕해 실제 BREP 솔리드 커터를 만든다.
- 생성 커터를 `BRepCheck_Analyzer`로 검증한 후에만 사용한다.
- Node와 Browser Worker에 `buildThreadHelixCutter`를 연결했다.
- 오른나사·왼나사, 내부·외부 나사 프로파일 방향을 지원한다.
- 커터 Boolean 결과를 STEP의 실제 BREP 형상으로 보존한다.
- 비정확 fallback Worker는 가짜 나사를 만들지 않고 “exact OCCT kernel required”로 거부한다.

### 2.6 나사 규격 자동 매핑

- `applyThreadOcct`가 ThreadFeature와 규격표를 정확 커널 파라미터로 변환한다.
- 지원 범위:
  - ISO Metric coarse/fine
  - UNC/UNF
  - BSP parallel
- 외부 나사는 공칭 반경에서 골 반경 방향으로 절삭한다.
- 내부 나사는 tap-drill 반경에서 공칭 반경 방향으로 절삭한다.
- NPT와 BSPT는 원통 나사로 잘못 생성하지 않고 명시적으로 차단한다.
- 브라우저 exact thread는 현재 최대 8회전으로 제한한다.

## 3. 현재 검증 증거

테스트 수는 서로 다른 선택 실행 결과이므로 합산하지 않는다. 아래 숫자는 각 시점의 독립 게이트다.

| 게이트 | 결과 |
|---|---:|
| 홀/종료 조건/OCCT 관련 선택 회귀 | 171 pass, 1 skip |
| 나사산 전체 규격·UI·도면·메시 테스트 | 334 pass |
| Browser/Node OCCT 나사 연결 직후 회귀 | 134 pass, 1 skip |
| 최신 나사산 + OCCT 통합 게이트 | 473 pass, 1 skip |
| TypeScript | pass |
| ESLint 변경 범위 | pass |
| `git diff --check` | pass, Windows 줄바꿈 경고만 존재 |

실측 성능:

| 사례 | 결과 |
|---|---|
| Browser Worker 1회전 BREP 왼나사 + Boolean + STEP | 약 1.06초, STEP 921 entities |
| Browser Worker 내부 M8 BREP 커터 | 약 200ms |
| Node 2회전 BREP 나사 + Boolean + STEP | 약 7.4초, STEP 13,348 entities |
| Node 8회전 BREP 나사 + Boolean + STEP | 약 62초, STEP 43,570 entities |

8회전 결과는 기능적으로 성공했지만 브라우저 인터랙티브 작업으로 허용하기에는 무겁다. 따라서 현재 8회전 제한은 “안전하다는 보장”이 아니라 “그 이상을 사전에 차단하는 임시 상한”이다.

## 4. 점검에서 확인된 현재 공백

### 4.1 즉시 해결해야 하는 통합 공백

1. `applyThreadOcct`는 구현됐지만 모든 UI/Feature Tree/AI 생성 경로가 자동으로 이 함수를 호출하는 것은 아니다.
2. 기존 `applyThreadGeometric` 메시 경로와 정확 OCCT 경로의 최종 라우팅 정책이 한 곳으로 통합되지 않았다.
3. Browser Worker의 나선 생성 중간 OCCT 객체에 대한 명시적 dispose/delete 정리가 부족해 반복 작업 메모리 누수 검증이 필요하다.
4. 긴 나사 연산은 동기 WASM 호출 동안 Worker를 점유한다. 외부 timeout이 Worker를 종료할 수는 있지만 부분 진행 취소는 지원하지 않는다.
5. 실제 형상 STEP과 thread metadata를 한 export 계약으로 묶는 최종 경로가 필요하다.
6. 현재 작업 트리는 95개 변경 항목이 있는 dirty 상태다. 이번 작업과 기존 사용자 변경을 구분해 커밋해야 한다.
7. 운영 배포 여부는 이번 세션에서 확인하지 않았다. 로컬/테스트 통과를 배포 완료로 해석하면 안 된다.

### 4.2 정확 형상 공백

- NPT/BSPT 1:16 테이퍼 나선
- Whitworth 55도와 ISO/UTS 60도 프로파일의 exact BREP 분리
- crest/root truncation, rounded root, run-in/run-out, relief groove
- 다중 시작 나사, 비표준 피치, 왼나사 조합 확대
- 실제 tolerance class가 형상 치수에 주는 영향
- 긴 나사의 face/entity 폭증 억제
- 나사 이후 fillet/chamfer/Boolean에서 위상 이름 생존
- 나사 STEP 재가져오기 후 형상·체적·나사 메타데이터 동시 보존

### 4.3 복잡 제품 공백

- 기어 involute 치형과 백래시
- 베어링 내부 race/ball/roller/cage 형상
- 제조사 모터·감속기·실린더 모델 연결
- 조립 mate/constraint, 자유도, 간섭 및 동작 검증
- 복잡 loft, guide rail, 자유곡면, 자동차·항공급 Class-A 형상
- 얇은 면, 자가 교차, 비정상 shell, 작은 edge/sliver face 복구
- GD&T, 공차 누적, 표면조도, 열처리, 재료 인증
- 피로·열·유체·동역학 해석 결과의 검증

### 4.4 95% 정확도 증명 공백

- 독립 holdout ground truth 승인 0/88 상태는 별도 상위 현황 문서를 따른다.
- 제품군별 최소 사례 수와 reviewer dual signoff가 필요하다.
- 단순 생성 성공률이 아니라 치수, 피처, topology, assembly, manufacturability를 각각 측정해야 한다.
- 메시/AABB/preview 성공은 exact BREP 정확도 점수에 포함하면 안 된다.
- 실패·거부·not_run을 pass로 바꾸면 안 된다.

### 4.5 상용 서비스 공백

- 대용량·손상 STEP/IGES 스트레스 테스트
- 브라우저별, 모바일, 저사양 PC 기준
- 자동 저장, 편집 복구, 파일 버전 관리
- Worker 메모리 제한과 재시작 telemetry
- 동시 사용자 부하와 서버 큐
- 운영자 권한 분리, 다운로드 권한, 만료 URL, 감사 로그
- DB 자동 백업과 실제 복구 훈련
- 주문 상태 강제 변경 이력, 결제/환불 확인, 실패 작업 재처리
- migration gate, rollback 절차, 고유 build ID
- 약관, 개인정보, CAD 소유권/보관/삭제, 환불 및 제조물 책임 정책

## 5. 상세 후속 실행 계획

## P0 — 현재 변경을 안전하게 제품 경로에 연결

### P0-1. 정확 나사 라우터 통합

목표: UI, AI, Feature Tree, API가 동일한 나사 실행 결정을 사용한다.

작업:

1. `selectThreadKernelRoute()`를 단일 진입점으로 만든다.
2. cosmetic, mesh-preview, exact-OCCT, async-server, unsupported를 명시적 enum으로 반환한다.
3. commit 작업은 exact OCCT를 우선하고 drag/preview만 메시를 허용한다.
4. `applyThreadOcct`를 Feature Tree 실행기에 연결한다.
5. Web/API/CLI/MCP가 동일 schema와 오류 코드를 사용하도록 한다.
6. NPT/BSPT, turn budget 초과, 커널 부재를 UI에서 사전에 표시한다.

완료 게이트:

- 동일 ThreadFeature가 Web/API/CLI/MCP에서 같은 route와 error code를 반환한다.
- geometric commit이 메시 커터를 완제품으로 저장하는 경로가 0개다.
- Browser Worker E2E에서 Feature Tree → exact thread → STEP이 통과한다.

### P0-2. 메모리·취소·시간 예산

작업:

1. Worker 나선 함수의 모든 임시 OCCT 객체를 `finally/delete()`로 정리한다.
2. 1/2/4/8회전 × 좌/우 × 내/외부 반복 burn-in을 작성한다.
3. 연산 전 예상 turns/entity/time budget을 산출한다.
4. 인터랙티브 제한을 단순 8회전 상수 대신 기기 등급과 예상 비용으로 결정한다.
5. 예산 초과는 async-server route로 전환하고 job 취소/timeout/Worker kill을 지원한다.
6. Worker 재시작 후 이전 handle이 명시적으로 invalid가 되는지 검증한다.

완료 게이트:

- 100회 반복 후 Worker heap 증가가 승인된 상한 이내다.
- timeout 후 새 작업이 정상 수행된다.
- 장시간 작업이 UI main thread를 막지 않는다.

### P0-3. 변경분 보전과 배포 게이트

작업:

1. 95개 dirty 항목을 소유권과 논리 단위로 분류한다.
2. 사용자 기존 변경을 덮지 않고 CAD 커널 변경만 별도 커밋한다.
3. `copy-occt`, TypeScript, ESLint, 실제 Node/Browser OCCT 테스트를 CI 필수 게이트로 등록한다.
4. build ID에 commit SHA와 Worker asset hash를 표시한다.
5. staging 배포 후 Chromium/Firefox/WebKit 실제 Worker smoke를 실행한다.
6. rollback 명령과 이전 Worker asset 복구 절차를 문서화한다.

완료 게이트:

- clean/설명 가능한 worktree
- CI에서 Worker 원본/배포본 불일치 시 배포 차단
- staging smoke와 rollback rehearsal 통과

## P1 — 나사산 상용 정확도 완성

### P1-1. NPT/BSPT 테이퍼 나사

1. 규격표의 `taper.ratio=1/16`, half-angle 1.7833도를 사용한다.
2. 원뿔 표면의 p-curve 나선을 생성한다.
3. NPT 60도와 BSPT Whitworth 55도 프로파일을 분리한다.
4. gauge plane, engagement length, 방향, 내/외부 기준 지름을 적용한다.
5. NPT/BSPT 대표 규격별 체적·bbox·pitch·STEP 왕복을 검증한다.

게이트: 잘못된 원통 근사 0건, 규격별 기준 단면 오차 허용치 충족.

### P1-2. 프로파일 현실화

1. crest/root truncation을 표준별로 반영한다.
2. rounded root/crest를 OCCT arc로 구성한다.
3. run-in, run-out, relief groove를 추가한다.
4. tolerance class를 형상 치수 또는 metadata-only로 구분해 과장 없이 표시한다.
5. 좌/우, 내/외부, coarse/fine 조합 매트릭스를 만든다.

### P1-3. 긴 나사 async 서버 경로

1. 8회전 초과 또는 예상 비용 초과를 서버 job으로 라우팅한다.
2. progress, cancel, retry, timeout, idempotency key를 제공한다.
3. content hash로 동일 나사 결과를 캐시한다.
4. STEP entity 수와 파일 크기를 결과 metadata에 기록한다.
5. 서버 작업 실패 시 cosmetic metadata 또는 수동 승인으로 강등하되 exact 성공으로 표시하지 않는다.

## P1 — 일반 CAD 안정성 확대

### P1-4. Boolean/fillet/chamfer 스트레스 매트릭스

- 얇은 벽, 작은 edge, tangent contact, coplanar face, self-intersection 사례 추가
- 큰 fillet, variable/law fillet, 연속 chamfer 체인
- 실패 반경 이분 탐색과 부분 edge 집합 격리
- 복구 전후 topology/volume/area diff 기록
- 동일 입력 결정성 및 Worker 재시작 결정성 확인

### P1-5. STEP 견고성

- 크기 구간: 10MB, 50MB, 100MB, 250MB+
- 정상, 일부 손상, truncated, 비정상 entity, 다중 solid/assembly
- import timeout, memory ceiling, cancel, quarantine
- AP203/AP214/AP242와 PMI 보존 범위 구분
- 실제 export→import 후 solid count, bbox, volume, analytic type histogram, topology reference 비교

### P1-6. 자동 저장과 복구

- 명령 로그 + checkpoint + content hash
- Worker crash 직전 마지막 안전 checkpoint 복구
- schema migration과 이전 파일 read-only fallback
- 사용자 확인 치수/조립 조건은 자동 복구가 임의 변경하지 못하도록 보호

## P1 — 주문·보안·운영 상용화

### P1-7. 데이터 보호

- 운영자 역할 분리와 최소 권한
- 주문/개인정보/CAD 다운로드 접근 감사 로그
- signed/expiring URL
- 개발·스테이징·운영 데이터 분리
- 비밀키 rotation
- 백업 자동화 + 실제 restore drill

### P1-8. 주문 운영

- 주문 상태 강제 변경과 사유/행위자 이력
- 결제·환불 상태 대조
- 실패 CAD/견적/생산 작업 재처리
- 고객지원용 주문 timeline
- 파트너 지연, 불량, 재제작 기록

### P1-9. 배포 안전장치

- build/test/migration/browser gate
- canary 및 즉시 rollback
- health/readiness와 Worker asset hash 확인
- 배포 버전·DB migration·OCCT WASM 버전 동시 표시

## P2 — 복잡 제품 기능 확대

### P2-1. 기어와 동력전달

- involute spur/helical/bevel gear
- module/DP, pressure angle, backlash, profile shift
- shaft/key/spline, bearing seat, seal groove
- 기어 pair 중심거리와 간섭 검증
- 제조 가능한 단순화와 exact 형상을 분리

### P2-2. 구매품과 조립

- 제조사 STEP/metadata catalog
- 프록시 형상과 실제 제조사 형상을 명확히 구분
- mate/constraint solver, DOF, collision/clearance
- 볼트/너트/와셔/탭 홀 호환성
- motion sweep와 공차 밴드 기반 간섭 판정

### P2-3. 자유곡면

- multi-section loft, guide rail, sweep orientation
- G0/G1/G2 continuity 측정
- self-intersection 및 sliver face 탐지
- 자동차·항공급 형상은 별도 고정밀 트랙과 사람 승인 적용

### P2-4. GD&T와 제조 속성

- datum, tolerance frame, semantic PMI
- 표면조도, 재료, 열처리, 코팅
- 공차 stack-up과 fit class
- STEP AP242 semantic/graphical PMI 보존
- 제조 견적과 도면에 동일 속성 사용

## P3 — 분야별 정확도 검증

### 기계/로봇/감속기

- 부품 계층, 축계, 베어링, 기어, 체결, 조립 자유도
- 정확 BREP와 실제 제조사 구매품 모델 비율 측정
- motion/clearance/joint holdout 승인

### 공장 설비/배관

- flange, valve, pump, support, nozzle, pipe route
- 규격 호환, 유지보수 공간, 간섭, BOM
- 대형 assembly 로딩·LOD·서버 연산

### 건축/인테리어

- IFC hierarchy, room/opening/stair/MEP/furniture
- 닫힌 체적과 열린 surface를 분리 평가
- 법규·피난·동선·간격 검증
- 치수/재료/시공 문서와 3D 형상 일치

## P4 — 95% 정확도 입증

1. 독립 holdout case를 제품군별 최소 20개 확보한다.
2. 생성에 사용하지 않은 reviewer가 ground truth를 승인한다.
3. 사례당 반복 실행과 입력/버전/hash를 고정한다.
4. 다음 축을 별도로 채점한다.
   - 치수 정확도
   - feature 정확도
   - topology/solid 정확도
   - assembly hierarchy/transform/joint 정확도
   - manufacturability gate
   - 실패 감지와 정직한 거부율
5. 제품군/Tier별 coverage와 accuracy가 모두 기준을 충족해야 한다.
6. 중대한 허위 `verified`는 0건이어야 한다.

완료 전에는 “95% 달성” 대신 “해당 테스트 집합에서 N/N 통과”만 표시한다.

## 6. 병렬 작업 구조

다음 트랙은 병렬 진행 가능하다.

| 트랙 | 범위 | 주요 의존성 |
|---|---|---|
| A | Thread exact routing, tapered thread, profile | OCCT Worker/API |
| B | STEP 대용량·손상·메모리 burn-in | 테스트 fixture, CI 자원 |
| C | Boolean/fillet/chamfer 복구 | topology naming/history |
| D | Assembly/mate/interference | 정확 part geometry |
| E | 운영 보안·백업·주문 도구 | DB/배포 환경 |
| F | 95% holdout와 reviewer 승인 | 사람 검토, corpus 라이선스 |
| G | 인테리어/IFC 정확도 | IFC exact body coverage |

병렬화 규칙:

- 동일 파일을 수정하는 트랙은 분리하지 않는다.
- 커널 API 계약은 A가 먼저 고정하고 B/C/D가 소비한다.
- 검증기는 생성기와 독립적으로 유지한다.
- 운영 트랙 E와 corpus 트랙 F는 커널 개발과 병렬 진행한다.

## 7. 다음 실제 실행 순서

다음 세션은 아래 순서로 중단 없이 진행한다.

1. exact thread 단일 라우터와 Feature Tree 연결
2. Browser Worker 임시 OCCT 객체 정리 및 100회 burn-in
3. 1/2/4/8회전 성능·메모리·STEP entity benchmark
4. 8회전 초과 async job 설계와 최소 구현
5. NPT/BSPT 원뿔 p-curve 나선 스파이크
6. NPT 1개, BSPT 1개 실제 Boolean/STEP 게이트
7. thread geometry + metadata 통합 STEP 왕복
8. 나사 이후 fillet/chamfer/topology survival 테스트
9. 대형·손상 STEP fixture 매트릭스
10. staging 실제 브라우저 3종 배포 게이트

각 작업은 다음 루프를 따른다.

`현상 점검 → 최소 정확 구현 → 실제 커널 테스트 → 회귀 → 성능/메모리 점검 → 문서 갱신 → 다음 작업`

## 8. 공통 완료 정의

기능 하나를 완료로 표시하려면 다음을 모두 만족해야 한다.

- 실제 구현이 호출 경로에 연결됨
- stub/mock만이 아니라 실제 OCCT Node 또는 Browser Worker 증거가 있음
- 잘못된 입력과 커널 부재가 fail-closed함
- 형상 유효성, 체적/bbox/topology 중 필요한 지표를 검증함
- STEP이 필요한 기능은 export/import 증거가 있음
- timeout, memory, release/cleanup 정책이 있음
- 기존 회귀가 통과함
- 사용자에게 exact/approximate/cosmetic 상태가 정직하게 표시됨
- 배포 대상이면 staging smoke와 rollback이 검증됨

## 9. 재현 명령

```powershell
node scripts/copy-occt.js
npx tsc --noEmit --pretty false
npx eslint --quiet src/lib/occt/bridge.ts src/lib/occt/nodeOcctBridge.ts src/lib/occt/wasmBridge.ts src/lib/occt/wasmWorkerStub.ts
npx vitest run "src/app/[lang]/shape-generator/features/threads/__tests__" src/lib/occt/wasmBridge.test.ts src/lib/occt/occtWorkerReal.stepRoundtrip.test.ts src/lib/occt/wasmRealActivation.test.ts src/lib/occt/nodeOcctBridge.test.ts --reporter=dot
git diff --check
```

최신 위 명령 묶음 결과: 22 test files, 473 pass, 1 skip.

## 10. 변경 관리 주의사항

- 현재 worktree의 다른 변경은 사용자 또는 이전 작업 소유일 수 있으므로 일괄 reset/checkout하지 않는다.
- 커밋 전 `git diff --name-only`와 변경 목적을 대조한다.
- `public/occt-worker`는 직접 수정하지 않고 `scripts/copy-occt.js`로 생성한다.
- 테스트 통과는 운영 배포 완료를 뜻하지 않는다.
- 대형 나사 62초 결과처럼 기능 성공과 상용 성능 통과를 분리 기록한다.
- 독립 holdout 승인 전에는 복잡 제품 95%를 주장하지 않는다.

## 11. 제품 전체 재점검 결과

이번 계획은 CAD 커널만이 아니라 사용자가 NexyFab을 발견하고 설계를 만들고 검증하고 견적·결제·생산·재주문하는 전체 흐름을 대상으로 한다. 상태는 다음 네 단계로 구분한다.

| 상태 | 의미 |
|---|---|
| 존재 | 코드, 화면 또는 API가 있음 |
| 연결 | 앞뒤 사용자 흐름에서 실제 호출됨 |
| 검증 | 실제 브라우저·실데이터·실커널 증거가 있음 |
| 운영 가능 | 관측, 권한, 복구, 지원, rollback까지 있음 |

현재 가장 큰 위험은 기능 수가 아니라 연결성과 검증 깊이다.

- 메인 `ShapeGeneratorInner.tsx`는 약 625KB, `ShapePreview.tsx`는 약 170KB, `CommandToolbar.tsx`는 약 124KB다. 기능 추가 시 초기 로딩·렌더 회귀·상태 결합 위험이 크다.
- 3D 시각 회귀는 기본 큐브 한 장면만 검사한다. 재질, 투명, 대형 조립, 단면, 선택, 치수, 분석 overlay는 시각 기준선이 없다.
- 대표 happy path 테스트의 DFM·RFQ·자동저장 확인 일부가 best-effort이므로 실제 단절을 놓칠 수 있다.
- RFQ E2E는 `/ko/...`를 사용하지만 제품 경로 문서는 `/kr/...`를 기준으로 한다. canonical locale 규칙과 redirect 검증이 필요하다.
- AI 제조 게이트 G0~G8은 일부 연결됐지만 G9 출고 승인이 끊겨 있어 AI 결과에서 제조 주문으로 이어지는 단일 증거 체인이 없다.
- 기능별 단위 테스트는 많지만 가입 → 설계 → 검증 → 견적 → 결제 → 생산 → 배송의 실사용 전체 여정은 하나의 강한 배포 게이트로 묶이지 않았다.
- 모바일은 완전 CAD 편집보다 조회·승인·댓글·주문 추적 중심으로 범위를 명시해야 한다.

## 12. 목표 사용자 여정

### 12.1 신규 사용자의 첫 성공

`랜딩 → 게스트 시작 → 템플릿/파일/AI 중 입력 선택 → 3D 결과 → 치수 확인 → 저장/가입 전환`

필수 UX:

1. 첫 화면에서 “직접 설계”, “CAD 업로드”, “AI로 생성”, “빠른 견적” 네 목적을 분리한다.
2. 빈 캔버스에는 업종별 예제와 예상 소요시간을 표시한다.
3. 가입 전에도 첫 결과까지 체험하게 하되, 저장·내보내기 시 가입 이유를 설명한다.
4. 게스트 결과와 AI 대화를 가입 계정으로 손실 없이 이관한다.
5. 첫 성공 지표는 페이지 방문이 아니라 `유효한 3D 결과 + 저장 또는 내보내기`로 정의한다.

완료 기준:

- 첫 사용자 테스트 10명 중 8명 이상이 도움 없이 10분 내 첫 결과 생성
- 게스트 → 가입 → 프로젝트 복원 E2E 100% 통과
- 주요 단계 이탈 이벤트와 실패 이유가 분석 화면에 기록됨

### 12.2 숙련 CAD 사용자의 편집 흐름

`프로젝트 열기 → 스케치/피처 생성 → 커널 평가 → 선택/치수 수정 → 검증 → 버전 저장 → STEP/도면 출력`

필수 UX:

- 선택한 면·모서리와 Feature Tree 항목을 양방향 강조한다.
- 긴 연산에는 단계, 경과시간, 취소, 실패 원인, 복구 행동을 표시한다.
- exact/approximate/cosmetic 상태와 제조 가능 여부를 상태 바에 항상 표시한다.
- Undo/Redo, 자동저장, crash recovery, 버전 비교의 범위를 일관되게 만든다.
- 단축키, command palette, 우클릭 메뉴에서 같은 명령과 같은 용어를 사용한다.

완료 기준:

- 핵심 20개 편집 작업의 keyboard/mouse 경로와 undo/redo E2E
- 실패 연산 후 마지막 정상 형상 유지 및 재시도 가능
- 저장 후 재진입 시 카메라·선택을 제외한 설계 의미가 동일

### 12.3 AI 설계 흐름

`요구 입력 → AI 구조화 → 누락 질문 → 계획 미리보기 → 결정론적 생성 → 자동 검증 → 차이 설명 → 사용자 승인 → 편집/견적`

AI는 바로 형상을 확정하지 않고 다음 상태 머신을 따른다.

| 상태 | 사용자에게 보여줄 것 | 통과 조건 |
|---|---|---|
| intake | 목적, 단위, 핵심 치수, 재료·공정 | 필수 입력 충족 |
| clarify | 누락·충돌 질문, AI 가정 | 사용자가 확정 |
| plan | 부품/BOM/피처/조립 계획 | 생성 전 승인 또는 안전한 자동 승인 |
| build | 현재 단계, 소요시간, 취소 | 커널 결과 생성 |
| verify | G0~G8, 치수 차이, 실패 항목 | 지원 범위 내 passed |
| revise | 수정 제안과 변경 영향 | 새 버전으로 재검증 |
| release | artifact hash, 승인자, 용도 | G9 승인 |

필수 정책:

- AI 추정값은 입력값과 시각적으로 구분하고 제조 전에 확인받는다.
- “생성 성공”과 “제조 검증 완료”를 다른 배지로 표시한다.
- 사용자가 요청한 치수와 실제 결과를 `요청 → 결과 → 오차` 형식으로 보여준다.
- repair round, 실패 stage, 모델·프롬프트·규칙 버전을 결과 이력에 남긴다.
- AI 수정은 기존 버전을 덮어쓰지 않고 diff와 rollback을 제공한다.
- 지원하지 않는 형상은 단순화 사실을 숨기지 않고 수동 CAD 경로로 넘긴다.

완료 기준:

- 성공·거부·수정 필요 세 경로 E2E
- 같은 입력 반복 5회에 대한 성공률·최악값 기록
- 허위 `verified` 0건
- AI 결과에서 Feature Tree 항목과 생성 근거를 추적 가능
- G9 승인 후에만 제조/RFQ 산출물로 승격

### 12.4 견적·주문 사용자 흐름

`검증된 설계 선택 → 공정/재료/수량 → DFM → 즉시 또는 수동 견적 → 견적 비교 → 승인 → 결제 → 생산 → 검사 → 배송 → 재주문`

필수 UX:

- 견적 대상 artifact ID와 설계 버전을 고정한다.
- 설계 변경 시 기존 견적이 무효 또는 재계산 필요함을 명확히 표시한다.
- 단가, 금형/셋업비, 배송, 세금, 납기, 통화와 유효기간을 분리한다.
- 결제·환불·재제작 상태를 하나의 주문 타임라인에 표시한다.
- 생산 중 CAD 파일 교체는 새 승인 없이는 허용하지 않는다.
- 재주문은 과거 품질·변경 여부를 확인하고 동일 artifact hash만 원클릭 처리한다.

완료 기준:

- 실제 샌드박스 결제까지 포함한 buyer E2E
- 설계 버전 변경 → 견적 invalidation 테스트
- 결제 webhook 중복·지연·순서 역전에 대한 idempotency 테스트
- 고객·관리자·파트너 화면의 주문 상태가 동일한 상태 머신을 사용

### 12.5 파트너와 운영자 흐름

파트너:

`가입/심사 → 설비·공정·인증 등록 → RFQ 수신 → 제조성 검토 → 견적 → 수주 → 생산 업데이트 → 검사 증거 → 출하 → 정산`

운영자:

`이상 알림 → 주문/AI/파일 증거 조회 → 권한 상승 승인 → 재처리/환불/상태 변경 → 고객 통지 → 감사 로그`

완료 기준:

- 파트너 승인, RFQ 응답, 납기 변경, 품질 이슈, 정산 E2E
- 운영자 강제 변경은 사유·전후 값·행위자·시간을 반드시 기록
- 관리자 권한 상승은 만료형이며 민감 파일 접근 로그와 연결
- 실패 job의 안전한 재처리와 고객 중복 알림 방지

## 13. 렌더링과 3D 뷰포트 계획

### R0. 계측 기준선

수집 지표:

- editor shell 표시 시간, 첫 유효 프레임, 첫 조작 가능 시간
- 평균/최악 frame time, FPS p50/p95, long task 수
- draw call, triangle, geometry/texture/GPU 메모리 추정
- 모델 로드·tessellation·BVH·selection latency
- 10분/60분 편집 후 JS heap과 geometry 수 증가량

작업:

1. `ShapePreview`에 개발/스테이징 전용 성능 telemetry를 연결한다.
2. 모델 복잡도 등급 S/M/L/XL fixture를 고정한다.
3. Chromium/WebKit/Firefox, 내장 GPU/저사양 preset을 나눠 기록한다.
4. WebGL context loss와 Worker crash 복구를 자동화한다.

### R1. 렌더 구조 분리

- `ShapeGeneratorInner`를 shell, document state, kernel orchestration, workspace panels로 분리한다.
- `ShapePreview`를 scene lifecycle, geometry registry, interaction, overlays, post-processing으로 분리한다.
- 분석/CAM/FEA/렌더 워크스페이스는 실제 lazy chunk로 만든다.
- React state 변경이 매 프레임 scene 재구성을 만들지 않도록 selector와 memo 경계를 둔다.
- GPU 객체 소유자와 dispose 규칙을 문서화하고 자동 테스트한다.

### R2. 품질과 대형 모델

- adaptive tessellation과 화면 오차 기반 LOD를 적용한다.
- 작은 부품 instancing, frustum/occlusion 전략, overlay batching을 검토한다.
- 품질 preset을 `정확/균형/성능`으로 제공하고 결과 형상 정확도와 표시 품질을 분리한다.
- 대형 조립은 progressive load, placeholder bbox, 부분 선택 로딩을 제공한다.
- 투명/단면/엣지/선택/치수/열지도 z-fighting 기준을 고정한다.

### R3. 시각 회귀 확대

기본 큐브 한 장면에서 다음 최소 12장면으로 확대한다.

- 단일 exact solid, STEP import, 100+ 부품 조립
- 선택/hover, Feature Tree 연동, 치수와 GD&T
- wireframe/hidden-line/section/exploded view
- 투명 재질, 어두운/밝은 테마
- DFM/FEA overlay, 오류·빈 화면·로딩 화면

배포 기준:

- 기준 기기에서 일반 편집 p95 frame time 33ms 이하
- 사용자 입력 응답 p95 100ms 이하, 긴 커널 연산은 UI thread 비차단
- 30분 fixture에서 지속 증가형 geometry/texture 누수 없음
- 시각 회귀 허용치를 장면별로 명시하고 무조건 snapshot 갱신 금지

## 14. UI/UX와 접근성 계획

### U0. 정보 구조

- 상위 작업 공간을 `설계 / 조립 / 검증 / 제조 / 렌더 / 문서`로 제한한다.
- 좌측은 구조와 생성, 중앙은 캔버스, 우측은 선택 속성/검증으로 역할을 고정한다.
- 동일 기능의 중복 패널과 용어를 inventory하여 canonical 진입점을 하나 정한다.
- 초보 모드와 전문가 모드는 기능을 숨기는 방식보다 기본 밀도·도움말·단축키 노출로 차등한다.

### U1. 상태와 오류

모든 비동기 작업은 `queued/running/succeeded/review_required/failed/cancelled`를 사용한다. 오류 메시지는 다음을 포함한다.

- 무엇이 실패했는지
- 기존 설계가 안전한지
- 자동 복구 여부
- 사용자가 할 수 있는 다음 행동
- 지원 문의에 사용할 correlation ID

### U2. 접근성·반응형·국제화

- command palette, dialog, tree, property grid의 키보드 순서와 focus trap을 검증한다.
- 색만으로 선택·위험·검증 상태를 표현하지 않는다.
- Canvas 핵심 상태를 screen-reader용 텍스트 요약으로 제공한다.
- 200% 확대, 고대비, reduced motion을 지원한다.
- `kr/en/ja/cn/es/ar`의 잘림과 RTL을 시각 회귀에 포함한다.
- 모바일은 열람·회전·댓글·승인·주문 추적을 P0으로, 정밀 모델링은 태블릿/데스크톱 권장으로 명시한다.

완료 기준:

- 핵심 여정 axe serious/critical 0건
- keyboard-only로 프로젝트 열기, AI 요청, 결과 승인, 저장 가능
- locale canonical redirect와 이메일/CTA 링크 전수 검사
- 사용자 테스트에서 핵심 명령 성공률 90% 이상

## 15. 제품 프로세스·데이터 연결 계획

### 15.1 단일 lineage

다음 ID를 끊김 없이 연결한다.

`session → user → project → document version → generation run → verification run → artifact → RFQ → quote → order → production job → inspection → shipment → invoice`

각 전환은 actor, source ID, target ID, timestamp, 정책 버전, correlation ID를 기록한다. AI 대화나 화면의 임시 모델이 주문 artifact로 조용히 바뀌면 안 된다.

### 15.2 분석 이벤트

공통 이벤트 최소 집합:

- `entry_selected`, `file_upload_started/completed/failed`
- `ai_intake_started`, `clarification_answered`, `generation_completed/failed`
- `verification_completed`, `user_approved_artifact`
- `rfq_started/submitted`, `quote_received/accepted`
- `payment_started/succeeded/failed/refunded`
- `production_delayed`, `inspection_failed`, `reorder_started`

이벤트에는 CAD 원문이나 프롬프트 원문을 기본 저장하지 않고 비식별 ID·분류·오류 코드 중심으로 기록한다.

### 15.3 서비스 수준

- 브라우저 연산, 서버 job, AI 생성, 견적 응답, 주문 상태 업데이트 각각 timeout/SLO를 둔다.
- 제품 KPI와 기술 SLI를 연결한다. 예: 생성 실패율 상승 → 첫 결과 성공률 하락.
- 지원 담당자가 correlation ID로 AI·CAD·주문 이력을 한 화면에서 조회할 수 있게 한다.

## 16. 구체적인 병렬 실행 프로그램

| 트랙 | 1차 산출물 | 선행 조건 | 배포 게이트 |
|---|---|---|---|
| A 커널/CAD | exact router, memory/cancel, STEP stress | 기존 P0 | 실제 OCCT+STEP 왕복 |
| B 렌더링 | telemetry, fixture, lifecycle 분리 | fixture 정의 | FPS/메모리/시각 회귀 |
| C UI/UX | 정보 구조, 상태 모델, 오류 UX | 사용자 여정 확정 | a11y+핵심 task E2E |
| D AI workflow | intake→G9 상태 머신, diff/approval | artifact lineage | 허위 verified 0 |
| E 구매 여정 | RFQ→결제→주문 timeline | D의 artifact 고정 | sandbox end-to-end |
| F 파트너/운영 | 심사, 생산, 검사, 재처리 | 주문 상태 머신 | 감사 로그+권한 테스트 |
| G 데이터/관측 | lineage, event taxonomy, dashboards | ID 계약 | 누락 이벤트 검사 |
| H 품질/배포 | 브라우저 matrix, rollback, canary | A~G gate 정의 | release gate 일괄 통과 |

병렬화 시 A는 커널 계약, D는 artifact/검증 계약, E/F는 주문 상태 계약을 먼저 고정한다. `ShapeGeneratorInner.tsx`와 공통 상태 모델을 동시에 여러 트랙이 직접 수정하지 않고 owner를 한 명 둔다.

## 17. 12주 실행안

### 1~2주: 측정과 계약 고정

- 사용자 여정·상태 머신·lineage ID 계약 확정
- locale `/kr` canonical 및 `/ko` redirect 테스트
- 렌더 S/M/L/XL fixture와 성능 telemetry
- 현재 E2E의 best-effort assertion 제거, 실제 실패하도록 강화
- AI 생성/검증/승인 상태 API 계약

### 3~4주: 편집기와 AI 핵심 통합

- `ShapeGeneratorInner` 1차 분리와 워크스페이스 lazy loading
- Worker 취소·timeout·메모리 cleanup
- AI clarify/plan/verify/revise UI
- 요청 치수 대 실제 치수 diff
- 자동저장·복구·버전 lineage 통합

### 5~6주: 견적 연결

- verified artifact 선택과 G9 승인
- artifact 변경 시 RFQ/quote invalidation
- DFM 결과와 공정·재료 입력 연결
- buyer 견적 비교와 주문 timeline 통합
- 샌드박스 결제 및 webhook 복원력 테스트

### 7~8주: 파트너·운영 완성

- 파트너 심사·능력·인증·RFQ 응답 흐름
- 생산 지연·검사·재제작·출하 증거
- 운영자 권한 상승, 강제 변경, 재처리, 환불 감사 로그
- 고객지원 correlation view

### 9~10주: 렌더/UX 품질과 브라우저 확대

- progressive assembly, LOD, GPU dispose
- 12장면 시각 회귀
- keyboard/a11y/200% zoom/RTL
- 모바일 조회·승인·주문 추적
- 브라우저·저사양·장시간 soak

### 11~12주: 상용 배포 리허설

- 가입부터 배송까지 staging 전체 여정
- 백업 복구, 결제 재처리, Worker 장애, rollback 훈련
- 독립 holdout과 제조 reviewer 승인
- canary 배포와 SLO 대시보드
- 정책·지원·환불·CAD 보존 안내 최종 확인

## 18. 다음 15개 작업 순서

1. 전체 route와 locale canonical 표 작성 및 `/ko`/`/kr` 불일치 수정
2. 핵심 사용자 여정 6종을 강한 Playwright 테스트로 작성
3. Q8/RFQ 테스트의 조건부·best-effort assertion 제거
4. artifact lineage 타입과 DB/API 계약 정의
5. AI `intake→release` 상태 머신 및 G9 승인 연결
6. exact/approximate/cosmetic/verified 표시를 공통 상태 컴포넌트로 통합
7. 렌더 S/M/L/XL fixture와 telemetry 구현
8. `ShapeGeneratorInner` 경계 추출 및 workspace lazy chunk 적용
9. `ShapePreview` geometry registry와 dispose 소유권 정리
10. Worker cancel/timeout/crash recovery 통합
11. 자동저장·복구·버전과 AI 수정 diff 연결
12. artifact 변경 시 RFQ/quote invalidation 구현
13. 결제 webhook idempotency와 주문 timeline E2E
14. 파트너 생산·검사 및 관리자 재처리/audit E2E
15. 브라우저·모바일·a11y·visual·soak를 commercial release gate에 등록

## 19. 제품 전체 완료 정의

“상용 준비 완료”는 다음이 모두 참일 때만 선언한다.

- 대표 사용자가 가입부터 원하는 결과까지 도움 없이 도달한다.
- 화면에 보인 형상, 저장 문서, STEP, 견적, 생산 파일이 같은 artifact lineage를 가진다.
- AI 결과의 가정·오차·검증·승인이 재현 가능하다.
- 렌더링이 목표 기기 성능 예산과 장시간 메모리 기준을 만족한다.
- 오류·취소·재시도·복구 경로가 happy path와 같은 수준으로 테스트된다.
- 고객·파트너·관리자 상태가 하나의 주문 상태 머신에서 일치한다.
- 접근성·국제화·모바일 범위가 문서와 실제 동작에서 일치한다.
- 개인정보·CAD 파일 접근·결제·관리자 행동의 감사 증거가 남는다.
- staging 전체 여정, canary, rollback, DB 복구 훈련이 통과한다.
- 독립 holdout 없이 정확도 수치를 마케팅 문구로 사용하지 않는다.

## 20. 제품 전체 계획 실행 로그

### 2026-08-07 1차 연속 실행

완료:

1. locale canonical 계약
   - route locale은 `kr/en/ja/cn/es/ar`로 고정
   - 레거시 `/ko/*`는 `/kr/*`, `/zh/*`는 `/cn/*`로 query를 보존해 308 redirect
   - 계정 화면의 실제 `/ko` 링크 제거
   - 랜딩/RFQ E2E를 canonical 경로로 정렬
2. 핵심 happy path 강화
   - DFM, RFQ, 자동저장 surface에 안정적인 test ID 추가
   - Q8 E2E의 조건부·best-effort 검사를 필수 assertion으로 변경
3. 제조 artifact lineage v1
   - project/document version/generation/verification/artifact/RFQ/quote/order 이후 단일 연결 계약
   - G9 승인 전 상거래 연결 금지
   - RFQ→quote→order→production→inspection→shipment→invoice 순서 강제
   - artifact 변경 시 기존 상거래 참조 제거 및 재승인 강제
4. 렌더 성능 계약
   - 삼각형 수 기준 S/M/L/XL fixture 등급
   - FPS, frame-time p95, draw call 예산 자동 판정
   - `nexyfab:viewport-performance` 구조화 이벤트
   - 뷰포트 성능 상태를 E2E에서 읽을 수 있는 속성 추가

검증 증거:

- locale normalization: 3 tests passed
- manufacturing lineage + 기존 G9: 18 tests passed
- viewport performance budget: 3 tests passed
- 각 묶음 대상 ESLint 통과
- 각 묶음 후 전체 TypeScript typecheck 통과
- 변경 파일 `git diff --check` 통과

다음 진입점:

1. 실제 브라우저에서 canonical redirect와 강화된 Q8 E2E 실행
2. lineage DB migration과 RFQ/quote/order API 강제 적용
3. AI finalization 결과에서 lineage 생성
4. 렌더 S/M/L/XL 실제 모델 fixture와 Playwright 수집
5. `ShapeGeneratorInner` workspace 경계 분리

### 2026-08-07 2차 연속 실행

완료:

1. lineage DB migration v78
   - SQLite와 운영 Postgres에 동일한 `nf_manufacturing_lineage` 계약 추가
   - user/project/document/generation/verification/artifact/release 승인·취소 증거 저장
   - RFQ/quote/order에 lineage와 artifact hash 컬럼 및 인덱스 추가
   - 빈 임시 SQLite에 적용하는 `npm run verify:lineage-migration` 배포 검증 명령 추가
2. RFQ artifact 검증
   - 클라이언트의 승인 주장을 신뢰하지 않고 DB 소유자·승인자·승인 시각·hash·문서 버전 대조
   - 불일치, 취소, 미승인은 409 fail-closed
   - 검토용 RFQ는 lineage 없이 유지할 수 있으나 제조 승인 artifact라고 주장할 수 없음
3. 견적 lineage 상속
   - 파트너 직접 견적과 RFQ dispatch 견적이 RFQ artifact lineage를 그대로 복사
4. 주문 제조 게이트
   - 신규 주문은 본인 RFQ와 G9 승인 lineage 필수
   - RFQ artifact 변경·취소·hash 불일치·직접 주문을 409로 차단
   - 주문 응답과 조회 타입에 lineage/artifact/document version 포함
5. 독립 G9 승인 API
   - `POST /api/admin/manufacturing-lineage`
   - 관리자 권한과 OTP step-up 기본 요구
   - authorize/revoke, immutable conflict, revoked reauthorization 금지
   - 승인·취소 관리자 감사 로그

추가 점검에서 발견한 경계:

- AI finalize의 기존 `release.authorized`는 요청 본문 값이므로 단독으로 서버 DB 승인 근거가 될 수 없다.
- 따라서 finalize 성공과 제조 release 승인을 분리했고, 관리자 승인 API를 거쳐야 RFQ/order가 제조 artifact로 사용한다.
- Next 개발 서버는 Ready 후 `/instrumentation` webpack compile에서 고착되어 실제 Playwright 실행이 아직 불가하다. Sentry/Next instrumentation 개발 빌드 문제를 별도 해결해야 한다.

검증 증거:

- 실제 빈 SQLite migration v78 적용 성공
- lineage contract + DB resolver 테스트 6개 통과
- RFQ/order/partner quote/dispatch/admin approval 대상 ESLint 통과
- 변경 묶음 후 전체 TypeScript typecheck 통과
- 변경 파일 `git diff --check` 통과

다음 진입점:

1. admin 수동 견적 생성도 RFQ lineage를 상속하도록 통일
2. 주문 생성 API route mock/integration 테스트 추가
3. G9 승인 화면과 reviewer evidence UI
4. Sentry instrumentation 개발 서버 고착 해결 후 Playwright 실행
5. 렌더 S/M/L/XL 실제 모델 fixture와 자동 수집

## 21. 2026-08-07 연속 실행 기록 — 랜딩·Q8·번들러 점검

- 랜딩의 대형 `ChatHero`를 동적 청크로 분리하고 접근 가능한 고정 높이 로딩 셸을 추가했다.
- 관리자 수동 견적 응답에도 `lineageId`, `artifactId`, `artifactSha256`, `documentVersionId`를 노출해 DB 저장값과 API 계약을 맞췄다.
- `/ko/** → /kr/**`, `/zh/** → /cn/**`를 middleware뿐 아니라 Next 영구 redirect에도 등록해 라우팅 계층에서 이중 보장했다.
- Q8 E2E가 전문가 CAD 게이트를 누락한 문제를 찾아 `?expert=1`로 실제 작업공간을 열도록 수정했다.
- Chromium 1차 실측은 9개 중 5개 통과. 실패 원인은 Q8 게이트 누락과 Turbopack에서 `replicad`의 Node 내장 모듈(`fs/path`)을 처리하지 못한 번들 오류로 확정했다.
- Turbopack 빈 모듈 alias는 서버 평가 시 안전하지 않아 채택하지 않았다. 현재 배포·E2E 기준 번들러는 기존 Node fallback이 검증된 Webpack을 유지한다.
- 다음 실행 게이트: Webpack 단일 서버 사전 컴파일 → Chromium 단일 worker Q8/locale 재검증 → S/M/L/XL 실측 fixture 수집.

### 21.1 Webpack·Shell 재점검 결과

- Webpack 단일 서버에서 CAD expert 경로는 정상 200으로 완료됐고 최초 컴파일은 65~134초 범위였다.
- Next 개발 서버의 `127.0.0.1` HMR 차단을 `allowedDevOrigins`로 해소했다.
- 서버 게이트와 클라이언트 모드가 서로 다르게 해석하던 `expert=1` 계약을 통일했다.
- 첫 서버/클라이언트 렌더를 `studio`로 일치시키고 mount 후 URL 모드를 적용해 expert deep-link hydration mismatch를 제거했다.
- 현재 Shell의 Inspector DFM 진입점과 전체 DFM 패널을 연결하는 안정적 test id를 추가했다.
- 숨겨진 레거시 toolbar에만 있던 견적 진입을 현재 Shell 상단의 보이는 `Quote` 버튼으로 노출했다.
- Q8의 undo/redo 시나리오는 Chromium에서 통과했고 locale canonical redirect도 통과했다.
- 개발 E2E는 대형 Webpack 최초 컴파일 실측을 반영해 workspace startup 한도를 180초로 조정했다. 운영은 사전 빌드 산출물을 사용하므로 별도 성능 게이트로 측정한다.

### 21.2 프로덕션 Q8 출시 게이트 통과

- Webpack 프로덕션 빌드 성공: 628개 정적 페이지 생성, shared/first-paint 693.0KB로 763.3KB 예산 통과.
- standalone 시작 검증이 비영속 SQLite를 차단하는 것을 확인했고 E2E에서는 워크스페이스 내부 `DATA_ROOT`를 명시했다.
- 프로덕션 Chromium 전체 9개 중 최초 8개 통과 후 RFQ Shell 브리지 결함을 특정했다.
- 간접 DOM 클릭을 제거하고 `nexyfab:open-rfq` 이벤트 → `setShowRfqPanel(true)` 정식 상태 계약으로 교체했다.
- 수정 산출물 재빌드 성공.
- 핵심 Q8 `기본 Box → 3D canvas → DFM → RFQ → 자동저장` 프로덕션 E2E 최종 통과: 37.2초.
- 다음 게이트는 실제 viewport snapshot을 이용한 S/M/L/XL fixture별 FPS·frame p95·draw call 수집이다.

### 21.3 뷰포트 S/M/L/XL 계측 기반 구축 및 1차 발견

- 전문가 경로의 `viewportBenchmark=S|M|L|XL` 진단 장면을 추가했다. 각 장면은 실제 Three.js `BufferGeometry`로 2.5만/10만/50만/110만 삼각형을 GPU에 제출한다.
- HUD 측정값을 Playwright가 `nexyfab:viewport-performance` 이벤트로 수집하고 JSON 증거를 첨부하는 자동 테스트를 추가했다.
- demand 렌더의 유휴 간격을 프레임 지연으로 오인하지 않도록 계측 중에는 연속 프레임을 요청한다.
- 멀티패스 렌더가 `gl.info`를 재설정하는 경우에도 복잡도를 잃지 않도록 실제 scene graph의 visible mesh geometry를 순회해 삼각형 수를 계산한다.
- 일반 CI의 SwiftShader 수치는 GPU 제품 성능을 대표하지 않으므로 CI는 장면·티어·측정 이벤트를 강제하고, `PW_ENFORCE_GPU_BUDGET=1`인 전용 하드웨어 러너만 FPS/p95 예산을 배포 게이트로 사용한다.
- 1차 실행은 기존 계측 결함을 재현했다. HUD가 기본 장면의 8~42 tris만 집계했고 demand idle을 포함해 S가 7 FPS/p95 1189.2ms로 표시됐다. 이 결과는 제품 성능 판정값이 아니라 계측기 결함의 증거이며 위 수정으로 보완했다.
- 격리된 Next 산출물 디렉터리를 지원하도록 `NEXT_DIST_DIR`을 구성과 postbuild 동기화·번들 예산 스크립트에 연결했다. 실행 중 배포 산출물을 잠그지 않고 후보 빌드를 검증할 수 있다.
- 격리 운영 빌드는 628개 페이지 생성과 693.0KB 번들 예산 검사를 통과했다. 다만 두 번째 재빌드에서 Next webpack 내부 `Cannot read properties of undefined (reading 'length')`가 발생했고, 후속 webpack 개발 서버도 준비 전에 종료됐다. 최신 계측 수정의 타입 검사와 대상 ESLint는 통과했지만 4티어 최종 브라우저 재측정은 다음 연속 작업의 첫 게이트다.

다음 실행 순서:

1. Next webpack 비결정 빌드 예외를 재현 로그와 함께 격리하고 빌드 안정화
2. S/M/L/XL에서 삼각형 티어가 각각 정확히 인식되는지 재측정
3. 전용 GPU 러너에서 FPS/p95/draw-call 예산 수집 및 기준선 저장
4. L/XL 초과 시 LOD, instancing, 메시 분할·가시성 컬링 순으로 최적화

### 21.4 릴리스 안정화 및 S/M/L/XL 최종 파이프라인 검증

- 생성된 개발 로그와 빈 PID 파일을 정리했다. 사용자 소스·DB·증거 자료는 제거하지 않았다.
- `ErrorBoundary`의 직접 `@sentry/nextjs` import를 공통 클라이언트 오류 수집기로 이동했고, 공통 수집기는 `@sentry/browser`를 사용하도록 분리했다.
- 전체 TypeScript 검사와 대상 ESLint가 통과했다.
- CAD 커널 품질, Boolean, OCCT thread, STEP 입력 정책, viewport 예산, 제조 lineage, 상용 준비도와 locale 회귀 묶음은 11개 파일 44개 테스트가 전부 통과했다.
- 격리된 첫 운영 빌드가 성공했다. 628개 정적 페이지를 생성했고 shared/worst first-paint 693.0KB로 763.3KB 예산을 통과했다.
- 해당 standalone 산출물에서 Chromium Q8 2개와 S/M/L/XL 계측 4개, 총 6개 운영 E2E가 3.1분에 모두 통과했다.
- S/M/L/XL은 각각 실제 geometry 임계값을 넘겨 올바른 tier로 분류되고 성능 이벤트가 수집됨을 확인했다. 일반 SwiftShader 러너에서는 구조 게이트만 적용하며 실제 FPS/p95 제품 예산은 전용 GPU 러너에서 강제한다.
- 두 번째 클린 빌드는 소스 오류 없이 페이지/manifest 생성까지 진행했으나 standalone trace 단계에서 700초 실행 한도를 초과했다. 따라서 기능 산출물 1회 성공과 운영 E2E는 확보됐지만, "클린 빌드 3회 연속 성공" 배포 기준은 아직 충족하지 않았다.

다음 릴리스 게이트:

1. standalone output tracing 시간을 프로파일링하고 10분 이내로 고정
2. 클린 운영 빌드 3회 연속 성공 기록
3. Redis가 연결된 staging에서 rate-limit 다중 인스턴스 검증
4. 전용 GPU 기준 장비에서 `PW_ENFORCE_GPU_BUDGET=1` 실행
5. 전체 브라우저 매트릭스와 백업·rollback 리허설

### 21.5 standalone 추적 최적화와 3회 연속 빌드 게이트

- 웹 런타임이 참조할 수 없는 대형 디렉터리를 `outputFileTracingExcludes`에 등록했다: `.claude`, `.git`, `src-tauri`, `out`, `out2`, 문서·E2E·테스트 결과 디렉터리.
- 런타임에 필요한 `data`, `public`, OCCT Worker와 서버 소스는 tracing 대상에서 제외하지 않았다.
- 최적화 후 완전 삭제된 격리 디렉터리에서 운영 빌드를 3회 연속 수행했다.
  - 1회: 546.1초
  - 2회: 515.3초
  - 3회: 484.8초
- 세 빌드 모두 628개 정적 페이지를 생성하고 postbuild를 완료했으며 shared/worst first-paint 691.6KB로 763.3KB 예산을 통과했다.
- 세 번째 standalone 산출물에서 Chromium Q8 2개가 51.5초에 통과했다.
- 클라이언트 CAD 경로의 Sentry/Prisma import trace는 제거됐다. 남은 Prisma/OpenTelemetry 경고는 서버 API `eng-chat`의 서버 오류 수집 경로이며 런타임 기능 실패는 아니다.
- 백업 복구 대상명 안전장치와 정확도 후보 생성 Node 테스트 8개, 상용 준비·증거 Vitest 8개가 모두 통과했다.
- 실제 상용 게이트는 현재 환경에서 의도대로 차단됐다. PostgreSQL, Redis, S3, SMTP, Sentry DSN, 결제 provider/webhook, cron secret, Server Action key, 운영 책임자, 최근 복구·결제 리허설·법무 승인, 5개 도메인 승인 증거가 필요하다.
- Firefox/WebKit 매트릭스는 테스트 실행 전 브라우저 바이너리 부재를 확인했다. 자동 설치가 외부 캐시 lock/다운로드 지연으로 10분 내 완료되지 않아 제품 테스트까지 진입하지 못했다.

남은 외부 환경 게이트:

1. Playwright Firefox/WebKit 런타임이 준비된 CI runner에서 Q8 재실행
2. PostgreSQL `_restore_drill` 격리 DB와 실제 최신 backup으로 restore 수행
3. Redis/S3/SMTP/Sentry/결제 webhook이 연결된 staging에서 상용 게이트 PASS
4. 전용 GPU 장비에서 `PW_ENFORCE_GPU_BUDGET=1`로 S/M/L/XL FPS·p95 인증

### 21.6 운영 인프라 인계 자동화

- PostgreSQL 운영 preflight가 SQLite 전용 migration 번호와 오래된 이름을 요구하던 문제를 수정했다. PostgreSQL은 idempotent schema SQL이므로 실제 상용 기능에 필요한 테이블과 컬럼을 직접 검사한다.
- 검사 대상에는 partner invite/동의, escrow, payment attempts, manufacturing lineage와 RFQ·quote·order lineage 컬럼이 포함된다.
- `npm run commercial:preflight`와 `npm run browser:preflight` 명령을 추가했다.
- Playwright Chromium/Firefox/WebKit 실행 파일을 실제 경로로 확인하고 누락된 브라우저별 설치 명령을 출력하는 preflight와 단위 테스트를 추가했다.
- Commercial CAD browser matrix는 설치 직후 해당 브라우저 실행 파일 preflight를 통과해야 OCCT 테스트를 시작한다.
- rollback 대상의 build ID, DB readiness, 실제 OCCT WASM과 SHA-256을 한 번에 검사하는 `npm run rollback:verify`를 추가했다.
- 상용 증거 환경 변수 placeholder를 `.env.example`에 추가했다. 실제 비밀값은 저장소가 아닌 배포 secret에만 입력한다.
- 서비스 소유자가 수행해야 하는 외부 계정·비밀키·결제·복구·GPU·법무·정확도 승인 작업을 `docs/operations/owner-action-checklist.md`로 분리했다.
- 신규 브라우저·복구·rollback·정확도 후보 안전장치 Node 테스트 12개가 통과했고 전체 TypeScript 및 `git diff --check`가 통과했다.
- 현재 로컬 commercial preflight의 실제 blocker는 `DATABASE_URL` 부재다. PostgreSQL staging이 연결되기 전에는 schema capability 검증을 완료할 수 없다.
