# WB-0 — AI 경로 커버리지 매트릭스 (정본)

**작성일**: 2026-07-21 · **트랙**: Wave B / WB-0 (WAVE_A_AI_DRIVER §5 Wave B)
**대상 코드**: `src/lib/ai/design-driver/**` (260722 실재 자산)

> **이 문서의 지위**: "거의 다 됐나 / 대체 수준인가?"를 **의견이 아니라 표**로
> 답하는 유일한 정본. 각 칸은 **실행 근거(테스트 실행 · 코드 실독 · grep 실행)**
> 로만 채운다. **코드가 존재한다는 사실만으로 "가능" 판정을 내리지 않는다.**
> **"대체 수준" 판정은 이 표의 수치로만 하며, zero-touch 실측(GA3) 전까지 유보한다.**

---

## 0. 판정 어휘 정의

| 기호 | 의미 |
|---|---|
| **A** | 실행 근거로 이 카테고리 형상이 계획→게이트→패키지 전 경로를 통과함을 확인 |
| **부분** | 일부 하위형상/경로만 통과. 우회로(테셀-압출)로만 되거나, 게이트 일부만 적용 |
| **불가** | 드라이버 계획 어휘 또는 게이트 경로에 이 카테고리가 편입되지 않음(실행/실독으로 확인) |
| **미측정 (n=0)** | design-partner 실측 부재. 날조 금지 — 빈 칸을 추정으로 채우지 않음 |

3열 정의 (WAVE_A_AI_DRIVER §5):
- **`AI 계획 가능?`** — fixturePlanner/llmPlanner 스키마가 이 카테고리 형상을
  `DesignPlan` IR로 표현 가능한가. (`llmPlanner.coerceDesignPlan` 실독 + 픽스처 실행)
- **`게이트 검증 가능?`** — 그 계획이 4게이트(geometry·assembly·dfm·drawing,
  **특히 치수 실측 ≤1e-6**)를 통과할 수 있나. (실행 증거 필수)
- **`zero-touch 실측치`** — 실사용자 부품군에서 개입 없이 통과한 실측 비율.
  **현재 전 카테고리 n=0** — GA3(파트너)에서만 채울 수 있음.

---

## 1. 매트릭스 (기계 카테고리 — "대체" 대상 영역)

| 카테고리 | AI 계획 가능? | 게이트 검증 가능? | zero-touch 실측치 |
|---|---|---|---|
| **① 브래킷 / 플레이트** | **A** — L-프로파일 각기둥 extrude. `lBracketPlan()` 실행 → 패키지 산출. llmPlanner가 동일 JSON 강제-코어스 통과. **260727 WB-9: 구멍(`holes`) 편입** — 종전 A는 *구멍 없는* 픽스처 전제였고, 실사용 브리프는 대부분 구멍을 가진다(§1-1 실측) | **A** — 4게이트 전부 pass. 부피 relErr≤1e-9, 치수 5종 실측 ≤1e-6, DXF 실측 라벨. **WB-9**: `holeGate` 실 OCCT `BRepAlgoAPI_Cut`+`BRepGProp` 순부피 실측(선언 절삭이 함의하는 부피와 1e-6 일치), 재료를 안 깎는 구멍=거부. *(잔여: 구멍 위치 콜아웃 미지원·블라인드/사각 컷아웃 거부)* | **미측정 (n=0)** |
| **② 축 / 샤프트 (회전체)** | **A** *(260722 WB-1 승격)* — 진짜 `revolve` 솔리드가 스키마 표현+프리플라이트 통과(f.lat.{i} 네임스페이스). 테셀-압출 우회로도 병존 | **A** *(WB-1)* — `buildRevolveMeasureTopo`로 revolve rim 치수 실측: ⌀50 `%%c50`·축길이 60 편차≤1e-6(measure 자기 진원성 검증). 축법선 외 뷰는 oblique-in-view 거부(타원 날조 없음). *(잔여: loft/sweep는 여전히 빌더 부재→거부)* | **미측정 (n=0)** |
| **③ 하우징 / 박스** | **A** *(260722 WB-6 승격)* — 부품 레벨 `curved` 스펙(fillet 반경·엣지) 편입. `filletedBlockPlan()`(40×40×20 전엣지 R3) 실행 → 패키지. 단순 박스 + 곡면 필렛 하우징 표현. *(잔여: shell 속파기·포켓/보스)* | **A** *(WB-6)* — `curvedGate` 실 OCCT 커널: buildFromExtrude→BRepFilletAPI_MakeFillet 실필렛→BRepGProp 부피 실측(32000→감소, 재료 제거 검증)+STEP 산출. 과대 반경(커널 IsDone=false)·shell 미배선 주입→패키지 미산출 실증. OCCT 미가용 시 선언 곡면 거부. *(잔여: shell thicken 경로·스프링백 무관)* | **미측정 (n=0)** |
| **④ 판금** | **A** *(260722 WB-2 승격)* — 부품 레벨 `sheetMetal` 스펙(thickness·base·ops[bend/flange]) 편입. `process=sheetMetal` 부품이 스키마 표현+llmPlanner coerce 통과. `sheetUChannelPlan()` 실행 → 패키지. *(잔여: 헴/조그/컷아웃 어휘·폴딩 솔리드 메시)* | **A** *(WB-2)* — `flatPatternGate` 실전개(features/sheetMetal 엔진 소비): U-채널 전개장 실측(=공개 공식 getKFactor+bendAllowance 교차검증), 벤드 스케줄 실측, error 벤드 경고(최소반경 미달)=크랙 차단. 오전개장/최소반경 주입→패키지 미산출 실증. flat DXF(CUT+BEND) 산출. *(잔여: 스프링백/툴링 간섭 미검증)* | **미측정 (n=0)** |
| **⑤ 용접 프레임 (웰드먼트)** | **A** *(260722 WB-3 승격)* — 부품 레벨 `weldment` 스펙(sectionType·size·segments) 편입. `weldmentFramePlan()`(사각 포탈 프레임 4부재) 실행 → 패키지. llmPlanner coerce 통과. *(잔여: 거셋/베이스플레이트·다중 단면 프레임)* | **A** *(WB-3)* — `weldmentGate` 실 마이터(welding/miterFrame 소비): 2부재 코너 이등분 마이터→부재 스톡 컷길이(최장 섬유)+45° 엔드마이터 실측→컷리스트(질량 포함). 45° 코너 손유도(부재 340mm·총 1360mm)와 정확 일치. 오스톡/퇴화부재 주입→패키지 미산출 실증. *(잔여: 원형 단면 테셀·3부재+ 코너 버트컷)* | **미측정 (n=0)** |
| **⑥ 기어 / 전동** | **부분** *(260722 WB-7 승격)* — 부품 레벨 `patterns` 스펙(linear/circular + gear 사이징) 편입. `spurGearPlan()`(m=2 z=20) 실행 → 패키지. 기어 사이징(모듈·치수·피치경) 표현 가능. *(잔여: 인벌류트 치형 미생성 — 사이징만)* | **부분** *(WB-7)* — `patternGate` 레이아웃 실검증: circular step=360/count 관례 소비→인스턴스 변환 실계산·비겹침·기어 사이징(피치경=m·z·원피치=π·m·호간격 정합). 치 겹침/피치경 불일치 주입→패키지 미산출 실증. *(잔여: 인벌류트 플랭크·치합 접촉 FEA 미수행)* | **미측정 (n=0)** |
| **⑦ 체결 / 규격품** | **A** *(260722 WB-8 승격)* — 부품 레벨 `fasteners` 스펙(ISO 미터 호칭·타입·체결길이) 편입. `tappedPlatePlan()`(M8 탭+M6 스터드) 실행 → 패키지. llmPlanner coerce 통과. *(잔여: 인치·BSP/NPT·워셔/너트 스택)* | **A** *(WB-8)* — `fastenerGate` 규격 검증: METRIC_COARSE_PITCHES(ISO 261 표준 피치) 소비→ISO 68-1 유도(유효경 d2·소경·탭드릴)+체결길이 스크리닝(강 0.8·D). 비표준 호칭(M7)·과소 체결 주입→패키지 미산출 실증. ISO 호칭 문자열 산출. *(잔여: 토크 조인트 FEA·블라인드 홀 깊이 기하대조)* | **미측정 (n=0)** |
| **⑧ 복합 어셈블리** | **A** — 2부품+mate(concentric/coincident)+BOM. `pinBlockAssemblyPlan()` 실행 → 패키지. llmPlanner가 assembly 스펙(solveMates 입력형) 코어스 통과 | **A** *(260722 WB-4 + WB-4b 정밀화)* — mate 수렴 A + 간섭 게이트(비메이트 관통=fail, 메이트=화이트리스트). **WB-4b: AABB 광역상 후보→삼각형 SAT+포함 파리티 정밀상**으로 위양성 제거(오목부에 안착한 peg=AABB 겹침이나 정밀상 clear→패키지 산출 실증). 진짜 관통은 여전히 fail. *(잔여: penetration 깊이 재측정·미메시 바디 AABB 폴백)* | **미측정 (n=0)** |

### 1-1. 실사용형 브리프 실측 (260727, n=12, 실 DeepSeek) — **zero-touch 아님**

> ⚠️ 이 절의 수치를 **zero-touch 실측치로 읽지 말 것.** 브리프를 쓴 것은 실사용자가
> 아니라 개발 측이고(합성 표본), zero-touch 열은 여전히 **n=0**이다. 여기서 재는 것은
> "평범한 기계부품 문장을 넣었을 때 드라이버가 어디서 막히는가"이며, 목적은 GA3가
> 열렸을 때 떨어지지 않도록 **병목을 순서대로 찾는 것**이다.

같은 12개 브리프(플레이트·브래킷·블록·튜브·거셋·키·채널 등)로 A/B 실행:

| 측정 | 값 |
|---|---|
| 계획 단계 통과 (ref-naming 수정 **전** 프롬프트) | 1/12 = **8.3%** |
| 계획 단계 통과 (현재 프롬프트) | 10/12 = **83.3%** |
| `e.vert.{i}-{j}`(존재하지 않는 2-인덱스) 오류 | 11/12 → **0/12** |
| 전 게이트 완주 | **0/12** (양쪽 다) |

완주가 0인 이유를 거부 사유로 집계한 결과 **최상위 병목은 구멍(5/12)** 이었다 — 스키마에
구멍이 없어 LLM이 구멍을 별도 body로 만들었고 geometry 게이트가 "AABB 겹침"으로 정확히
거부한 것(모델 실수가 아니라 표현 수단의 부재). WB-9로 해소 후 재측정:

| 측정 | 값 |
|---|---|
| LLM이 `holes` 스펙을 실제로 사용 | **4/12** (구멍이 필요한 5건 중 4건) |
| `hole` 게이트 판정 | **PASS 4 · FAIL 0** |
| "AABB 겹침" 거부 | **5 → 0** |
| 전 게이트 완주 | 여전히 **0/12** — 병목이 **도면 치수**로 이동 |

**다음 병목(확정)**: 도면 치수. `d_thickness`(front 뷰)가 `measured 0 mm`로 나오는 패턴이
지배적이다. 상세·다음 행동은 `docs/next-session-plan-260727.md` §6.

### A 비율 산술 (실행 근거 기반)

| 열 | A | 부분 | 불가 | A 비율 |
|---|---|---|---|---|
| **AI 계획 가능?** | ①②③④⑤⑦⑧ = **7** | ⑥ = 1 | (없음) = 0 | **7/8 A · 8/8 ≥부분** *(260722 WB-6: ③ A승격)* |
| **게이트 검증 가능?** | ①②③④⑤⑦⑧ = **7** | ⑥ = 1 | (없음) = 0 | **7/8 A = 87.5% · 8/8 ≥부분** *(WB-1/4/2/3/8/7/6 승격, 불가 0)* |
| **zero-touch 실측치** | 0 | 0 | 0 | **n=0 (전 카테고리 미측정)** |

> **대체 수준 판정 (260722 WB-6 갱신)**: 현행 드라이버는 **각기둥형 기계부품
> (브래킷·플레이트)·회전체(축/샤프트)·곡면 필렛 하우징(실 OCCT)·판금 전개품·용접
> 프레임(컷리스트)·표준 체결(ISO 나사)·그 mate 어셈블리(정밀 간섭 포함)**를 A로,
> **기어(인벌류트 치형)만 부분**으로 실행 검증한다 — **8/8 전 카테고리가 최소 '부분',
> 그 중 7/8이 완전 A(검증 A 12.5%→87.5%). '불가' 카테고리는 소멸.** 남은 유일한
> '부분' 경계는 ⑥ 인벌류트 치형(별도 대공사)·③ shell 속파기. 자동화율(zero-touch)은
> **전 카테고리 n=0**이므로 "대체 수준" 정량 판정은 **GA3 첫 실측 전까지 유보**한다
> (측정 없는 목표는 날조 — 불변 원칙).

---

## 2. 기계 외 도메인 (각주 — "대체" 대상 아님)

WAVE_A_AI_DRIVER §0·§4 도메인 순서 및 정직 고지에 따름:

- **조경 · 인테리어 (일반인 트랙)**: `design_brief` 연결로 AI 비중 확대는 쉬우나,
  본 매트릭스의 "대체 수준"(전문가 툴 대체) 판정 대상이 **아니다**. 별도 트랙.
- **토목 · 건설**: 보조 도구 심화 영역. **"면허 보유자 최종 책임" 고지 라벨 고정,
  "대체" 언어 금지**(제품 표면·문서 공통). 본 표에 카테고리로 편입하지 않음.

---

## 3. 커버리지 경계 → Wave B 백로그 매핑

"불가/부분" 판정의 각 경계는 WAVE_A_AI_DRIVER §5 "WB 확장 백로그" 항목과 1:1 대응한다.
백로그 1건 소화 → 해당 행 재실사 → zero-touch 재측정 → 반복.

| 매트릭스 경계 (불가/부분 사유) | 대응 백로그 (WAVE_A §5) |
|---|---|
| ~~② revolve 축류 치수 불가~~ **✅ WB-1 완료(260722)** — revolve 실측+드라이버 편입 | ~~WB-1~~ (loft/sweep NamedTopology는 잔여) |
| ~~④ 판금 전개/굽힘 어휘 부재~~ **✅ WB-2 완료(260722)** — sheetMetal 스펙+flatPatternGate 실전개 | ~~WB-2~~ (헴/조그/폴딩 솔리드 메시는 잔여) |
| ~~⑤ 웰드먼트/마이터/컷리스트 어휘 부재~~ **✅ WB-3 완료(260722)** — weldment 스펙+weldmentGate 실 마이터 컷리스트 | ~~WB-3~~ (거셋·3부재+ 코너는 잔여) |
| ~~⑧ 간섭 게이트 미포함~~ **✅ WB-4 + WB-4b 완료(260722)** — 간섭 게이트+정밀 삼각형 SAT | ~~WB-4~~ (penetration 깊이 재측정은 잔여) |
| ~~(도면 GD&T 자동화 미편입)~~ **✅ WB-5 완료(260722)** — gdtGate 자동 제안+실측 검증(flatness/orientation) | ~~WB-5~~ (position/cylindricity/profile은 잔여) |
| ~~⑦ 나사산/규격품 어휘 부재~~ **✅ WB-8 완료(260722)** — fasteners 스펙+fastenerGate ISO 규격 검증 | ~~WB-8~~ (인치·BSP/NPT는 잔여) |
| ~~③ 곡면 쉘/필렛 하우징 미실증 (OCCT 전용)~~ **✅ WB-6 완료(260722)** — curved 스펙+curvedGate 실 OCCT 필렛(부피 실측·STEP) | ~~WB-6~~ (shell 속파기·포켓은 잔여) |
| ~~⑥ 기어 등 피처 패턴 미편입~~ **✅ WB-7 완료(260722)** — patterns 스펙+patternGate(기어 사이징·비겹침) | ~~WB-7~~ (인벌류트 치형은 별도 대공사) |

> **주의**: 판금(G1 라이브)·웰드먼트(W5-E 마이터)·나사산(W5-B)·패턴(W5-D)은 **앱 피처로
> 존재**하나, 본 실사(grep + 스키마 실독)로 **드라이버 계획 어휘에는 미편입** 확인됨.
> "피처 존재 ≠ 드라이버 편입" — 백로그가 이 간극을 닫는 작업이다.

---

## 4. 판정 뒷받침 실행 증거 (재현 가능)

모든 판정은 아래 명령의 실제 실행 결과에 근거한다. (2026-07-21 실행, Windows/PowerShell)

### 4.1 fixture 3종 + 실패주입 + llmPlanner 전 경로 실행

```
npx vitest run \
  src/lib/ai/design-driver/__tests__/designDriver.fixtures.test.ts \
  src/lib/ai/design-driver/__tests__/designDriver.failures.test.ts \
  src/lib/ai/design-driver/llmPlanner.test.ts
```

**결과: `Test Files 3 passed (3) · Tests 28 passed (28)` · Duration 1.49s.**

이 실행이 표의 다음 칸을 뒷받침한다:

| 표의 칸 | 뒷받침 테스트 (실행 통과) | 검증된 수치 |
|---|---|---|
| ① 브래킷 A/A | `WA-A fixture ① L-bracket` | `geometry:bracket` totalVolume≈14720mm³, volumeRelError≤1e-9; 치수 5종(60/40/8/20/90°) 실측 편차≤1e-6; DXF 라벨 `60`/`8`/`20`/`90%%d` |
| ② 축 테셀-압출 A | `WA-A fixture ② stepped shaft` | ⌀ 실측 `%%c24`/`%%c16`, 길이 30/25, relErr≤1e-9, notes에 "tessellation deviation" 명시 |
| ② 진짜 revolve 치수 **불가** | `makeLlmPlanner — plan preflight > refuses a dimension on a revolve body` | 거부 메시지 `measurement not available for revolve bodies (WB backlog)` |
| ③ 단순 박스 A / ⑧ 어셈블리 A·부분 | `WA-A fixture ③ pin-block assembly` | `assembly` finalMaxResidual≤1e-6, mateCount=2, pin 배치 (20,20,20) 실측, BOM 2행 |
| (게이트가 실제로 측정함) | `WA-A failure injection ①②③④` | ① drawing `unresolved-ref e.vert.99` 거부, ② assembly `did not converge`+잔차>tol, ③ geometry `degenerate` 부피≤1e-9, ④ 미지 브리프 stage:'plan' 거부 |

### 4.2 판금/웰드먼트/나사산/패턴 드라이버 편입 여부 — grep 실행

```
grep -rniE 'sheetMetal|weldment|weld|miter|thread|pattern|unfold|flatten' src/lib/ai/design-driver
```

**결과 (전 3건)**:
```
llmPlanner.ts:100  const DFM_PROCESSES = new Set([... 'sheetMetal']);   ← DFM 공정 태그
llmPlanner.ts:400  "process": "cnc"|"fdm"|"sla"|"injection"|"sheetMetal"?   ← 스키마 enum(공정)
manufacturingGate.ts:39  sheetMetal: 0.5,   ← minWall 스크리닝 상수
```

→ `sheetMetal`은 **DFM 공정 태그로만** 존재(전개/굽힘 피처 아님). `weldment`·`miter`·
`thread`·`pattern`·`unfold`·`flatten`은 **0건** — ④⑤⑥⑦ "불가" 판정의 실행 근거.

### 4.3 스키마·프리플라이트 실독 근거 (계획 표현 한계)

- `llmPlanner.ts:97` `MESHABLE_KINDS = {extrude, revolve, sweep, sweep_path, loft}`
  — 회전체 **솔리드**는 스키마 표현 가능(② "부분"의 근거).
- `llmPlanner.ts:300-332` `preflightPlan` — 치수 대상 바디가 `extrude`가 아니면
  즉시 거부("no NamedTopology builder"). 회전체 **치수**는 불가(② 게이트 "부분").
- `packager.ts:37-43` `REPORT_LIMITATIONS` — 고정 정직 고지: PDF 미포함·DXF 비연관
  치수·FEA 비법정·**간섭 게이트 미포함**·곡면 테셀레이션. ⑧ "부분"·③ 경계의 근거.
- `manufacturingGate.ts:24` 자체 명시: 최소두께=AABB 스크리닝 프록시(내부 리브/국부
  벽 미검출) — DFM 열의 근사 한계.

---

## 5. 다음 갱신 규칙

1. **백로그 1건 소화 시** §1 해당 행을 재실사(실행)로 갱신하고, §3 매핑에서 제거.
2. **GA3 파트너 실측 개시 시** `zero-touch 실측치` 열을 **n 병기**로 채운다
   (예: `72% (n=25)`). 그 전까지 전 칸 `미측정 (n=0)` 고정 — 추정 기입 금지.
3. **웨이브 게이트(GB) 목표치**는 GA3 첫 실측 후 설정. 측정 없는 목표는 날조.
