# 2D→3D v1 — 도면을 읽어 3D 재구성 (Gemini Vision)

`docs/strategy/drawing-annotation-schema.md` 방법론의 첫 구현. 원칙: **AI=이해, 결정론=형상·검증**.

```
합성 도면 생성(GT 보유) → Gemini 추출(intent JSON) → 기하 게이트 → 결정론 재구성(OpenSCAD) → GT 채점
   gen-drawing.mjs          extract.mjs               reconstruct.mjs(gate)   reconstruct.mjs        run-e2e.mjs
```

## v1 첫 평가 (5장 plate, gemini-2.5-flash, temp 0)
외곽 치수 15/15·구멍 위치 16/16·게이트 5/5 = 100% (단일 어휘·깨끗한 도면)

## v2 평가 — 어휘 5종 × 증강 50장 (2026-07-12, 정직 결과)

**JSON 리페어+재시도3 적용 전→후 (측정된 개선):**

| 지표 | v2.0 | **v2.1 (리페어)** |
|---|---|---|
| **추출 실패(malformed JSON)** | 13/50 (26%) | **7/50 (14%)** ↓ |
| 타입 분류 | 37/50 (74%) | **43/50 (86%)** ↑ |
| 파라미터 정확도(추출 성공분) | 92.3% | **91.6%** |
| 구멍 위치 (±1mm) | 17/19 | **30/30 (100%)** ↑ |
| 기하 게이트 통과 | 33/50 | **37/50** ↑ |

리페어: `80.00..142e-1500000`(정상 만티사+쓰레기 지수) → 지수만 제거해 복구.
정상 소수(1.5e-3)는 불변. 잔여 7건 = 스캔 열화 극단 케이스(리페어·재시도로도 실패) = 정직한 하한.

**버킷별 (clean vs scan)** — 깨끗한 도면은 거의 완벽, 스캔 열화가 갉아먹음:
- clean:bent_sheet 20/20 · clean:flange 30/30 · clean:stepped 20/20 (완벽)
- scan:bent_sheet 14/20 · scan:flange 24/30 (스캔 시 작은 주석 `t=`·치수 누락)
- l_bracket thickness·flange의 boreDia/bcd가 자주 undefined (도면 표기 방식 문제)

### 잔여 갭 (14%) — 스캔 열화 극단 케이스
리페어로 26%→14% 감축. 남은 7건은 스캔 열화가 심해 추출 자체가 실패하는 케이스 + l_bracket scan 타입분류 약함(1/5). 실도면은 더 낮을 것 — 프로덕션 전 실스캔 baseline 필요.

## MCP 서버 — Claude/CLI에서 호출 (`mcp-server.mjs`)

```
claude mcp add nexyfab-drawing -- node <절대경로>/mcp-server.mjs
```

| 도구 | 입력 → 출력 | Gemini |
|---|---|---|
| `text_to_intent` | 자연어 텍스트 → 도면 intent (입구 B) | 필요(2단계) |
| `text_to_assembly` | 자연어 → 복합 다부품 어셈블리(배치+간섭) | 필요 |
| `build_assembly` | 어셈블리 계획 → OpenSCAD+간섭 | 결정론 |
| `extract_drawing` | 도면 PNG → 파라메트릭 intent (입구 A) | 필요 |
| `edit_drawing` | intent + 자연어 지시 → 편집본(게이트) | 필요 |
| `reconstruct_3d` | intent → OpenSCAD + ComponentIntent | 결정론 |
| **`verify_3d`** | **intent → 실렌더 STL bbox·manifold 대조** | 결정론 |

**입력 3경로**(이미지A/텍스트B/계획) → 공통 게이트·재구성. 잘못된 편집·불완전 계획은 게이트가 거부·롤백.

### 어휘 7종
plate_with_holes / stepped_plate / l_bracket / flange / bent_sheet / **tube**(원형파이프) / **rect_tube**(각관) — 뒤 2종은 프레임/랙/스키드 형강용.

### 신뢰성: 2단계 추출 (핵심 픽스)
gemini-2.5-flash/pro가 union 스키마(전 필드)에서 엉뚱한 필드를 채우려다 degenerate-number로 폭주(MAX_TOKENS)하는 실패 → **분류(작은 스키마) → 타입별 최소 스키마 추출** 2단계로 원천 차단. bent_sheet·tube·rect_tube 텍스트 전부 flash로 gate PASS. + flash→pro 폴백 + 503 백오프 + JSON 리페어(폭주 지수·긴소수).

### 정확성 검증 (`verify_3d`)
재구성 SCAD를 **실제 openscad-wasm으로 렌더 → STL bbox·manifold를 기대 치수와 대조**. 전 어휘 **오차 0mm·manifold** 확인. 치수 정확도엔 VLM보다 결정론 대조가 강함(VLM 왕복 재-추출은 후속).

### 자유배치
회전 배치 시 로컬 박스 8코너를 회전변환해 **정확한 AABB** 산출 → 임의 각도 간섭검사 정확(축정렬 한정 아님). 단 어셈블리 관절/자유곡선 결합은 미대응.

### 정직한 한계
- 어휘 7종·**축정렬+회전 배치**(관절·유기결합 아님).
- 입구 B=**계획서**(오라클 아님): 치수 미기입 시 통상값+confidence↓, 사람 승인 전제.
- 복합 어셈블리는 부품↑일수록 AI 불완전계획↑ → 게이트가 막지만 재시도/수정 필요.

## 대화형 편집 (`edit.mjs`) — AI와 소통하며 수정
자연어 지시로 도면을 고친다. **AI는 구조화 패치만 제안, 형상 변경·검증은 결정론 코드** (방법론 §1.3):
```
현재 도면 + "두께 12로, 구멍 전부 ⌀10, (90,45)에 ⌀6 추가"
  → Gemini EditPatch(setParams/holes.add/removeNearest/setDiameterAll)
  → applyPatch(순수함수: 미지필드·음수·판밖 방어) → gate 검증 → 통과분만 채택
```
- 잘못된 편집(판 밖 구멍 등)은 **게이트가 거부·롤백** — 나쁜 지시가 형상을 못 깬다
- `edit.test.mjs` 5/5 (결정론 적용부, Gemini 불필요) + 라이브 루프 검증

상세(케이스별 증거): `e2e-report.json` / 산출 SCAD: `out/*.scad` (재생성) / 재실행: `node run-e2e.mjs`

## 구성

- `gen-drawing.mjs [count] [seed]` — 3각법 3면도 SVG→PNG(sharp) + GT JSON. 결정론 PRNG로 재현 가능
- `extract.mjs <png>` — Gemini responseSchema 강제 구조화 추출. "치수 숫자를 읽어라, 픽셀 추정 금지 / 비치수 구멍은 대칭·축척으로 계산" 프롬프트
- `reconstruct.mjs` — `gate()`: 범위·판재성·구멍 내접 검사 (AI 산출물은 게이트 통과 후에만 형상화) / `toOpenScad()` / `analyticViews()` (재투영 검증용)
- `run-e2e.mjs` — 전체 평가 파이프라인 + 리포트

## 정직한 한계 (v2)

- **어휘 5종**(plate/stepped/l_bracket/flange/bent_sheet) — 실제 조립도·복잡 부품 미대응
- **합성 도면 한정** — 실스캔·손도면 미검증. 증강 스캔열화는 반영(위 scan 버킷)
- **추출 신뢰성 26% 실패** — 최대 리스크(위 ★). 실도면은 더 낮을 것
- 검증 루프 ④는 analyticViews/픽셀 대조까지 — shape-generator SheetRenderer 정식 연동 잔여
- Gemini 키 `.env` GEMINI_API_KEY, ~1.2k tokens/도면

## 다음 단계 (우선순위)

1. **★ 추출 하드닝** — malformed JSON 26% 감축: 재시도 3회+지수백오프, JSON 리페어(degenerate float 교정), 대안 모델(gemini-2.5-pro/구조화 강한 모델) A/B
2. l_bracket thickness·flange BCD 표기 프롬프트 보강 (undefined 다발 구간)
3. shape-generator intent 스키마 정식 연결 (`to-intent.mjs`가 op:subtract 브리지 — 이미 있음)
4. 실도면(AK 랙 DWG 등) 소량 수기 GT로 실환경 baseline

## 위시빌더 교훈 일반화 배치 (2026-07-17 — #2~#9)

위시빌더 스키드/탱크 실전(260717)에서 사람이 잡던 결함을 제품 경로가 잡도록 이식:

- **설계 타당성 그물 상시 배선(#2)**: `buildAssembly`가 `supportCheck`(부유=설치 불가)·배관 관통/교차를 항상 실행 — `{ support, pipes, designOk }` 반환. preset/assemble/package 라우트와 /design 그물 패널(④b 지지)에 노출.
- **routeGate 비우회화(#3)**: `normalizeRoute`(중복 제거·대각 축분해·동일축 병합, startAxis/endAxis=스텁 축방향 진입 엘보 자동) — `routeFeatures` 기본 적용, 백트랙(역주행) 게이트 추가. 남는 문제는 여전히 거부(adjustments로 정직 보고).
- **부재별 장애물(#4)**: `obstaclesFromAssembly`(부품=부재별, cylinder/tube 축정렬은 round x|y|z 실린더 인식 — y축 추가). 다본 장비 단일 env 근사 금지 규칙의 코드화.
- **면접촉 매립 제안(#5)**: supportCheck가 0겹침 얹힘 쌍에 `faceContacts[].suggestTzMm`(-2mm) 반환. autoPlaceCorrect 드롭도 부품 위엔 0.5mm 매립 착지.
- **배관 어셈블리 승격(#6)**: `assembly.pipes[] = { id, from:'부품id.면', to, d, service }` → `autoRoutePipes`(직결 순열+오버헤드 코리도 후보 → 게이트·관통·교차 전수 검사, 전부 불합격=정직 에러) → GA 3D 계통색·2D 폴리라인·SCAD·STEP 자동 포함. textToAssembly 스키마에도 pipes(+box/cylinder·service) 개방 — AI는 연결 계획만, 경로는 결정론.
- **산출물 정합 게이트(#7)**: package 라우트가 전 HTML에 `nf-basis` 메타+REV 푸터 스탬프(`packageStamp`) 후 `packageConsistencyCheck`로 각 문서가 실제 인쇄한 질량·외형(H)을 회수해 기준과 대조(유체 포함 어셈블리는 자재↔운전질량 차이 정직 스킵). 위시빌더 "카드=REV B vs 도면=REV C" 재발 방지.
- **질량 자기정합(#8)**: structuralCheck `massBreakdown`(최대잔여법 — 표시값 합계=총계 보장)+구조 리포트 ② 질량 내역 표. 845≠835류 자기모순 차단.
- **생성기 스캐폴드(#9)**: 패키지 zip에 `generator.mjs` 동봉 — 어셈블리 JSON 내장 단일 소스, 실행하면 공개 API로 전 산출물 재생성(수기 전사 드리프트 0).

테스트: `pipe-route.test.ts` 40+ (vitest) · `assembly.test.mjs` 8 (node --test). ⚠ scripts 테스트는 `.test.ts`만 vitest가 수집.

## 비기계 4분야 확산 배치 (2026-07-17 후속 — 기계 시사점의 도메인 반영)

- **슬리브 재분류**: 배관이 벽·바닥·슬래브(passable role)를 지나는 건 위반이 아니라 **관통 슬리브 명세**로 자동 산출(`pipes.sleeves[]`, designOk 제외 안 함). 장비·가구 관통은 여전히 위반. 라우터도 passable 부재는 통과 허용.
- **인테리어 MEP**: 유닛 템플릿 3종(원룸·아파트·3룸)에 `bathMEP`(PS 입상관+변기·세면대·욕조·싱크 급배수 선언) — 경로=결정론 라우터, 벽 관통=슬리브, GA 3D 계통색(급수/배수)·2D 폴리라인·DXF PIPE 레이어·Dossier §5 배관 표+슬리브 명세로 일관 반영. 규칙: 기구별 스택 진입면 분리(코리도 하강 xy 중첩=교차)·진입 z=포트 z 정렬(미세 z단차=시공불가 조그).
- **DXF**: 인테리어 평면 신설(WALL/FIXTURE/FURN)+전 도메인 PIPE 레이어(self-test 4/4).
- **정합 게이트 W 대조 추가 → 실버그 검출**: ga2dDrawing `placed()`가 회전(rz=90) 무시라 GA 외형 6300→10650 부풀림 — placedAabb 단일 소스로 일원화 교정. 그물이 잡은 기존 템플릿 버그 3건도 수정(원룸 침대·책상 관통, 아파트/3룸 분할벽의 외벽 150mm 관통).
- 정직 한계: MEP 관경·접속 위치=개산, 구배·트랩·통기 미모델(시공도 아님 — DFU 산정은 drainage_vent 계산기).

## 제안 6건 구현 (2026-07-17 3차 배치)

- **BOQ 배관 물량**: computeBOQ `piping`(라인·계통별 m·엘보·슬리브 — 라우트 길이=결정론 실측) + BOQ 리포트 ②b 섹션(기계·비기계 공용). 부속류·행거·보온 미포함 명시.
- **체인 리포트 그물+REV**: `netSection`(designOk·부유·간섭·배관·슬리브)+어셈블리 REV(sha1, 패키지와 동일 산식)를 하중경로·조경·피난·옹벽 4종 HTML에 ⓪절로 — src/lib/design-net.ts 공용 헬퍼, 4라우트 배선.
- **DFU 폐루프**: interior-check `mepDrainageCheck` — 기구 role→표 4.1-2 키, 지관(라인별)·수직관(PS) 소요 DN을 drainage_vent 계산기(KDS 31 30 25 원문)로 판정, 계획 관경(선언 d) 대조. 리포트 ④b.
- **슬리브 위치**: sleeves[]에 `at:[x,y,z]`·heightMm(세그↔부재 클램프 중점) — 시공 명세 좌표.
- **rc_frame 우수 입상관**: 지붕→지상 원시좌표 수직 배관 1본 — 층 슬래브 관통이 층수만큼 슬리브로 자동 산출(건축 MEP 확산 실증).
- **유닛 customFurniture**: 에디터 드래그 가구가 유닛 3종에서도 부품화 — 보행 BFS 장애물이자 배관 라우터 장애물(드래그→리빌드 시 MEP 자동 재라우팅).

## 잔여 제안 3건 (2026-07-17 4차 배치)

- **구배 검증(표 4.1-1)**: mepDrainageCheck가 라우팅 실경로의 수평 연장×최소 기울기(DN별 1/50·1/100·1/200)로 소요 낙차를 산출해 가용 낙차와 대조 — 도식 경로는 무구배·코리도 상승 포함이므로 PASS 단정 대신 CHECK("실시공은 바닥 구배 배관") 정직 판정. 경사 세그먼트 기하는 미지원(맨해튼 라우터 한계 명시).
- **통기관(§4.3 하한)**: drainage_vent에 segment 'vent' — 담당 배수관의 1/2(신정통기=초과/각개·지관=이상)·최소 DN32·12 m↑ 한 단계 업. ⚠표 4.3-1 매트릭스(신정통기 길이·DFU 선정)는 크롤 원문이 병합 셀 구조라 신뢰 전사 불가 — 날조 대신 명문 하한만(정직 보류, 비전 판독 후속). bathMEP에 vent_stack(DN65) 라인+계통색 통기(#0d9488), 급수 입상은 지면 인입 원시좌표로 분리(스택 포트 공유=수직 중첩 교차).
- **조경 관수 체인**: pergola에 irr_line(지중 인입→서까래 상부 살수 런, DN25) 기본 포함 + landscape-check `irrigation` — 정수두·연장=라우팅 실측(결정론), 유량·헤드=제품 사양 입력(미입력=INPUT_GATE 정직 게이트) → pump_head 전양정·수동력/축동력. 리포트 ③절.

## 대축척 도면 코어 (2026-07-17 5차 배치 — "km급 도안" 집중)

기계 스케일(수 m) 가정 제거 — 건축·토목·조경은 연장이 km까지 가므로 도면 체계를 축척 인지로:
- **표준 축척 자동 선정**: `pickScale`(1:1~1:10000 계열, A3 지면 기준) — GA 표제란에 "SCALE 1:N (A3 100% 인쇄 기준)" 명기, S=인쇄 실축척 px 환산.
- **치수 자동 단위** `fmtLen`: <10m=mm 정수 · <1km=m · 이상=km. 정합 게이트 파서도 m/km 역변환 대응(라운딩 단위별 허용오차).
- **스케일바 + 방위(N)**: 비기계 도메인 GA·배치도·선형 평면에 자동.
- **토목 선형 평면 + 측점**: `civilPlanSvg` — 중심선(일점쇄선)+STA 0+000 라벨(연장별 10/50/100m 간격)+스케일바. DXF `dxfCivilPlan` 동일(AXIS 중심선·DIM 측점).
- **밸룬·BOM 그룹 간축**: 부품 40+ 도면은 (type|role|규격|재질) 그룹 대표에만 밸룬(동일 부재=동일 번호 관례), BOM은 수량 열 집계 — rc_frame 90부품→4행.
- **DXF 주석 축척 연동**: 모델공간 1:1(mm) 유지, 문자고·오프셋만 K=N/100 비례(km 도면에서 주석 판독 가능).
- **게이트·템플릿 확장**: box 수평 2km(높이 200m)·옹벽 연장 20m→2km. 500m 연장 실증: 1:2500·STA 50m·질량 1,896t.
- 다음 후보: 선형(polyline) 어휘·종단면도(설계선)·장척 시트 분할(match line)·부지 경계/등고.

## 선형 도면 4건 (2026-07-17 6차 배치 — km 도안 심화, 순차 ①~④)

- **① 선형(IP 폴리라인) 어휘**: `retaining_wall_alignment` 템플릿 — params.ips=[[x,y],…](미입력=leg1/leg2/교각 L형). 세그먼트별 저판·벽체를 방위각 회전 배치(중심선=폴리라인, 접합부 baseW 트림 — "IP 접합 상세=후속·물량은 중심선 연장 기준" 명시). meta.alignment={ips,totalMm,segments,halfWidthMm} 단일 소스.
- **② 종단면도** `profileSvg`: 계획고(기본=벽정점 일정고 형상 파생, profileDesign 입력 시 대체)+지반선(입력 시만 — 지형 지어내지 않음). H/V 축척(종 10× 왜곡) 명기, STA 격자·EL 라벨.
- **③ 장척 시트 분할** `alignmentSheets`: 전체도 1장+상세 시트 n장(상세 축척 자동: 시트 ≤6장 되는 최소 축척, 시트당 360 paper-mm 커버)+**MATCH LINE STA** 양단 표기. 1.3km 3IP → 전체도+4시트 실증.
- **④ 부지 경계·등고**: assembly.siteBoundary(폴리곤)·contours=[{elevM,pts}] 입력 시만 — 배치도/선형 평면 오버레이+독립 "부지 계획도" 시트(면적 자동·EL 라벨). DXF BNDRY/CONTOUR 레이어.
- DXF: dxfCivilPlan alignment 모드(AXIS 중심선·WALL ±halfW 밴드·IP 원+라벨·STA 틱).
- 정직 한계: 곡선(원곡선·완화곡선) 미지원=IP 직선 연결 명시 · 지반선/등고=입력 원칙 · 시트 축척은 A3 100% 인쇄 기준.

## 선형 도면집 완성 배치 (2026-07-17 7차 — 계획서 0~5단계+보강 전체 구현)

- **0단계 무결 규약**: geometry-tolerance(공차 사다리)·obb2d(SAT 정밀 간섭 — 회전 box 쌍 AABB 과탐 제거)·alignment-geom(요소열 직선|원호 단일 chainage)·visual-golden(Playwright+sharp 골든 6종, --update 갱신)
- **1단계 원곡선**: buildElements 사전 게이트 3종(교각≤90°·TL합+여유·minR)·정확 마이터 트림 m=(|o|+h)tan(Δ/2)·새그 공차 현 분할(상한 64)·평면/DXF=진짜 원호(SVG A path·DXF ARC)·곡선표(원값 자기정합)·부품 예산 600
- **2단계 STA 구조물**: culvert(벽 분절=clipElements 런 분할)·catch_basin·expansion_joint — MIN_SEG 거부·box_culvert_frame 자동 체인(미입력=needInputs)·일람표·평면/종단 마커 3자 대조. ⚠종점 측점 버그(step 비배수) 게이트가 검출→수정
- **3단계 지반선 파생**: groundFromContours — 등고×선형 폐형 교차(선분·원호)·모순=거부(평균 금지)·외삽 금지
- **4단계 토공·유토**: A=|d|w+nd² 폐형·0점 분할·불균등 평균단면법(재샘플 금지)·mass_haul 유토곡선·입력 원칙
- **5단계 도면집**: civilSheetPack — 도번 단일 부여(DL/GA/PL/CT/ST/PF/XS/EW/GN)·표제란 REV 스탬프·page-break·도면 목록표·일반주기(실행 계산기 refs만)·역방향 게이트 4종(도번 유일·목록 매수·윈도 무결·REV 채움)
- **§B 횡단면도**: 표준횡단+계획고 변곡점별 대표 단면(상한 8) — 벽고=종단 계획고 동일 소스
- **§C-v1**: 패널 고급 입력(JSON) — 배열 파라미터 입력 수단(6개국). **§F**: DXF 실좌표 origin={E,N} 오프셋 방출. **§G**: 무작위 선형 100케이스 기하 감사(시드 재현)
- 후속(명시): C-v2 SVG 선형 에디터·D AI 개방·완화곡선·암거 수량 룰·종단 DXF·REV 이력·EN 라벨

## 명시 후속 완주 (2026-07-17 10차 배치)

- **①암거 수량 룰**: takeoff culvert(터파기·버림·구체 Bo·Ho−Bi·Hi·거푸집 내외둘레·되메우기·잔토 — 산식 공개·마구리 미포함 명시), 선형 civilTakeoff 자동 편입
- **②종단 DXF**: dxfProfile — y=표고×10 왜곡(주기 명시)·격자·설계/지반선·구조물 마커. 기준면 혼합=지반선 미방출(정직). GA_profile.dxf
- **③챗 선형 개방**: civilAlignment 선언(assemble 라우트 프롬프트+분기) — AI=선언만·결정론 템플릿이 형상, 게이트 거부 문구 3라운드 피드백(원 선언 동봉 재수정)
- **④REV 이력표**: options.revHistory(입력 원칙)+현재 REV 자동 행 — 도면 목록표 시트
- **⑤EN 라벨**: options.lang='en' — 시트명·표두·표제란 이원화(본문 KO 유지 명시)
- **⑥완화곡선(클로소이드)**: curves[{ip,R,Ls}] — Fresnel 급수 폐형(τs·p·k·T), 형상=정밀 폴리라인(길이오차<0.5mm·현 방위≤0.5° 이중 기준 분할), **폐합 자기검증<0.5mm 게이트**, 곡선표 TS/SC/CS/ST·A 확장. 게이트: τs≤30°(급수 유효역)·Δ≥2τs. cw 대칭 검증
- **⑦SVG 선형 에디터(C-v2)**: 패널 — 클릭=IP 추가·드래그=이동·선택=R/Ls·삭제. 산출=advJson 단일 소스 병합(기존 생성 경로·게이트 그대로)
