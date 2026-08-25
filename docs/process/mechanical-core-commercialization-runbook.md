# Mechanical-core 상용화 실행서

- 정책 버전: v3 적용
- 기준일: 2026-08-12 KST
- 현재 상태·완료 계획: `docs/strategy/ai-mechanical-cad-current-status-and-completion-plan-260811.md`

## 1. 제품 경계

`mechanical-core`는 NexyFab의 주력 제품이다. AI 기계 설계와 정밀 CAD는 하나의 revision-bound Mechanical Design Graph를 편집한다.

- 기계 부품과 제한된 조립체: `mechanical-core`
- 로봇과 제품군별 복잡 조립체: 별도 `robot-verified-systems` 또는 family release
- 건축·토목·조경·인테리어: `spatial-labs`

공간 Labs와 범용 복잡 제품의 미완성 증거가 기계 코어 출시를 차단해서는 안 된다.

기본 서비스는 외부 CAD 설치를 요구하지 않는다. NexyFab 자체 커널, NFAB와 표준 STEP이 기본 실행 경로다. SOLIDWORKS·Fusion·Onshape 제품별 C4 검증은 특정 제품 이름을 사용한 인증·Enterprise 계약이 있을 때만 선택적으로 수행한다.

## 2. 현재 구현 기준선

관련 소스가 바뀐 뒤 다음 명령으로 코드·커널 기준선을 다시 만든다.

```powershell
npm run mechanical:verify:internal
npm run mechanical:scope:generate
npm run mechanical:scope:check
```

2026-08-12 최신 공식 재검증은 11파일 89테스트, 기계 정확도 9파일 49테스트와 전체 typecheck를 통과했다. 내부 receipt는 다음을 결속한다.

- Mechanical Design Graph의 lossless revision과 patch
- 핵심 30개 피처의 실제 runtime 경로
- NFAB 3회 persistence
- OCCT STEP export/re-import 3회
- 기계 accuracy suite와 typecheck
- importer/exporter source, package lock와 WASM hash

내부 receipt는 실제 제조, 실제 운영 또는 사람의 최종 승인으로 자동 승격되지 않는다.

## 3. 증거 정책 v3 적용 상태

채택한 v3 정책은 다음과 같다.

1. 외부 상용 CAD 3종 C4를 기본 출시 조건에서 제거한다.
2. 외부 독립 CAD 원본 20/32건을 기본 출시 조건에서 제거한다.
3. NexyFab이 직접 설계한 30개 실제 제품 case와 잠금된 내부 blind review를 사용한다.
4. 절삭·판금·적층의 실제 제조 3건은 유지한다.
5. 외부 기관 대신 구현자에서 분리된 내부 검토자와 위험 기반 이중 승인을 허용한다.

`mechanical-product-scope-assessment.v4`와 commercialization gate에는 이 정책이 반영됐다. v4는 150개 로컬 의도 입력 자격 검증, 10개 대표 설계·70개 정확 런타임 축, 조립도면 로컬 인계를 상용 30개 설계·150개 의도 캠페인과 별도 필드로 기록하며, 앞의 내부 PASS가 뒤의 상용 검증을 대신하지 못하게 한다. 제품별 상용 CAD 검증은 기본 blocker가 아니며, `twenty_blind_product_challenges_required`는 외부 기관 20건이 아니라 요구사항이 사전 동결되고 구현자와 검토자가 분리된 내부 blind challenge 20건을 뜻한다. 현재 blocker는 schema 전환 대기가 아니라 실제 artifact가 0건이라는 사실이다.

2026-08-25 현재 v4 정책과 8개 직접설계 artifact 역할을 반영한 새 공식 scaffold를 다음 저장소 외부 작업공간에 생성했다. 2026-08-12 루트는 `verificationReceipt` 경로가 없는 역사 자료이므로 보존하되 새 campaign 입력으로 사용하지 않는다.

- 현재 루트: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4`
- 직접 설계: 30 case, eligible 0
- blind challenge: 20 case, eligible 0
- 제조 pilot: CNC·판금·적층 3 case, eligible 0

workbook은 폴더와 요구 artifact 경로만 만든다. 실제 STEP·NFAB·도면·BOM·사진·실측·서명은 생성하지 않는다.

다음 행위는 금지한다.

- JSON assessment를 손으로 PASS로 수정
- synthetic fixture를 실제 설계·제조 evidence로 표기
- legacy schema의 의미를 바꾸면서 schema version을 유지
- 외부 검증을 하지 않았는데 `independently verified`라고 홍보

## 4. 핵심 30개 직접 설계 campaign

상용 30개 목록은 `src/lib/ai/mechanicalCoreFeatureContract.ts`로 고정한다. 각 피처는 제조 맥락을 가진 서로 다른 기준 설계에 결속한다.

실행기는 다음처럼 호출한다. adapter는 `executeMechanicalDesignCase`를 export하고 실제 제품 runtime을
호출해야 하며, fixture나 synthetic artifact를 상용 증거로 생성해서는 안 된다. 중단 후에는 같은 명령에
`--resume`을 추가한다. 일부 case만 먼저 실행하려면 `--cases=design-01-hole,...`을 지정한다.

실행 전 비파괴 preflight는 workbook, 240개 필수 파일 슬롯, 역할이 분리된 Ed25519 검증자, adapter 파일 존재를 확인한다. adapter를 import하거나 실행하지 않고 state·receipt·evidence도 쓰지 않으며, 준비되지 않은 경우 blocker를 출력하고 종료 코드 4를 반환한다.

```powershell
node scripts/run-mechanical-direct-design-campaign.mjs --preflight `
  --workbook=C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4\direct-design\mechanical-direct-design-workbook.json `
  --adapter=<trusted-runtime-adapter.mjs>
```

```powershell
node scripts/run-mechanical-direct-design-campaign.mjs `
  --workbook=C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4\direct-design\mechanical-direct-design-workbook.json `
  --state=C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4\direct-design\campaign-state.json `
  --adapter=<trusted-runtime-adapter.mjs> `
  --receipt=docs/evidence/release/mechanical-direct-design-campaign-receipt.json
```

실행기는 artifact 자체를 만들지 않는다. adapter 실행 뒤 workbook에 고정된 경로에서 실제 bytes를 읽고,
manifest·revision·requirements·intent 결속을 검증한 경우에만 case를 `pass`로 기록한다. 요구사항이나
사람의 CAD 수정·도면 release가 없으면 해당 case는 `pending` 또는 `fail`에 남겨야 한다.

### 필수 입력

- case ID와 unique lineage
- 자연어 요구사항과 authoritative dimensions
- 단위, 재료, 공정과 허용 공차
- 잠금값과 변경 가능한 값
- 예상 body/occurrence 수와 제조 핵심 치수
- 수행해야 할 음성 대조군

### 필수 실행

1. 자연어에서 intent와 requirements 생성
2. 실제 B-Rep 생성과 kernel validity 검사
3. 사람의 정밀 CAD 수정
4. revision-bound AI patch 적용
5. NFAB 저장·복원 3회
6. STEP export/re-import 3회
7. 형상, 단위, body, 핵심 치수와 lineage 비교
8. 도면·BOM·STEP package 생성과 revision hash 결속

### 통과 조건

- 30/30 case complete
- stable ID와 잠금값 drift 0
- silent topology/selection remap 0
- invalid 또는 empty B-Rep 0
- body/occurrence와 단위 불일치 0
- case별 STEP 허용치 초과 0
- 필수 검사가 `not_run`인데 통과로 표시된 case 0

큰 artifact는 저장소 밖의 통제 디렉터리에 저장하고 저장소에는 redacted manifest와 hash-bound receipt만 둔다. 통제 루트는 `NEXYFAB_MECHANICAL_CONTRACT_EVIDENCE_ROOT`를 사용한다.

## 5. 20개 blind product challenge

30개 피처 case는 기능 단위 증거이고, 20개 blind challenge는 실제 사용자 요구사항 완주 증거다.

- 구현자가 결과 형상을 보며 요구사항을 수정하지 않는다.
- 요구사항, 기대 기능, 필수 치수와 거부 조건을 실행 전에 잠근다.
- AI 생성, 자동 검증과 사람 검토를 분리한다.
- 일반 15건은 자동 검증과 한 명의 내부 검토자를 요구한다.
- 하중·운동·안전 영향이 있는 5건은 서로 다른 두 역할의 승인을 요구한다.
- 외부 검토자가 아니면 `independent external validation`이라고 부르지 않는다.

보고 지표는 평균 하나로 합치지 않는다.

- intent 정확도
- requirement coverage
- geometry 생성 성공률
- required gate coverage
- revision/artifact 일치
- false-verified
- bounded repair 성공률

## 6. STEP conformance

기본 호환 계약은 특정 상용 CAD 제품이 아니라 다음 NexyFab STEP conformance다.

- 단위와 좌표계
- 유효 solid/B-Rep
- body와 assembly occurrence
- product structure와 이름
- 형상 signature, bounding box, volume와 surface
- 허용 범위 내 healing과 topology 변화
- revision/source artifact 결속
- 3회 export/re-import

STEP은 vendor-native feature history 호환을 의미하지 않는다. 마케팅은 `표준 STEP 교환`으로 제한한다.

제품별 상호운용성 검증을 별도로 수행하는 경우 결과를 `optional interoperability profile`로 저장하고 기계 코어 기본 PASS와 합치지 않는다.

## 7. 실제 제조 3건

필수 공정은 다음 세 가지다.

1. CNC 절삭
2. 판금
3. 적층 제조

제조 v3 schema와 scope gate는 CNC·판금·적층 세 공정을 명시적으로 요구한다. 과거 v1/v2 receipt는 v3 PASS로 재해석하지 않는다.

각 실제 case는 다음 bytes를 결속한다.

- NFAB와 STEP
- released drawing와 BOM
- 제조 주문 또는 내부 작업 기록
- 실제 inspection report
- 사진
- 재작업과 승인되지 않은 CAD 변경 기록

최소 세 개의 critical measurement가 case별 허용 공차 안에 있어야 한다. 실물이 없으면 manufacturing release는 false다. 직접 제작과 직접 검사를 허용하지만 설계자와 최종 판정 역할은 분리한다.

## 8. 운영 및 릴리스

private beta 전:

- clean commit와 재현 build
- 기계 핵심 집중 테스트와 typecheck
- 우선 10개 실제 package
- false-verified 0
- Redis 기반 quota fail-closed
- 24~72시간 candidate 관찰

GA 전:

- 30/30 실제 package
- 20개 blind challenge
- 제조 3건 실측
- 7일 web/worker 운영
- backup/restore, migration, security와 authenticated E2E
- 결제·환불·지원·사고 대응 절차
- 현재 commit, build, deployment, rollback와 image digest 결속

현재 운영 receipt는 6시간·1개 표본이며 웹 메모리 883.2MB가 768MB 정책 한도를 초과한다. 새 7일 campaign 전 메모리 사용량을 낮추거나 근거 있는 배포 한도를 확정한다.

## 9. gate/schema v3 완료 상태

다음 변경은 코드와 schema에 완료됐다.

1. `mechanical-core` readiness에서 상용 CAD C4 hard blocker 제거
2. external 20-case receipt를 blind internal challenge receipt로 대체
3. 30개 실제 artifact manifest, schema와 validator 추가
4. STEP conformance receipt를 제품별 optional profile과 분리
5. 제조 schema를 CNC·판금·적층 3건으로 버전업
6. release gate가 이전 receipt를 v3 PASS로 오인하지 않도록 version fail-closed
7. pending-only scaffold와 overwrite 방지 구현

남은 작업은 schema 개발이 아니라 workbook에 실제 증거를 채우는 것이다. current assessment는 clean release commit에서 모든 source hash와 함께 다시 생성한다.

## 10. 로컬 7축 증거 실행과 판정

로컬 OCCT 폐쇄 루프는 상용 검증과 분리한다.

```text
npm run mechanical:features:local:run
npm run mechanical:features:local:refresh
npm run mechanical:features:local:check
npm run mechanical:features:local:gate
```

- `local:run`은 등록된 실제 B-Rep 실행기만 호출해 축별 artifact를 다시 만든다.
- `local:refresh`는 파일의 SHA-256과 byte 길이를 재검산해 현재 readiness를 쓴다.
- `local:check`는 receipt 최신성만 확인한다. 미완성 피처가 있어도 최신 `HOLD`라면 성공할 수 있다.
- `local:gate`는 30개 피처의 7개 축이 모두 PASS일 때만 성공한다.
- candidate unit test, 표시용 mesh, preview 형상, 과거 receipt는 축 PASS로 승격하지 않는다.
- 로컬 gate가 PASS해도 독립 STEP C4, blind product challenge, 실제 제조와 외부 검토를 대체하지 않는다.
