# 다음 세션 인수인계 — 2026-07-20 (SolidWorks/Autodesk 대체 로드맵 Wave 1~3 완결)

**전임 문서**: `next-session-plan-260719b.md` (일반인 트랙·실시트랙 — 그 흐름은 -105 라이브로 완결)
**이 세션의 궤도**: 대체 로드맵 실행 — `docs/roadmap/REPLACEMENT_ROADMAP.md` + `docs/roadmap/EXECUTION_PLAN_PARALLEL.md`

## 0. 전략 컨텍스트 (불변)

- **최종 목표**: SolidWorks/Autodesk를 일부 전문가 외에는 안 쓰는 수준으로 대체. **Path A** = 오픈소스 커널(OCCT + planegcs), 로열티 없음 (ADR-013/016, `docs/strategy-path-a.md`)
- **서비스 목표**: 일반인+전문가 × 5도메인(기계·건축·토목·조경·인테리어)
- **불변 원칙**(모든 에이전트 프롬프트에 주입): 생성≠검증 · 날조 금지 · 근사는 명시 · 거부는 이유와 함께 · **실행하지 않은 판정은 판정이 아니다**
- **병렬 실행 규약**: EXECUTION_PLAN_PARALLEL.md §0 — 트랙별 파일 소유권 배타 · **에이전트는 커밋 금지**(오케스트레이터 전용 — 병렬 커밋은 전역 tsc pre-commit에 데드락) · 게이트는 정량만 · 동시 6~8트랙 상한 · 수렴 문제는 W2-0 패턴(직렬 선행 후 fan-out)
- **커밋 규칙**: 800줄/15파일 상한(`ALLOW_BIG=1`+사유), `[P0/P1/P2]` 접두사, 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## 1. 완료 (이 세션, 전부 커밋됨 — HEAD `b8dc9cd4`)

### Wave 1 (R0) — 신뢰 기반
- **R0-0** OCCT 검증 게이트 default-ON(숨은 141 테스트, +9s) — skip 사유가 거짓이었음(실커널 790ms 로드)
- **R0-1** 역할 접두사 `a/`,`b/` → 피처ID (S2b 오매칭 50%→명시 상실)
- **R0-2** 매처 마진 게이트 `MIN_MARGIN=0.08` + lost 시 `severity:'blocked'` 명시 거부(스테일 클릭좌표 silent 폴백 폐쇄)
- **R0-3** 스케치 원 방출 3개 끊긴 링크 복구(emission·picking·constraintNeedsTwo)
- NURBS는 실측 후 기각(`fitNurbsThroughPoints`가 보간 아님 — 9.68mm 편차)

### Wave 2 (R1) — 하류 재생성 데이터 모델
- 내장 payload 사본(`childExtrude`) → id 참조 + EmitContext 해석. `refs ⊆ dependencies` 불변식, suppress 캐스케이드
- 게이트 시나리오 통과: extrude 10→25 → 필렛이 cube([16,16,21])로 따라감. featurePlan이 구솔리드를 필렛하던 버그 수정
- hole·rib는 측정 후 "리프 유지"가 옳다고 판정(자기완결 툴바디, Z 규약 상이)

### 도그푸딩 + 자가 수정 (D1~D4)
- 실사용 15건 발견(`docs/dogfood-findings-260719.md`) → 13건 수정. 관통 진단: "테스트가 통과하는 이유는 각 단계가 자기 계약을 지키기 때문이고, 실사용이 깨지는 이유는 단계 사이에 계약이 없기 때문"
- 잔여: **F5**(문=`role:'door'` 선언 필요 — domain-assemblies 선행) · **F14**(어셈블리 API 표면 불일치 → W5-F)

### Wave 3 (R2+R3 선행) — 6트랙, 게이트 통과 ★
**ADR-017 필수 기준(전 시나리오 오매칭 0%)을 System A가 최초 충족** (오케스트레이터 직접 재실측):
S1/S2/S2b/S3 = 100%/0%, S4 = 전량 명시 상실/0%, fidelity 39/39. 상세는 ADR-017 재실측표.

| 트랙 | 내용 | 커밋 |
|---|---|---|
| W3-A | 심 명명 `seam(생성면쌍키)` — BRepAlgoAPI Modified/Generated/IsDeleted + BooleanOperandIds 스레딩. 구식 이름=legacy 명시 상실 | `88626323` |
| W3-B | `buildRevolveTopo`(e.lat/e.mer/e.axis/e.seam)+`patternTopo`({child}@{k}) — 실커널 755케이스 오매칭 0. **브리지 배선 완료**(`buildFromRevolve`→fromAnchors, e.lat.2 필렛=파푸스 6270.00 일치) | `9e9b2a5d`+배선은 88626323 |
| W3-C | `src/lib/drawing/measure.ts` 실측 치수 코어 — 27/27 at 1e-6, MeasureFail 8종 명시 거부, `valueBasis:'projected'`+foreshortened | `c9cf56b4` |
| W3-D | STEP 왕복 — wasm32 SSO 10자 경계가 근본원인. `/o.step`(7자)+`assertStepPathMarshalSafe`. rel 1e-9 왕복 6/6 | `5c6f1629` |
| W3-E | 원 rim-offset 커플링(concentric 단독=반경 보존)+rank 기반 DOF(lastJ===null 선재 버그). W1-D 한계 테스트 2건 FIXED 반전 | `b8dc9cd4` |
| W3-F | 전도 팔길이 CG스팬→접지 footprint. counter_bar 종전 FS 1.81=유령 베이스(실측 0.94) 적발 | `11b77bb8` |

### 회귀 확인 (이 세션 실측)
tsc 클린 · src/lib **5,080** · drawing-to-3d **219** · sketch 폴더 **389** · dogfood **20** · visual-golden **14/14** · nodeOcctBridge **29/29**

### ⚠️ 미완 검증 1건 (다음 세션 최우선 확인)
`npx vitest run "src/app/[lang]/shape-generator"` **전체** 스위트 러너가 CPU 4,200초+/1시간 넘게 무종료 → 중단시킴. sketch 하위폴더(W3 유일 접촉면)는 389/389 통과했고 나머지는 Wave 3 무접촉이라 회귀 위험은 낮으나, **행의 원인은 미규명**(특정 테스트 무한루프 or 스위트 규모). 다음 세션에서 하위폴더 단위로 분할 실행해 원인 파일을 특정할 것. `[lang]` 글롭이 vitest 필터에서 문자클래스로 해석될 가능성도 배제 안 됨 — 이스케이프 또는 하위폴더 나열로 실행 권장.

## 2. 다음 작업 — Wave 4 (→ G2 게이트: 기계가공 부품 도면)

| 트랙 | 내용 | 파일 소유권 |
|---|---|---|
| **W4-A** | 치수 렌더 배선 — SheetRenderer `<linear>` 등을 measure.ts 실측값으로. **소비 표면은 measure.ts 헤더 가이드에 있음**(`Basis`/`viewBasis`·`KIND_REF_COUNT`) | SheetRenderer·dimension 렌더부 |
| W4-B | 연관 도면(associative) — 모델 변경 시 도면 뷰·치수 자동 갱신(topo 이름 참조라 기반은 완성) | 도면 갱신 파이프 |
| W4-C | 상세도(detail)·파단도(broken) 뷰 | projectView 확장 |
| W4-D | GD&T·표면조도 UI 배선(코어는 기존) | 도면 UI |

G2 판정 기준은 REPLACEMENT_ROADMAP.md. 이후: **Wave 5**(8트랙 — F14 어셈블리 API 표면=W5-F, loft/thread/draft/pattern 실체화, 인터롭, 브라우저 워커 seamKeys 공급) → **Wave 6**(PDM, /api/documents 500 수정) → **Wave 7**(해석).

## 3. 정직 기록 잔여 (Wave 3에서 이월)

1. System B(기하 서명) S6 rows[55] 극단 스케일 1행 4/24 오매칭 — A 무관, 마진 게이트가 방어선
2. face 앵커 매칭 미검증(edge만 실측) — W4-A에서 face 참조 쓰기 전에 실측 필요
3. pattern 커널 배선 없음(featurePlan에서 pattern 미지원 유지)
4. `childExtrude` 완전 제거는 SCHEMA_VERSION 2 대기
5. 브라우저 워커 심 명명 여전히 legacy midpoint 서수(worker 경로 seamKeys 미공급) — Wave 5 후보
6. 태스크 #23 "R3 실측 치수" = W4-A 완료 시점에 completed 처리

## 4. 검증 명령 (재현)

```bash
npx vitest run scripts/spike/topo-naming-k22.test.ts   # ADR-017 게이트 (System A 전 구간 0% 확인)
OCCT_REAL=1 npx vitest run src/lib/occt/nodeOcctBridge.test.ts  # 29/29 (revolve 배선 포함)
npx vitest run src/lib                                  # 5,080
npx vitest run scripts/drawing-to-3d && node scripts/drawing-to-3d/visual-golden.mjs  # 219 + 14/14
npx vitest run "src/app/[lang]/shape-generator/sketch"  # 389 (전체는 §1 ⚠️ 참조)
npx tsc --noEmit
```

주의: 스파이크 재실행은 `topo-naming-k22.result.json`의 generatedAt 타임스탬프만 바꿈 — 수치 동일하면 checkout으로 복원.

## 5. 배포 메모

이 세션은 코어 라이브러리/커널 계층만 변경(사용자 노출 UI 변화 없음) — 단독 배포 불요.
Wave 4(W4-A 도면 렌더)부터 사용자 가시 변화 → 그때 배포 배치. 절차: Dockerfile CACHEBUST 범프 → `npx @railway/cli up --service nexyfab.com --detach` → `node scripts/e2e/smoke-3surface.mjs --base https://nexyfab.com`
