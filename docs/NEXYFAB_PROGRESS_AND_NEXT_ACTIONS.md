# NexyFab 진행 현황 및 다음 작업

- 기준일: 2026-08-12 KST
- 주력 제품: AI 정밀 기계 CAD
- 확장 제품: Robot Verified Systems, 기계 계열 복잡 제품
- 보조 서비스: Spatial Labs—건축·토목·조경·인테리어
- 현재 출시 판정: **소프트웨어 후보 검증 완료 / Private Beta 차단 / GA 차단**
- 상세 상태 정본: `docs/NEXYFAB_COMMERCIALIZATION_CURRENT.md`

이 문서는 현재 진행률과 다음 실행 순서만 빠르게 확인하는 활성 체크리스트다. 코드가
있다는 사실, 테스트가 통과했다는 사실, 실제 설계·제조·운영 증거가 있다는 사실을 서로
바꾸어 쓰지 않는다.

## 1. 상태 표기

| 표기 | 의미 |
|---|---|
| 완료 | 구현과 지정된 코드 검증이 끝남 |
| 소프트웨어 검증 | 코드·테스트·빌드가 통과했지만 실물 또는 독립 증거는 아직 없음 |
| 증거 대기 | 실행 틀은 있으나 실제 artifact·측정·서명이 없음 |
| 차단 | 다음 출시 단계로 승격할 수 없음 |

## 2. 한눈에 보는 현재 상태

| 영역 | 현재 상태 | 정확한 판정 | 다음 종료 조건 |
|---|---|---|---|
| AI 정밀 기계 CAD 코어 | 소프트웨어 검증 | 30피처 계약, 실제 형상 경로, NFAB/STEP 3회 왕복, revision 결속 구현 | 우선 직접 설계 10/10과 false-verified 0으로 Private Beta 후보 승격 |
| 전체 직접 설계 | 증거 대기 | workbook 30건, 실제 완료 0/30 | 30/30 package와 150/150 intent 판정 |
| Blind product challenge | 증거 대기 | 잠금형 workbook 20건, 실제 완료 0/20 | 구현자와 분리된 검토, 고위험 5건 이중 승인 |
| 제조 검증 | 증거 대기 | CNC·판금·적층 schema와 workbook 준비, 실제 완료 0/3 | 각 1건 실물, 측정, 사진, as-built·revision hash 결속 |
| 운영 검증 | 차단 | 6시간 단일 표본만 존재하며 7일 receipt 없음 | Redis 포함 실제 배포 7일, 백업·복구·롤백·비용 receipt |
| Robot Verified Systems | 소프트웨어 검증 | 계산·증거·감사·22부품 적용 및 사후검증 체인 구현 | 실제 catalog 22개, 실제 r+1, 27개 물리 subject와 이중 서명 |
| 일반 복잡 제품 | 소프트웨어 검증 | Graph v2, 제품군별 계약·캠페인·릴리스 채널 구현 | 제품군별 승인 case 20건과 실제 제작·시운전 |
| Spatial Labs | 보조 서비스 | 기계 출시 게이트와 분리됨 | 별도 Beta 지표로 운영 |
| 릴리스 기준선 | 차단 | 현재 작업트리 482건—deployable 438, documentation 30, evidence 14, protected/temporary 0 | 사용자 변경을 보존한 검토 가능한 clean RC와 재현 build |

## 3. 완료된 구현

### 3.1 AI·정밀 CAD

- 기계 핵심 30피처의 명시적 계약과 runtime 형상 생성 경로
- lossless Mechanical Design Graph, stable ID, revision과 patch 결속
- NFAB 저장·복원 3회와 OCCT STEP export/re-import 3회 검증 계약
- 정밀 선택 편집, mate/DoF, 간섭, 연속 운동 검사
- drawing·BOM·STEP manufacturing package와 release certificate의 fail-closed 경계
- STEP을 기본 외부 교환 계약으로 채택하고 vendor-native feature history와 구분
- SOLIDWORKS·Fusion·Onshape 설치 또는 제품별 C4를 기본 출시 blocker에서 제외

### 3.2 로봇·복잡 제품

- Robot 요구사항, 동역학, 열, 수명, 강성, 정밀도, compliance 계산 계약
- payload 0·정격·편심과 governed path 조합의 재계산 및 stale evidence 차단
- 연속 충돌, workspace coverage, 케이블 bend/twist/flex-life, 안전·전기 evidence
- 구동계 18개와 brake·encoder·harness·tool connector 4개의 strict admission
- 29 part·68 mate·22 catalog occurrence·unresolved 0 목표 적용 계약
- application·receipt·program·revision·target hash의 교차 결속과 실제 r+1 사후검증
- joint rig → wrist → 6축 prototype → endurance/teardown의 27개 물리 검증 subject
- 서버 Ed25519 감사 v2, final review, release false 기본값
- Complex System Graph v2와 Gearbox·Machine/Skid·Welded/Enclosure 전용 계약
- change-impact engine과 20/100/500/1,000 occurrence 검증 계약
- 기계 코어 7제품군의 독립 `verified-*` 릴리스 채널과 제품군별 승격

### 3.3 상용 서비스 기반

- 개인·조직별 프로젝트, 파일, 사용량, AI 비용, AI 이력, 리뷰 격리
- release → RFQ → quote → order → inspection의 revision-bound 거래 계보
- 주문·결제·환불·검사 접근 제어
- 중앙 session probe와 게스트 notification/refresh 연쇄 4xx 제거
- 기계 우선 IA, 모바일 핵심 흐름, 명암 접근성 보정
- 게스트 네트워크 계약 E2E와 핵심 axe·responsive 회귀

## 4. 최근 검증 기준선

| 검증 | 결과 |
|---|---:|
| 전체 Vitest | 8/8 shard, 27,218 pass, 0 fail |
| Node 전체 테스트 | 326 pass, 0 fail, Windows symlink 권한 1 skip |
| 기계 코어 직접 검증 | 11파일, 89테스트 통과 |
| 기계 정확도 | 9파일, 49테스트 통과 |
| Robot Verified Systems | 64파일, 265테스트 통과 |
| 일반 복잡 조립체 | 13파일, 104테스트 통과 |
| 제품군 benchmark·campaign·release | 6파일, 33테스트 통과 |
| TypeScript | 전체 통과 |
| ESLint | 전체 `src` 오류 0 |
| 최신 로컬 production-mode build | PASS—Webpack compile 9.8분, postbuild 완료 |
| 번들 예산 | shared 723.5/795.7KB, worst first-paint 1764.0/1851.5KB |
| CAD API 통제 | 83 route files, 85 handlers, issue 0 |
| 라우트 보안 | 607 route files, 837 handlers, gap 0 |
| 비밀정보 스캔 | 7,657파일 / 88,863,058 bytes, finding 0 |

공식 전체 build 뒤 추가된 작은 campaign scope·상용 gate 조정은 관련 테스트, 타입 검사와
lint를 통과했다. 최종 clean RC에서는 전체 build와 모든 증거 hash를 다시 결속해야 한다.

## 5. 아직 완료하지 않은 실제 증거

다음 항목은 구현 또는 scaffold가 있어도 완료로 계산하지 않는다.

- 직접 설계: 우선 0/10, 전체 0/30
- 30피처 외부 artifact 폐루프: 0/30
- AI intent 평가: 0/150
- 내부 blind product challenge: 0/20
- CNC·판금·적층 제조 파일럿: 0/3
- Redis 실제 배포 7일 운영: receipt 없음
- 로봇 실제 제조사 catalog CAD·datasheet·license 22개: receipt 없음
- 로봇 실제 r+1·joint rig·wrist·6축·endurance 계측: receipt 없음
- 복잡 제품 v2 corpus: 88건 inventory, 승인 0/88
- 기계 복잡 제품 7제품군: 68/140 inventory, 승인 0/68, 부족 72건

`pending`, fixture, synthetic benchmark, 자체 신고 hash는 실제 설계·제조·독립 승인으로
승격하지 않는다.

## 6. 다음 작업—점검 → 구현 → 검증·조정 → 다음 단계

### P0. 직접 설계 실행 경로 닫기

> **2026-08-12 점검·수정:** `scripts/run-mechanical-direct-design-campaign.mjs`에
> 실제 artifact bytes 기반 campaign executor를 추가했다. workbook·state hash 결속,
> 원자적 checkpoint, 선택 case 실행, 실패 후 재개, 완료 case 무재실행, 경로 이탈·symlink·artifact
> 변조 차단, manifest·intent 의미 검증을 fail-closed로 적용했다. Node 회귀 5건이 통과했다.
> 외부 작업공간에는 authoritative requirements와 실제 NFAB/STEP/도면/BOM이 아직 없으므로
> 실제 완료 수치는 계속 0/30이며, synthetic 파일로 첫 case를 채우지 않는다.

#### 점검

- `mechanical-direct-design-workbook.json` 30건과 30피처 계약을 1:1 대조한다.
- 각 case의 requirements, NFAB, STEP, drawing, BOM, manifest, intent 판정 경로를 확인한다.
- 현재 validator·scaffold와 실제 생성 runtime 사이의 자동 실행 공백을 확인한다.

#### 구현

- 중단·재개 가능한 직접 설계 campaign executor를 구현한다.
- executor는 실제 runtime 출력 bytes만 수집하고 synthetic artifact를 증거로 만들지 않는다.
- requirements 선잠금, source/output revision, artifact hash, case state를 결속한다.
- 자동 검사는 수행하되 수동 CAD 수정, drawing release, reviewer 승인은 `not_run`으로 남긴다.
- 이미 존재하는 파일을 기본적으로 덮어쓰지 않고 case 단위 재개를 지원한다.

#### 검증·조정

- 변조, 누락, stale revision, 중복 case, partial resume를 fail-closed 테스트한다.
- 첫 1건을 end-to-end로 실행해 NFAB/STEP 실형상과 drawing/BOM package를 확인한다.
- 실패 원인을 형상 생성·의도 해석·export·drawing·검토로 분류하고 bounded repair만 허용한다.

#### 다음 단계 진입 조건

- executor 회귀 통과, 실제 case 1건이 release 미승인 상태로 정직하게 생성됨
- 이후 우선 10건 campaign 시작

### P0.5. 복합제품 Web·MCP 경로 정합성

> **2026-08-12 상세 점검·수정:** 실제 Chrome DevTools MCP로
> `/kr/shape-generator/assembly/?expert=1`에 진입해 AI 패널을 열고
> `complex-verified-systems` 마운트까지 확인했다. 최종 재검증에서 manifest, session,
> assembly 동적 chunk를 포함한 네트워크 요청은 모두 200/304였고 콘솔 메시지는 0건이었다.

- 중복 소유하던 `src/app/manifest.ts`와 `public/manifest.webmanifest` 중 공용 정적 manifest를
  정본으로 남겨 `/manifest.webmanifest` 500을 제거했다.
- 복합 시스템 라우트의 150/300/500 MB 계약보다 작은 Proxy 16 MB 정책과 Next 64 MB
  body buffer를 각각 라우트 한도와 500 MB로 정렬해 multipart truncation을 제거했다.
- CAD Proxy 인증을 JWT 전용 검사에서 공용 account-backed 인증으로 전환해
  `nf_live_*` API Key의 DB hash, 만료, IP allowlist, 계정 잠금·삭제, 현재 plan을 검증한다.
  검증 후 원본 Authorization 값은 하위 라우트로 전달하지 않는다.
- CAD capabilities와 drawing-to-3d MCP에 복합 graph, gearbox, machine/skid,
  welded/enclosure, change-impact, scale의 6개 multipart 도구를 공개했다. 파일 수·개별 크기·
  총량·중복 basename·읽기 실패를 원격 전송 전에 fail-closed로 검사한다.
- 웹 패널은 canonical `kr`에서도 한국어를 사용하고, reverse proxy가 HTML 또는 빈 응답을
  반환해도 JSON parse 예외 대신 HTTP 상태가 포함된 안전한 오류를 표시한다.

로컬 계약과 브라우저 경로는 닫혔지만 실제 배포 DB에서 발급한 API Key로 6개 도구를 호출한
receipt, 배포 reverse proxy의 대용량 업로드 실측, 실제 복합제품 artifact bundle 검증은 아직
없다. 이 세 항목 전에는 MCP/Web 복합제품을 운영 검증 완료로 승격하지 않는다.

### P1. 기계 Private Beta 후보

1. 직접 설계 10건을 실제 요구사항에서 끝까지 실행한다.
2. 각 case에서 intent → feature graph → 정밀 수정 → NFAB/STEP 3회 → drawing/BOM → review를 기록한다.
3. silent topology drift, false-verified, 누락 필수검사 0을 확인한다.
4. clean RC에서 전체 테스트·빌드·보안·secret scan을 다시 실행한다.
5. 10/10과 gate PASS 전에는 Private Beta로 표시하지 않는다.

### P2. 기계 Commercial Candidate

1. 직접 설계를 30/30으로 확장한다.
2. 핵심 30피처 각각의 실제 artifact 폐루프를 3회 완료한다.
3. case당 5개 intent 범주를 평가해 150/150 판정을 만든다.
4. 잠금형 blind challenge 20건을 실행한다.
5. 고위험 5건은 서로 다른 두 역할의 승인을 받는다.
6. STEP conformance receipt를 vendor 이름과 무관한 표준 계약으로 확정한다.

### P3. 제조·운영 GA 증거

1. CNC 절삭, 판금, 적층을 각 1건 실제 제작한다.
2. NFAB·STEP·도면·BOM·공정·측정·사진·서명을 동일 revision hash에 결속한다.
3. candidate 환경을 24~72시간 관찰해 메모리 한도와 장애를 조정한다.
4. Redis가 연결된 실제 web/worker 환경에서 7일 운영한다.
5. 지연, 오류, 비용, quota, backup/restore, migration, rollback receipt를 남긴다.

### P4. Robot Verified Systems 실증

1. 구동 18개와 보조 4개의 실제 제조사 CAD·datasheet·license를 확보한다.
2. admission을 통과한 정확한 catalog로 r+1을 다시 생성한다.
3. 29 part·68 mate·22 occurrence·unresolved 0과 전체 payload/path 계산을 재실행한다.
4. joint rig·wrist·6축 prototype·endurance/teardown 27 subject를 실제 계측한다.
5. raw data, calibration, as-built BOM, exact CAD와 제조 evidence를 audit v2에 결속한다.
6. 구현자와 분리된 전문가 이중 서명 전에는 `Verified`를 허용하지 않는다.

### P5. 복잡 제품군 독립 승격

다음 제품군을 서로의 증거를 빌리지 않고 별도 승격한다.

1. robot
2. gearbox
3. pressure vessel
4. turbomachinery
5. factory equipment
6. machine/skid
7. welded frame/enclosure

각 제품군의 순서는 approved golden → blind → 제조 가능한 package → 실제 제작·조립·시운전
→ 24-run 대규모 회귀다. 제품군별 최소 20건, 승인·lineage·accuracy를 충족한 family만 해당
`verified-*` 채널로 승격한다.

## 7. 병렬 실행 묶음

의존성이 없는 작업은 다음 네 묶음으로 병렬화한다.

| 트랙 | 즉시 실행 | 외부 입력 의존 |
|---|---|---|
| A—소프트웨어 | 직접 설계 executor, resume·tamper 테스트, clean RC 정리 | 없음 |
| B—설계 증거 | 직접 설계 10→30, 150 intent, blind 20 | 분리된 검토자 |
| C—제조·운영 | 제조 3건 준비, Redis 7일 관찰 자동화 | 공장·실물·배포환경 |
| D—Verified Systems | catalog 22 획득 packet, 제품군 case 수집·격리 | 제조사 자료·시제품·전문가 |

트랙 A가 artifact와 receipt 계약을 고정한 뒤 B·C·D가 동일 revision/hash 규칙을 사용한다.

## 8. 즉시 실행 체크리스트

- [x] 작업트리 482건의 deployable/documentation/evidence/protected/temporary manifest와 SHA 생성
- [ ] deployable 438건의 기능·보안·사용자 변경 소유권을 검토해 clean RC 구성
- [x] 직접 설계 campaign executor 구현
- [x] executor tamper·resume·partial failure 회귀
- [x] 복합제품 Web·MCP 로컬 계약·브라우저 경로 정합성
- [ ] 배포 API Key·실제 복합 artifact·대용량 reverse proxy receipt
- [ ] 직접 설계 첫 실제 case end-to-end
- [ ] 우선 직접 설계 10/10
- [ ] clean RC 전체 build·보안·secret·gate 재결속
- [ ] 직접 설계 30/30과 intent 150/150
- [ ] blind challenge 20/20
- [ ] CNC·판금·적층 3/3
- [ ] Redis 실제 배포 7일
- [ ] Robot catalog 22와 실제 r+1
- [ ] Robot 27 subject 실측·이중 서명
- [ ] 기계 복잡 제품 부족 72건 획득·승인
- [ ] 제품군별 `verified-*` 독립 승격

## 9. 실행 위치

- 저장소: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
- 외부 증거 루트: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260812`
- 직접 설계 workbook: `direct-design\mechanical-direct-design-workbook.json`
- blind workbook: `blind-challenges\mechanical-blind-product-challenge-workbook.json`
- 제조 workbook: `manufacturing-pilots\mechanical-manufacturing-pilot-workbook.json`
- 기계 실증 절차: `docs/process/mechanical-core-commercialization-runbook.md`
- 로봇 실증 절차: `docs/process/robot-verified-product-runbook.md`

## 10. 출시 표현 원칙

- 현재 허용: `AI 정밀 기계 CAD 소프트웨어 후보`, `Engineering Analysis`, `표준 STEP 교환`
- 증거 전 금지: `상용 완성`, `제조 검증 완료`, `독립 검증 완료`, `Robot Verified`
- `Verified`는 특정 revision의 실제 artifact, 실물 측정, 승인과 audit receipt가 모두 결속된 경우에만 사용한다.
