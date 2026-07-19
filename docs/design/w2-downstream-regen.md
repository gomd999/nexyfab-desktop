# W2-0 — 하류 재생성: 상류 참조 패턴 (설계 확정)

> **상태**: 패턴 확정 + extrude/fillet 2종 왕복 증명 완료 (260719).
> **후속**: W2-A(잔여 10종) · W2-B(영속 승격) · W2-C(회귀 스위트) 는 이 문서를 그대로 따른다.
> **근거**: [`../roadmap/REPLACEMENT_ROADMAP.md`](../roadmap/REPLACEMENT_ROADMAP.md) §1 실측 ·
> [`../roadmap/EXECUTION_PLAN_PARALLEL.md`](../roadmap/EXECUTION_PLAN_PARALLEL.md) Wave 2

---

## 0. 문제 한 줄

`FilletFeature.childExtrude: ExtrudeFeature` 가 상류 노드의 **복사본**이었다.
증분 재방출은 fillet 을 다시 방출했지만, fillet 은 자기 안의 **낡은 복사본**을 다시 읽었다.

의존성 그래프(`downstreamOf`)와 증분 재방출(`incrementalReplay` 의 `mustEmit`)은 **처음부터 옳았다.**
고친 것은 **데이터 모델 한 겹**이다. 연구가 아니라 리팩터였다는 진단이 실행으로 확인됐다.

### 실행 증명 (전 / 후)

```
extrude(depth=10) → fillet,  상류 depth 10→25 편집
downstreamOf(f1) = ["f2"]

           BEFORE                          AFTER
f1 changed?          true            f1 changed?          true
f2 (fillet) changed? false  ★        f2 (fillet) changed? true  ✔

// BEFORE — f2 SCAD                 // AFTER — f2 SCAD
minkowski() {                       minkowski() {
  translate([2, 2, 2])                translate([2, 2, 2])
    cube([16, 16, 6]);   ← 10-2r        cube([16, 16, 21]);  ← 25-2r ✔
  sphere(r=2, $fn=32);                sphere(r=2, $fn=32);
}                                   }
```

"텍스트가 달라졌다"가 아니라 **코어 큐브 Z 가 `depth-2r` 를 정확히 추종**한다.
회귀 테스트가 `10-4` / `25-4` 를 리터럴로 못박는다.

---

## 1. 패턴 — 12종 공통 규약

### 1.1 참조 표현 (3가지 형태로 12종 전부 수용)

payload 가 **상류 바디**를 소비하면, 복사본이 아니라 **노드 id** 로 이름한다.

| 형태 | 의미 | 해당 종 |
|---|---|---|
| `childId: string` | 상류 바디 1개 | fillet · chamfer · hole(호스트) · rib(호스트) · pattern(시드) |
| `childIds: string[]` | 상류 바디 N개 | 향후 다물체 연산 |
| `bodies: string[]` | boolean 의 **기존** 형태 | boolean |

`upstreamRefsOf(payload)` 가 이 셋을 읽어 `string[]` 로 정규화한다.
**`childId`/`childIds` 는 덕타이핑으로 읽는다** — W2-A 는 각 피처 파일에 필드만 추가하면 되고,
`featureTree.ts` 를 **편집할 필요가 없다**(트랙 간 파일 충돌 방지, §0.1 규약).

```ts
export function upstreamRefsOf(payload: FeaturePayload): string[]
```

### 1.2 방출 시점 해석 — `EmitContext`

```ts
export interface EmitContext {
  requirePayload<K extends FeatureKind>(refId, forId, expectKind: K): Extract<FeaturePayload, {kind:K}>;
  requireScad(refId, forId): string;
}
```

**두 접근자가 필요한 이유**(단일 접근자로는 12종을 못 덮는다):

- `requirePayload` — fillet/chamfer 는 상류의 **기하 파라미터**(`loop`, `depth`)가 필요하다.
  렌더된 SCAD 문자열로는 minkowski 인셋을 계산할 수 없다.
- `requireScad` — boolean/pattern 은 상류의 **렌더 결과**만 있으면 된다(불투명 바디 복제·조합).

둘 다 **라이브 트리에서 읽거나, 던진다.** 스냅샷 폴백 없음.

### 1.3 무결성 불변식 — `refs ⊆ dependencies`

`validateTree` 가 강제한다:

```
node 의 payload 가 이름한 모든 ref 는 node.dependencies 에도 선언돼 있어야 한다
```

이것이 핵심이다. `dependencies` 는 이미 **리스트에서 더 앞에 있어야 함**이 검증되므로,
불변식이 성립하면 **ref 는 오직 뒤(상류)만 가리킬 수 있다.**
→ **순환은 런타임 위험이 아니라 구조적으로 불가능**해진다(§3 참조).

기존 boolean 노드들은 이미 `dependencies: bodies` 로 선언하고 있어 무변경 통과했다(실측).

---

## 2. 12종 훑기 결과 — 예외는 없다

착수 전 12종 payload 를 전부 읽었다. 분류:

| # | Kind | 현재 상류 보유 형태 | 판정 |
|---|---|---|---|
| 1 | `extrude` | 없음 (loop+depth 자족) | 리프. 변환 불필요 |
| 2 | `revolve` | 없음 (loop+angle 자족) | 리프. 변환 불필요 |
| 3 | `sweep` | 없음 (profile+path) | 리프. 변환 불필요 |
| 4 | `loft` | 없음 (sections) | 리프. 변환 불필요 |
| 5 | `sweep_path` | 없음 (profile+path) | 리프. 변환 불필요 |
| 6 | `rib` | 없음 (start/end/thickness/height) | 리프. **주의: §2.1** |
| 7 | `hole` | 없음 (center/diameter/depth) | 리프. **주의: §2.1** |
| 8 | `fillet` | `childExtrude: ExtrudeFeature` **복사본** | ★ W2-0 에서 변환 완료 |
| 9 | `chamfer` | `childExtrude: ExtrudeFeature` **복사본** | ★ W2-A. fillet 과 **동형** |
| 10 | `linear_pattern` | `childScad: string` **렌더된 문자열** | ★ W2-A. §2.2 |
| 11 | `circular_pattern` | `childScad: string` **렌더된 문자열** | ★ W2-A. §2.2 |
| 12 | `boolean` | `bodies: string[]` **이미 참조** | ✔ 이미 올바름. 패턴의 원형 |

**패턴에 안 맞는 놈은 없었다.** 지시서가 우려한 3가지 변형은 다음과 같이 수용된다:

- **boolean = 피연산자 둘** → `bodies: string[]` (다중 ref 형태). 이미 이 저장소가
  **정답을 갖고 있었다** — W2-0 은 boolean 이 하던 것을 나머지로 일반화한 것에 가깝다.
- **pattern = 대상 하나 + 반복 파라미터** → `childId` + `count/spacing`. ref 와 파라미터는
  직교하므로 충돌 없음.
- **hole = 호스트 필요** → `childId` (호스트 바디). §2.1.

### 2.1 발견: `rib` · `hole` 은 호스트를 **아예 안 갖고 있다**

`HoleFeature` 주석은 *"drills down from the top of the parent body"* 라고 말하지만,
**타입에 부모 참조 필드가 없다.** `RibFeature` 도 같다. 즉 이 둘은
"낡은 복사본을 쓰는" 문제가 아니라 **호스트 개념이 미구현**이다.

→ **W2-A 는 이 둘을 "참조로 바꾸는" 게 아니라 "참조를 신설"해야 한다.** 성격이 다른 작업이다.
`childId` 를 optional 로 추가하고, 없으면 현행(자립 바디) 동작을 유지하라. 임의로 "직전 노드가
호스트겠지" 라고 **추측하지 마라** — 그게 D1 위반이다.

### 2.2 발견: pattern 의 `childScad: string` 이 fillet 보다 **더 나쁘다**

fillet 은 최소한 **구조화된 IR**(`ExtrudeFeature`)을 복사했다. pattern 은 **이미 렌더된 SCAD
텍스트**를 들고 있다. 낡을 뿐 아니라 **파라미터를 되읽을 수조차 없다**(텍스트 역파싱 불가).

→ W2-A 의 pattern 변환은 `childId` + `EmitContext.requireScad(childId)` 로 간다.
`requirePayload` 가 아니라 **`requireScad` 를 쓰는 첫 비-boolean 사례**가 될 것이다.
전환 시 `childScad` 는 fillet 의 `childExtrude` 와 동일한 deprecated-스냅샷 취급(§5).

---

## 3. 해석 실패 시 동작 — 조용한 추측 없음 (ADR-017 D1)

| 실패 | 동작 | 어디서 |
|---|---|---|
| ref 가 **트리에 없음** | `FeatureTreeError` throw | `validateTree` 가 선제 차단(`depends on X, which appears later or not at all`) |
| ref 가 **dependencies 미선언** | `FeatureTreeError` throw | `validateTree` — §1.3 불변식 |
| ref 가 **순환** | **구조적으로 불가능** | dependencies 가 앞쪽만 허용 → ref 도 앞쪽만. 별도 사이클 탐지 불필요 |
| ref 의 **kind 불일치**(fillet→revolve) | `FeatureTreeError` throw | `EmitContext.requirePayload` |
| ref 가 **suppressed** | **연쇄 suppress**(§3.1) | `replayTree` |
| ref 모드인데 **ctx 없이 방출** | `Error` throw, 스냅샷 폴백 **거부** | `resolveFilletChild` |

마지막 줄이 이 설계의 핵심 태도다. 낡은 스냅샷이 아직 객체 안에 **물리적으로 존재**하지만
방출기는 그것을 읽느니 **던진다**. 조용히 틀린 기하를 내보내는 것이 W2-0 이 없애려는 바로 그 결함이다.

에러 메시지도 그렇게 적혀 있다:

```
fillet 'f2' references upstream body 'f1' but was emitted without a tree context.
Emit it via replayTree/incrementalReplay, or pass an EmitContext to filletToScad.
(Refusing to fall back to the stale childExtrude snapshot.)
```

### 3.1 suppress 연쇄 — 왜 throw 가 아닌가

상류 extrude 를 suppress 하면 fillet 은 **둥글릴 바디가 없다**. 선택지 셋:

1. throw → 사용자의 **합법적 조작**(suppress 는 UI 기본 기능)에 앱이 터진다. 기각.
2. 상류 무시하고 뭔가 방출 → **조용한 추측**. D1 위반. 기각.
3. **하류도 함께 skip + 명시 보고** ← 채택. SolidWorks 동작과 일치.

`ReplayResult.autoSuppressed: string[]` 로 보고한다. UI 는 "suppressed (parent)" 를 표시할 수 있다.
자기 자신이 suppress 된 것과 **구분 가능**해야 하므로 별도 필드로 뒀다.

단일 전방 패스로 충분하다 — `validateTree` 가 ref 의 후방 단조성을 이미 증명했기 때문.

**레거시 무영향**: 임베디드 모드는 `upstreamRefsOf` 가 `[]` 이므로 연쇄가 발동하지 않는다.
기존 517 테스트 중 suppress 관련분이 전부 통과한 이유다.

---

## 4. 재방출 단위 — 노드 단위 (정확성 우선, 성능은 캐시로)

**결정: 노드 단위 재계산. 트리 전체 재생성 아님.**

`incrementalReplay` 는 이미 `mustEmit = 변경분 ∪ 하류` 를 계산한다. W2-0 은 이 기계를 **바꾸지 않았다.**
데이터 모델만 고쳤더니 기계가 의도대로 동작하기 시작했다.

### 4.1 고친 것 하나 — `incrementalReplay` 의 방출 집합 중복 구현

기존 `incrementalReplay` 는 최종 SCAD 를 `nextTree.nodes` 를 직접 순회하며 재봉합했고,
`node.suppressed` 만 걸렀다. **소비(consumed) 개념을 몰랐다.**

참조 모드에서는 치명적이다: fillet 이 f1 을 소비하는데 `incrementalReplay` 는 f1 을 **최상위로도
방출** → 날카로운 박스와 둥근 박스가 **둘 다** 나온다.

→ 방출 집합을 **`fullReplay.emittedOrder` 에서 그대로 가져오도록** 고쳤다.
suppress 연쇄와 소비 판정을 두 곳에서 각자 구현하면 **반드시 갈라진다.**
회귀 테스트가 `incrementalReplay(...).scad === replayTree(next).scad` 를 못박는다.

### 4.2 소비(consumption) 일반화

기존에는 boolean 의 `bodies` 만 "소비됨"으로 표시해 최상위 방출에서 제외했다.
이제 **모든 ref** 가 소비를 유발한다(`upstreamRefsOf` 순회).

기하학적으로 당연하다 — 필렛된 박스 옆에 원본 날카로운 박스가 서 있으면 안 된다.
레거시 임베디드 모드는 ref 가 없으므로 **종전대로 둘 다 최상위**(테스트로 고정).

소비된 노드도 **`perNode` 에는 렌더된다** — 에디터 프리뷰·캐시키가 필요로 한다. 방출만 보류.

### 4.3 캐시/메모화 — 여지 있음, 이번엔 만들지 않음 (지시대로)

현재 `incrementalReplay` 는 캐시 병합 전에 **`replayTree(nextTree)` 를 통째로 한 번 돌린다**
(그래프 오류 조기 실패 목적). 즉 **재계산 절감이 실제로는 0 이다.** 캐시는 "이전 세션 출력
안정화"에만 기여한다. 이건 현재 코드의 사실이지 W2-0 의 회귀가 아니다.

대형 트리에서 진짜 절감을 원하면:

- `mustEmit` 에 없는 노드는 `renderNode` 자체를 **건너뛰고** `prevResult.perNode` 를 그대로 승계.
  단 `validateTree` 는 항상 선행(그래프 무결성은 캐시 대상 아님).
- 노드별 캐시키 = `hash(payload) + hash(해석된 상류 캐시키들)` — **상류 키를 포함해야** 참조
  변경이 하류 키를 무효화한다. 이 재귀 구조를 빠뜨리면 W2-0 이 고친 버그가 캐시 층에서 재현된다.
- 측정 없이 만들지 마라. 현재 `src/lib/cad` 517 테스트가 **0.45s** 다. 병목이라는 증거가 없다.

**→ W2-C 가 대형 트리 벤치를 먼저 만들고, 숫자가 나온 뒤에 착수할 것.**

---

## 5. 영속 영향 — 저장된 트리 승격 설계 (구현은 W2-B)

**목표: 손실 0.**

### 5.1 현재 상태 (실측)

- `featureTreePersist.ts` `SCHEMA_VERSION = 1`. `migrate(parsed) → tree` 디스패치 형태가
  **이미 v2 를 받도록 배치돼 있다**(주석 21-22행).
- 로드 시 payload 는 **구조 검증 후 raw 객체를 그대로 통과**시킨다
  (`return { ok: true, payload: raw as unknown as FeaturePayload }`).
  → **`childId` 는 오늘 이미 라운드트립으로 살아남는다.** 저장 경로 변경 없이 ref 모드가 영속된다.
- fillet/chamfer 검증은 `childExtrude` 가 **존재하고 kind==='extrude'** 임을 요구한다.

### 5.2 승격 규칙 (W2-B 가 구현)

저장된 트리의 fillet/chamfer 노드에 대해:

```
if (payload.childId 있음)          → 이미 ref 모드. 그대로 통과.
else if (dependencies 중 kind==='extrude' 인 노드가 정확히 1개)
                                   → childId = 그 노드 id 로 승격.  ★주 경로
else if (dependencies 에 extrude 가 0개)
                                   → 승격 불가. 레거시 임베디드로 유지(동작 보존).
else (extrude 가 2개 이상)         → 모호. 승격 금지, 레거시 유지 + 경고 기록.
```

**핵심: 마지막 두 줄에서 추측하지 마라.** 승격 실패는 **손실이 아니다** — 레거시 경로가
그대로 동작하므로 사용자 모델은 열리고 렌더된다. 다만 그 노드는 하류 재생성 혜택을 못 받는다.
"열리지만 파라메트릭하지 않음" 이 "잘못된 상류에 연결됨" 보다 **무조건 낫다.**

승격 결과를 `{ promoted: string[], skipped: Array<{id, reason}> }` 로 반환해 UI 가
"이 피처들은 상류 연결을 확인해 주세요" 를 띄울 수 있게 하라.

### 5.3 스냅샷 동기화

승격된 노드는 `childId` 와 `childExtrude` 를 **둘 다** 갖는다(§5.4 이유).
승격 직후 `syncEmbeddedSnapshots(tree)` 를 한 번 돌려 스냅샷을 라이브 상류와 일치시켜라.
(featureTree.ts 에 구현·테스트 완료. 멱등이며, 비-ref 노드는 참조 동일성 유지 →
`diffTrees` 의 레퍼런스 비교가 깨지지 않는다.)

### 5.4 왜 `childExtrude` 를 아직 지우지 않았나 (정직한 잔여 부채)

지울 수 없었다. `childExtrude` 를 optional 로 만들면 **`src/lib/occt/featurePlan.ts` 가 깨진다**
— W2-0 의 **절대 금지 파일**이다(`src/lib/occt/**`). 다음 소비자들이 아직 스냅샷을 직접 읽는다:

| 파일 | 용도 | 트랙 |
|---|---|---|
| `src/lib/occt/featurePlan.ts` | fillet 의 바디를 먼저 build | **금지 구역** — 별도 트랙 필요 |
| `src/lib/brep-bridge/stepWriteFilletChamfer.ts` | STEP 기록 | W2-A 이후 |
| `src/lib/cad/featureTreeStats.ts` | 체적/bbox 통계 | W2-A 이후 |
| `src/lib/ai/featureTreePlanner.ts` | AI 플래너가 payload 생성 | W2-A 이후 |

**따라서 오늘의 정확한 상태**: SCAD 방출 경로는 참조 기반으로 **정확**하다.
위 4개 소비자는 여전히 스냅샷을 읽으므로 **ref 모드 트리에서 낡은 값을 볼 수 있다.**
완화책이 `syncEmbeddedSnapshots(tree)` 이며, 이들 호출 직전에 돌리면 된다.

**최종 제거 조건**: 위 4개가 전부 `EmitContext` 로 해석하도록 전환되면
`childExtrude`/`childScad` 필드와 `syncEmbeddedSnapshots` 를 **함께** 삭제한다.
그때 `featureTreePersist` 의 fillet 검증에서 `childExtrude` 필수 조건을 제거하고
`SCHEMA_VERSION` 을 2로 올린다.

---

## 6. W2-A 체크리스트 (chamfer 를 예로)

fillet 과 **동형**이다. 그대로 복사하라.

1. `ChamferFeature` 에 `childId?: string` 추가. `childExtrude` 는 **required 유지**(§5.4).
2. `resolveChamferChild(feature, ctx?, selfId?)` 추가 — `resolveFilletChild` 를 그대로 본뜬다.
   `childId` 없으면 스냅샷, 있는데 ctx 없으면 **throw**.
3. `chamferToScad(feature, ctx?, selfId?)` 로 시그니처 확장. 내부에서 `child.loop`/`child.depth`
   를 쓰도록 교체(변수 하나 스레딩).
4. `featureTree.ts` 의 `renderNode` 에서 `chamferToScad(p, ctx, node.id)` 로 호출.
   **← 이 한 줄만 featureTree.ts 를 건드린다.** 통합 시 충돌 지점이므로 오케스트레이터에 보고.
5. `buildChamferFeatureRef(childId, snapshot, ...)` 추가.
6. `upstreamRefsOf` 는 **손대지 않는다** — 덕타이핑이 `childId` 를 자동 인식한다.

pattern 2종은 `requirePayload` 대신 **`requireScad`** 를 쓴다(§2.2).
hole/rib 은 **참조 신설**이며 성격이 다르다(§2.1) — optional 로 추가하고 미지정 시 현행 유지.

---

## 7. 검증 현황 (실행 근거)

| 항목 | 결과 |
|---|---|
| `src/lib/cad` 기존 테스트 | **517 → 517 통과, 무회귀** |
| W2-0 신규 테스트 | **15 통과** (`__tests__/downstreamRegen.test.ts`) |
| `src/lib/cad` 합계 | **532 통과 / 27 파일** |
| `src/lib` 전체 (블라스트 반경) | **4,900 통과 · 16 skip · 실패 0** |
| `npx tsc --noEmit` | **exit 0** |
| 게이트 시나리오 | **f2 changed? true** · 코어 큐브 Z `6 → 21` (= `depth-2r`) |

신규 테스트가 고정하는 것: 게이트 시나리오 · 증분↔전체 재방출 일치 · 소비(중복 방출 없음) ·
**레거시 경로가 여전히 상류를 추종하지 않음**(의도적 고정, 점진 전환 보장) · ctx 없는 방출 거부 ·
미선언 ref 거부 · 존재하지 않는 ref 거부 · kind 불일치 거부 · 순환 불가 · suppress 연쇄 및 복원 ·
boolean 기존 동작 보존 · 스냅샷 동기화 정확성/멱등성/참조 보존.
