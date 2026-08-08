# 3D 정확도 95% 달성 계획 — 기계설계~인테리어 5분야 (2026-08-08)

상위 문서: [commercial-readiness-assessment-260808.md](./commercial-readiness-assessment-260808.md) Phase 4의 상세 실행판.
범례: **👤 = 사용자 권한/외부 인력 필수** · 🤖 = 에이전트 수행 · 👤+🤖 = 사용자가 열쇠를 만들면 에이전트가 완주.

---

## 0. "95%"의 정의 (이미 코드로 고정된 계약 — 변경하지 않는다)

`assessDomainAccuracy` + `buildDomainAccuracyEvidence` 기준(전부 fail-closed):

- 도메인별 **승인 케이스 ≥20** — 각 케이스는 sourceHash 결속 ground truth + **독립 리뷰어 ≥2인** 승인
- **3캠페인 × 5반복 = 케이스당 15런**, `usedForTuning=false` 강제(홀드아웃 튜닝 오염 금지)
- 도메인 프로파일의 **모든 필수 축**(기계 14축: requirements·dimensions·features·part_definitions·occurrences·body_membership·hierarchy·transforms·joints·motion·collision_clearance·manufacturing·step_roundtrip·repair)에서 **micro/macro 정확도 ≥0.95 AND 커버리지 ≥0.95**
- required gate 통과율 100%, **falseVerified=0 · falseClear=0 · destructivePartMerge=0**
- 5개 도메인 전부 위를 충족해야 상용 release gate가 열림 (`domain-accuracy-certification.yml`)

**현재 상태의 정직한 표현: 정확도 수치는 아직 "존재하지 않는다."** 자기채점 회귀(284 tests: mech 38·civil 70·building 62·landscape 53·interior 61)는 전부 그린이지만, 이것은 회귀 방지선이지 정확도 측정이 아니다. 승인 케이스 0/도메인·리뷰어 0명·캠페인 0회.

## 1. 갭 분석 — 95%를 막는 실제 원인 3층

### 1층: 기하 커널의 알려진 결함 (dimensions·features 축 직결) — 전부 🤖

| ID | 결함 | 실측 근거 | 영향 축 |
|---|---|---|---|
| K1 | **shell face-pick 벽 오프셋 오류**: 폴리라인 컨투어 extrude에 shell(-2) 시 한쪽 X벽이 4mm(2배) — 체적 +10.6% | REF-PART 1 [major] finding, 테스트가 용인 중 | dimensions, manufacturing |
| K2 | **mesh fallback boolean/fillet 크래시** `reading 'array'` (속성 불일치) — OCCT 폴백 경로가 죽음 | REF-PART 1 f-fillet, 260808 boss union 조사에서 재확인 | features, repair |
| K3 | **replicad shell이 extrude된 B-rep에서 throw** → mesh shell 폴백 상시화 | occtCorpus seed `shell-on-extruded-brep`=fail-clean 기대 | features, step_roundtrip |
| K4 | **compose 구멍 위치 미부여**(개수만) — 도면·검증에서 위치 검증 불가 | 방법론 문서·2D 도면 정직 표기 | dimensions, manufacturing |
| K5 | 2D 도면 = 치수 사양표 수준, **진짜 HLR 투영 치수선 없음** | manufacturing_drawing capability | manufacturing |
| K6 | **joint IR 갭**: 비-revolute 조인트 미컴파일, 스윕 인증은 revolute만 | P2 기록 (jointMotionClearance) | joints, motion |
| K7 | 에지 참조 안정성(topo naming) — 리빌드 시 silent wrong entity 위험 | ADR-017 K2.2 spike 측정 존재 | features, repair |

### 2층: ground truth 공급 (측정의 원료) — 병목은 👤

- 복합제품 홀드아웃 **추출 31/88** — 잔여 57건은 전부 외부 네이티브 워커 종속(SolidWorks 9·DWG/ODA 11·Revit 5·Inventor 2·Creo 1). 로컬에서 더 못 올림(감사 고정: `local_executor_available=0`)
- **승인 0/88** — 독립 리뷰어 2인 체계가 아직 없음. **이것이 95% 증명의 최장 리드타임 항목**
- 후보 생성기·검토 패킷·캠페인 러너·리포트·promote 도구는 260808에 전부 커밋됨(가동 준비 완료)

### 3층: 검증 그물의 사각 — 🤖

- VerifyNet 6겹(체크포인트·manifold·역투영diff·간섭·vision·FEA)은 있으나 **축 단위 자동 assertion**과의 연결이 케이스 계약(`domainValidatorAssertions`)에 이제 막 들어감 — 실제 캠페인에서 falseVerified=0을 지키려면 각 축의 판정기가 "모르면 not_run"을 정확히 뱉어야 함(날조 금지 원칙 유지)

## 1.5 진행 현황 (260808 루프 세션 — 지속 갱신)

| 항목 | 상태 | 증거 |
|---|---|---|
| K1 shell 벽 오프셋 | ✅ 완료 | refpart1 4/4, 체적 29472 정확, f-fillet 연쇄 해소 |
| K2 mesh 폴백 크래시 | ✅ 완료 | 정본 헬퍼 16개소 배선, related 830 |
| K3 B-rep shell 경로 | ✅ 완료 | corpus 시드 3개 fail-clean→ok 승격 |
| K4 구멍 실체화 게이트 | ✅ 완료 | 파서+게이트 교정루프 편입, unmetHoles 정직 표면화 |
| K5 도면 치수 | ✅ v1(체크포인트)+심화(HLR 실투영+해석 치수) | ⌀8×2·위치 25/75 실증 — 웹 배선 후속 |
| K6 joint IR | ✅ 완료 | prismatic 해석 5mm/20±2mm, cylindrical 단면 스윕 |
| K7 topo naming | ✅ 판단 완료(ADR-017 accepted — A안 전 시나리오 오매칭 0%) / **승격 잔여**: 브라우저 피처 경로(chamfer·fillet·occtFilletAvoidance·refRelink)가 아직 B안(edgeCorrespondence), 커널 브리지엔 A안 resolvePickedEdges 존재 — 배선 이전이 다음 큰 덩어리 |
| M2 후보/패킷 | ✅ 드라이런 코퍼스(인증 불가 명시) + CLI 4종 기동 결함 수정 |
| 스케일(N·레벨) | N1 IR·N2 B-L2·N5 브로드페이즈+20k·B-L3·C-L3(±3% 구배)·A-L2·D-L3 완료, 3D OBB SAT 상시 |

### 1.6 K7 승격 로드맵 (260808 스코핑 — 다중 세션 P0)

실측: System A(생성-이력 명명)는 `nodeOcctBridge.ts` 내부에만 존재(topoNaming·composedTopo·resolvePickedEdges). 브라우저 워커(`occt-worker-real.js`)는 관련 코드 0줄 — 브라우저 피처 4종(chamfer·fillet·occtFilletAvoidance·refRelink)은 B안(edgeCorrespondence 기하 서명, S2 생존 59.6%)에 묶여 있다.

이행 슬라이스(각각 커밋 가능한 단위):
1. **S1 워커 명명 이식**: topoNaming/심 키 생성부를 워커 공유 모듈로 추출(nodeOcctBridge와 단일 소스) → 워커 응답에 face/edge 이름 테이블 동봉
2. **S2 프로토콜**: wasmBridge·useStepWorker 메시지에 edgeNames 왕복 추가(하위호환: 없으면 B안 유지)
3. **S3 피처 파라미터 이중화**: edge 선택 저장을 {signature, topoName?} 병기 — 리빌드 시 A안 우선, 실패=명시 상실(S4 규약), B안은 폴백이 아니라 **대조군**(불일치 로그)
4. **S4 피처별 전환**: fillet → chamfer → occtFilletAvoidance → refRelink 순(각각 회귀+refpart 게이트)
5. **S5 B안 강등**: 대조 로그 일정 기간 무불일치 후 B안을 진단 전용으로

완료 기준: 스파이크 S2 시나리오를 브라우저 경로 재현 하네스로 옮겨 A안 생존/오매칭이 노드 경로와 동일함을 실측.

## 2. 공통 커널 트랙 (도메인 공통 — 전부 🤖, 지금 착수 가능)

우선순위 = 홀드아웃 실패율 기여 추정 순:

1. **C1 (K1) shell 벽 오프셋 근본수정** — `shell.ts applyAsync → occtShellBox shell(-t, finder)`의 폴리라인 extrude 오프셋 방향 버그. 완료 기준: REF-PART 1 shell 체적 오차 +10.6% → |오차| < 0.5%, finding 로그 제거, 닫힌형 체적과 대조하는 회귀 추가
2. **C2 (K2) mesh 폴백 속성 정합** — CSG 전 base/tool의 position 외 속성(normal/uv/faceId) 정규화(없으면 생성·있으면 정합). 완료 기준: f-fillet 크래시 소멸, REF-PART 전 스테이지 그린 상향(현재 용인 목록 축소)
3. **C3 (K3) B-rep shell 경로 복원** — replicad shell 예외 원인 격리(면 선택자? 두께 부호?), 실패 시에도 OCCT thickening 직접 호출 대안 검토. 완료 기준: corpus seed 기대 fail-clean → ok 승격
4. **C4 (K4) 구멍 위치 계약** — compose intent에 hole 위치(기준면+2D 좌표) 필수화, 게이트에 위치 검증 추가, auditDims가 위치까지 대조. 완료 기준: 위치 있는 케이스에서 dimensions 축 자동 assertion 가능
5. **C5 (K5) HLR 치수선 도면 v1** — 정투영 실루엣(이미 있음)에 에지 기반 치수선 자동 배치(주요 외형+구멍 위치·지름). manufacturing 축의 사람 검토를 "숫자 대조"로 낮춤
6. **C6 (K6) joint IR 확장** — prismatic·cylindrical 컴파일+스윕 인증 확대(기계·인테리어 joints/motion 축 커버리지 요건)
7. **C7 (K7) topo naming 채택 판단** — spike 결과로 W1-B/W3-A 경로 승격 여부 결정(ADR 필요, P0)

각 항목은 "수정→관련 테스트 전체(related) 그린→corpus/refpart 게이트 상향"의 3단계로 커밋. **260808 교훈 적용: 표적 묶음이 아니라 related 전수로 검증.**

## 3. 도메인별 트랙 — 케이스 20구성 + 부족 능력

각 도메인의 승인 케이스 20건은 "쉬운 것 20개"가 아니라 **first-release capability를 전부 커버하는 층화 표본**으로 구성한다(후보 생성기 계약이 이미 이 구조).

### 3.1 기계설계 (축 14 — 가장 넓음)
- 케이스 구성: 단일부품 8(판금·선삭·밀링·쉘·나사) + 어셈블리 8(조인트·모션 포함 4) + STEP 왕복/수리 4
- 선행: C1·C2·C3·C6 (쉘·필렛·조인트가 케이스에 반드시 들어가므로)
- 이미 강함: STEP 왕복(burn-in 17종+소크), boolean 품질, 나사 실경로
- 부족: 어셈블리 모션 인증 폭(revolute만), 제조 도면(C5)
- 홀드아웃: mearm 벤치마크 v2 + 복합제품 코퍼스의 기계 부분(외부 워커 필요분은 후순위)

### 3.2 토목
- 케이스 구성: 옹벽 6(형상→안정검토 연동) + 암거/배수 6 + 교량 거더 4 + 토공 BOQ 4
- 이미 강함: 계산엔진(KDS 기준 인용, 게이트 엄격), civil-accuracy-chain 테스트 신설
- 부족: **형상→검토 파라미터 자동 추출의 왕복 검증**(형상에서 뽑은 치수로 계산 재현) — dimensions↔manufacturing 축 연결
- 특이: joints/motion 축 없음 → 리드타임 짧음. **파일럿 도메인 후보 1순위**

### 3.3 건축
- 케이스 구성: 구조 그리드 6 + 부재검토 연동 6 + 개구부/벽 4 + 기초 반력 4
- 부족: load_path 자동 assertion(현재 계산기는 있으나 형상→하중경로 추출 검증 얇음), 층간 hierarchy 축
- 위험: 면허 천장(⚠️기존 결정 유지 — 검토 참고용 표기, 법정 설계 주장 금지)

### 3.4 조경
- 케이스 구성: 목재 부재검토 5 + 풍하중 전도 5 + 배수 구배 5 + 포장 BOQ/식재 5
- 이미 강함: landscape-accuracy-chain 신설, 파고라 풍하중 PASS 실측 이력
- 부족: grading(지형 구배) 기하 표현이 얕음 — 경사면 어휘 추가 필요(🤖 중간 난도)

### 3.5 인테리어
- 케이스 구성: 공간 폐합 5 + 개구부/문 스윙 5 + 피난 경로 5 + 마감 BOQ 5
- 이미 강함: 유닛 5종(원룸~카페)·피난 검증 실측 이력, interiorAccuracyBenchmark 보강
- 부족: door_swing↔joints/motion 축(문=revolute라 C6 없이도 가능, 기계보다 쉬움), 마감 BOQ 정밀도

## 4. Ground Truth 파이프라인 가동 (측정의 원료)

| # | 단계 | 담당 | 비고 |
|---|---|---|---|
| G1 | 도메인별 후보 20건 생성 (`build-domain-accuracy-candidates`) + 자동 assertion 초안 | 🤖 | 도구 커밋 완료, 즉시 가능 |
| G2 | 검토 패킷 생성 (`build-domain-accuracy-review-packets`) — 리뷰어가 볼 수 있는 형태 | 🤖 | |
| G3 | **👤 독립 리뷰어 섭외 — 도메인별 2인 이상**(기계: 기계설계 실무자, 토목: 토목구조, …). 보수·NDA·일정 | **👤** | **전체 계획의 임계 경로. 지금 시작해야 함** |
| G4 | 리뷰어 blind 승인(케이스별 ground truth 확정, reviewerId 기록) | 👤(수행)+🤖(패킷·수합) | |
| G5 | 캠페인 3×5 실행 (`run-domain-accuracy-campaign`) — 승인 케이스만, 튜닝 미사용 플래그 | 🤖 | ✅260808 **드라이런 완주**(토목 20×3×5=300, `run-domain-accuracy-dryrun.mjs` 14/14 단언): promote 거부 실측·캠페인 재개 무결성·리포트 정직 거부(eligible=false)까지 체인 전 구간 실동작. 실행기=`domain-accuracy-validator.mjs`(실 홀드아웃 도입 시 재사용, v1=재빌드 결정론 4축+not_run 6축) |
| G6 | 리포트→`docs/evidence/domain-accuracy-approved/`→certification workflow | 🤖 | |
| G7 | **실패 축 → §2/§3 백로그로 환류.** 수정 후 재캠페인은 **새 홀드아웃**(같은 케이스 재사용 시 튜닝 오염) — 후보 풀을 도메인당 40+로 넉넉히 생성해 둘 것 | 🤖 | |
| G8 | 복합제품 57건 외부 추출: 👤 SolidWorks/ODA/Revit/Inventor/Creo 라이선스+워커 호스트 → 🤖 추출·검증 | **👤**+🤖 | 기계 심화용 |

**⚠️ 260808 정정(실행 중 발견)**: 리뷰 패킷 게이트가 `internal-template` 소스를 설계상 거부한다(`independent_holdout_source_required` — 자기 템플릿으로 자기 정확도를 증명하는 순환 차단). 따라서 "자체 생성 후보로 1차 인증 충족"은 **불가**하다. 자체 후보 40×5는 파이프라인 드라이런·리뷰어 캘리브레이션 용도로 생성·커밋했고(`docs/accuracy/`), **인증용 홀드아웃은 벤치마크 권리가 확보된 독립 소스(실무 도면·모델)를 👤가 조달해야 한다** — G3(리뷰어 섭외)와 함께 임계 경로.

## 5. 측정 원칙 (신뢰성 — 어기면 수치가 무효)

1. **홀드아웃으로 튜닝 금지** — 실패 케이스를 보고 고치는 건 허용, 고친 뒤 같은 케이스로 합격 주장 금지(새 홀드아웃로 재측정)
2. **모르면 not_run** — 판정기가 측정 불가면 pass도 fail도 아닌 not_run(커버리지가 깎이는 것이 정직). falseVerified=0은 이 원칙 위에서만 성립
3. **자기보고 재검증** — 각 캠페인 결과는 리포트 도구가 재계산(런 로그 → 독립 집계), "통과했다"는 세션 주장을 증거 파일 없이 믿지 않음 (260808에 두 번 확인된 교훈)
4. 95% 미달 축이 있는 도메인은 **그 도메인만** 미인증 — 5개 일괄 지연 금지(도메인별 독립 트랙)

## 6. 마일스톤 (의존 순서 — 주차는 착수 후 상대값)

| 마일스톤 | 내용 | 담당 | 완료 기준 |
|---|---|---|---|
| M1 (주1~2) | 커널 결함 C1·C2·C3 수정 | 🤖 | REF-PART 용인 목록 축소, corpus seed 승격, related 전수 그린 |
| M2 (주1~2, 병행) | 후보 5도메인×40건 생성+자동 assertion+검토 패킷 | 🤖 | G1·G2 산출물 커밋 |
| M3 (주1~, **즉시 착수**) | **👤 리뷰어 섭외**(도메인별 2인) | **👤** | 계약·일정 확정 — 최장 리드타임 |
| M4 (주3) | C4 구멍 위치 + C5 HLR 도면 v1 | 🤖 | dimensions/manufacturing 자동 assertion 가동 |
| M5 (주3~4) | **파일럿 = 토목**(축이 좁고 계산엔진 강함): 승인 20건 → 캠페인 3×5 → 리포트 | 👤+🤖 | civil eligible=true 또는 실패 축 백로그 확정 |
| M6 (주4~6) | 인테리어·조경 캠페인 (파일럿 교훈 반영) | 👤+🤖 | 2개 도메인 eligible |
| M7 (주5~7) | C6 joint IR 확장 → 기계·건축 캠페인 | 👤+🤖 | 5개 도메인 eligible |
| M8 | certification workflow 5/5 PASS → release gate의 정확도 블로커 해소 | 🤖 | `DOMAIN_ACCURACY_EVIDENCE_DIR` 검증 통과 |
| M9 (2차) | 👤 외부 CAD 워커로 복합제품 57건 확장 — 기계 심화 인증 | 👤+🤖 | 홀드아웃 88/88 |

## 7. 👤 사용자 전용 항목 요약

1. **도메인별 독립 리뷰어 2인+ 섭외·보수·NDA** (M3 — 임계 경로, 오늘 시작 권장)
2. 외부 CAD 라이선스·워커 호스트(SolidWorks/ODA/Revit/Inventor/Creo) — 2차(M9)
3. 인증 전 "95%" 문구의 마케팅 사용 여부 최종 결정(인증 전 금지 원칙 유지 승인)
4. 파일럿 도메인 순서 승인(제안: 토목 → 인테리어·조경 → 기계·건축)

나머지(M1·M2·M4·M5~M8의 실행부)는 전부 에이전트가 수행 가능하다.
