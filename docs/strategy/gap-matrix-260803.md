# 기능 갭 매트릭스 — 상용 CAD 20권 vs NexyFab (260803, D5)

> ▶ 리뷰어 피드백 「UI 옵션이 너무 적음」·「어떤 제품이 가능한지」에 대한 **정량 근거**.
> 기준선은 `Downloads/새 폴더 (6)/` 상용 매뉴얼 20권이고, 각 매뉴얼의 기여는 CAD 백과사전
> §0.3 「첨부 자료의 역할 지도」가 이미 요약해 뒀다(그 표를 기준으로 삼는다).

---

## ⚠ 이 문서를 만들면서 **내 주장 4건이 틀린 것으로 드러났다**

이 매트릭스는 처음에 기억과 이전 대화로 작성됐다가, 항목별로 실측하면서 계속 뒤집혔다.
그 자체가 기록할 값이 있다 — **문서는 실측 없이 쓰면 틀린다.**

| 이전 주장 | 실측 결과 | 확인 방법 |
|---|---|---|
| 「조인트/구속 = 없음」 | **있다.** `assembly-constraints.mjs` — offset·concentric·onFace·mirror·centerline. `buildAssembly:615` 가 실제로 호출한다 | `grep -n resolveConstraints assembly.mjs` |
| 「질량특성(관성) = 있음」 | **관성은 없다.** `structural` 은 질량·CG·반력·부재응력·전도까지 | `Object.keys(built.structural)` |
| 「Field-to-Finish = 없음」 | **있다.** `groundFromSurvey(elements, points)` — 측량점→지표면 | `grep -rn groundFromSurvey scripts/` |
| 「코리더 = 문자열 있음」 | **아니다.** `corridorMm` 은 선형 주변 **측방 필터 폭**이지 Civil 3D 코리더 모델링이 아니다 | `alignment-geom.mjs:339` |

⚠ 첫 번째가 가장 컸다 — **관계 배치 엔진이 이미 있는데 스키마·프롬프트에 없어서
아무도 못 쓰고 있었다**(템플릿 0건·AI 0건). 그것이 부유 28/42 의 근본 원인이었다.
「없다」와 「닿지 않는다」는 다르고, 후자가 훨씬 흔하다.

---

## 매트릭스

기준선: **SOLIDWORKS·Fusion 360 3권**(D0 에서 타깃을 기계설계 실무자로 확정 §8).
토목·건축·조경은 참고로 둔다.

### 기계 (Fusion 360 / SOLIDWORKS) — 주 전선

| 매뉴얼이 기대하는 것 | NexyFab | 근거 |
|---|---|---|
| 파라메트릭 설계 | ✅ | 어휘 38종 + `shape-generator` 140피처 |
| 어셈블리 | ✅ | 템플릿 55종 · `buildAssembly` |
| **조인트/구속** | ✅ **(260803 배선)** | `resolveConstraints` 5종. **엔진은 있었고 AI·템플릿이 못 쓰던 것을 이번에 배선** |
| 충돌·간섭 | ✅ | `interferences` + 체결구 관통 면제 |
| 재질·**질량**·CG | ✅ | `structural.totalMassKg` · `cgWorldMm` |
| **관성 텐서** | ❌ | `structural` 에 없음. 동역학·모달에 필요 |
| 응력해석 | ✅ | FEA 스위트(TET10) + 계산기 62종 |
| B-rep 오류검사 | ✅ | `buildSolidRobust` 드롭 보고 + 게이트 38 |
| **STEP 파트 트리·이름** | ✅ **(260803)** | `exportSTEP` + ISO 10303-21 한글 이스케이프 |
| 공차·GD&T | ✅ | GD&T 6모듈 · `tolerance_stack` |
| **모션/기구 해석** | ❌ | `four_bar` 는 정적 형상. mobility·자유도 판정 없음 |
| **시트메탈 전개** | ⚠ | `sheet_profile` 전개장 계산은 있으나 전용 워크플로 아님 |

### 토목 (Civil 3D / MicroStation)

| 기대 | NexyFab | 근거 |
|---|---|---|
| 선형(alignment) | ✅ | `alignment-geom` IP·곡선·측점 |
| **Field-to-Finish · 측량점** | ✅ | `groundFromSurvey` · DXF 임포트 |
| 종단·수직곡선 | ⚠ | 종단 요소 일부. 설계선 편집 없음 |
| **코리더 모델링** | ❌ | 횡단면 어셈블리를 선형 따라 스윕하는 Civil 3D 코리더는 없음 |
| 토공량 | ✅ | `earthwork_grid`(점고법·TIN) · `mass_haul` |
| 배수·수문 | ✅ | 합리식·Manning·관망·DFU |

### 범용/파라메트릭 (Rhino / Grasshopper — 매뉴얼 5권으로 최다)

| 기대 | NexyFab | 근거 |
|---|---|---|
| NURBS·Brep | ✅ | OCCT(replicad) · loft/sweep |
| **데이터 트리·그래프 편집** | ❌ | 파라미터 편집은 있으나 노드 그래프 없음 |
| 스크립팅 | ⚠ | 템플릿 `build()` 가 사실상 스크립트지만 사용자 노출 없음 |

---

## 결론 — 진짜 빈 칸은 4개다

```
① 관성 텐서        동역학·모달의 전제. PBAS 역학코어(§2.2)에 있다 — 이식 대상
② 모션/기구 해석    mobility·자유도. 같은 PBAS 코어에 있다
③ 코리더 모델링     토목 전용. 첫 버티컬(배관 스키드)이 아니므로 우선순위 낮음
④ 데이터 트리       Grasshopper 계열 UI. 제품 방향 결정 필요(§0.10 참조)
```

**①②가 같은 곳(PBAS)에 있다** — 계획서 B6(역학코어 이식)의 근거가 이 매트릭스로 확인된다.
③④는 D0 에서 확정한 첫 버티컬 밖이다.

## 그리고 리뷰어 피드백에 대한 답

> 「UI 옵션이 너무 적음」

기능이 아니라 **발견 가능성** 문제다. 실측:
- `Studio ↔ Expert` 전환이 **이미 앱 안에 있다**(`ShapeGeneratorClientPage:47`)
- GD&T 6모듈·공차 스택·구조검증이 다 있는데 진입점이 약하다
- 그리고 이번에 확인했듯 **관계 배치 엔진처럼 「있는데 안 닿는」 것이 더 있을 수 있다**

→ D2 의 범위는 「새로 만들기」가 아니라 **「있는 것을 찾게 하기」**다.

## 재검증 방법

이 표의 각 행은 위 「확인 방법」 열의 명령으로 다시 잴 수 있다.
⚠ **기억으로 갱신하지 마라** — 이 문서를 쓰는 동안에만 4건이 뒤집혔다.
