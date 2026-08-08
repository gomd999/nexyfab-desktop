# 세션 인수인계 260809 — F-track 완주 후 잔여 1건 + 상용 관문

**전제 문서**: 실행 계획 정본 = `docs/strategy/execution-plan-260808b.md`(§1.13 완성 트랙 표에 전 항목 체크·커밋 해시). 이전 인수인계 = `session-handoff-260808.md`(외부 staging 게이트·5분야 holdout — 여전히 유효). 이 문서는 260808~260809 이틀 루프의 마감 상태와 **다음 세션 1순위**를 담는다.

## 0. 한 줄 요약

두 축("AI 정확도 개선 ∥ AI CAD+정밀 CAD") F-track **F-0~F-6·G-0 전부 완료**(브라우저 이중 증명 포함), 그 과정에서 P0 커널·인프라 결함 3건 근본수정. **잔여 코드 작업 1건**(워커 홀 체인 — 아래 §2)과 **👤 관문 3건**(§4)만 남음. 미push 로컬 커밋 ~90개.

## 1. 이번 루프 완료 내역 (커밋 fa5398c7..c4db718f, 총 19)

| 항목 | 내용 | 커밋 |
|---|---|---|
| F-0 베이스리스 | 'none' 셰이프+빈 업스트림 병합+**BVH 가드**(position 부재 지오메트리에서 three-mesh-bvh throw→generate() null 강등→lastGood 폴백이 옛 박스 표시하던 3층 결함) | fa5398c7 |
| F-1 보스 | 컨버터 판정·faceFrame 시드·SCAD 방출·**faceFrame 메시 압출 편측(0..d) 커널 일치** | ae2477d1·fa5398c7 |
| F-2 도면 치수 D-1 | HLR 3뷰 해석 치수(모델값) — **브라우저 실렌더 확인**(260809) | 578f10a4 |
| F-3 과구속 진단 | mateMobilityDiagnosis(야코비안 랭크)+패널 ⚖배지 | 02ac4187 |
| G-0 어휘 마감 | rib/shell 시드 매핑+원판 보스 | 3914e113 |
| F-6 멀티바디 | assemblyToPartsProgram→setAssemblyParts, **브라우저 4/4** | 3eed9b40 |
| **[P0] 커널 정렬** | XY 압출 B-rep 0..d→중심대칭(±d/2) — 표시/STEP/HLR 반깊이 어긋남 해소. 구규약 저작물 재저작(코퍼스 시드 16·directEdit·extrude·K7) | 362b1275 |
| F-4 원형 치수 D-2 | 투영 사상 실측 핀(front(x,−z)/top(x,y)/**right(−y,−z) 정정**)+svgCircleExtract ⌀그룹·위치 스태거 | 82ced12d |
| F-5 스윕 인증 | 뷰포트 힌지→Pro 솔버(runMotionSweep)+프레임별 BVH 충돌·기준접촉 차등, 패널 ⟳배지 | 3d95b8e9 |
| **[P0] 진입/인프라 3건** | ①OCCT 자동활성 기아(ric 무기한 미호출 실측→3s 보증) ②워커 핸들 페리+PROJECT_VIEWS RPC ③도면 뷰 정식 진입점(뷰포트 📐 플로팅 토글) | 258ecb59 |

전 게이트: tsc 0 · 관련 스윕 904+ 그린 · OCCT 체인/번인/코퍼스 16/16 · 브라우저 증명 F-0/F-1 6/6·F-6 4/4·F-2 실렌더.

## 2. ▶다음 세션 1순위 — 워커 홀 체인의 홀 없는 핸들 (실측 완료, 원인 미규명)

**증상(브라우저 실측)**: 챗 핸드오프 판(rect 100×60×8 + hole ⌀10 ×2) → 워커 파이프라인 → 페리된 최종 `occtHandle`("occt:2")을 HLR 투영하면 **3뷰 전체에 원이 하나도 없음**(순수 박스 아웃라인 14경로뿐). 메시 표시에는 구멍이 있다 — B-rep 체인만 홀을 잃는다.

**왜 지금 드러났나**: 워커 핸들은 258ecb59 이전엔 페리 자체가 없어 아무도 투영해 본 적이 없다(가려져 있던 결함).

**용의 지점**(`src/app/[lang]/shape-generator/features/hole.ts` 150~185행):
- `resolveBrepHostHandle`/`hostBoxFromGeometry` → `occtBoxBooleanWithPrimitive('subtract', host, {cylinder...}, undefined, currentHandle)` 체인.
- 가설 후보: ①cut 실패 시 host-only 핸들을 성공으로 반환(역사적 "silently-wrong-geometry class" — occtEngine.ts 2447행 주석 참조) ②중심대칭 정렬(362b1275) 이후 cy/cz 좌표 규약 어긋남 ③핸들 승계(occt:1→occt:2) 중 두 번째 홀이 bbox 재구축으로 첫 홀 소실. **추측 배선 금지 — 노드 재현부터**: `occtBoxBooleanWithPrimitive`를 노드에서 같은 파라미터로 호출→`occtProjectViews`로 원 존재 검증하는 테스트를 먼저 작성하면 ①~③이 즉시 판별된다.

**완료 기준**: 노드 재현 테스트 그린 + 브라우저 F-4 DOM 증명 통과(⌀10 라벨·×2 그룹·위치치수 텍스트). 증명 스크립트 골격은 §3 참조.

## 3. 검증 인프라 (재현법 — 전부 실측 검증된 절차)

```bash
# 클린 빌드(필수 — dist 재사용=비결정 예외·죽인 빌드=.next 스테일 락)
# ⚠️ 서버 켜둔 채 rm .next → 'Device or resource busy' — 먼저 서버 kill
NODE_OPTIONS=--max-old-space-size=8192 npm run build
# 스탠드얼론 서버(포트 3311): 스크래치패드 run-standalone.sh
#   (.next/static+public 복사, JWT_SECRET=../.env, NEXYFAB_DB_PATH=/tmp)
```

**브라우저 프로브**(Playwright, 세션스토리지 시드 → `window.__nfabProbe()`):
- 시드 키 `nexyfab:studio-handoff-program`, 이동 `/kr/shape-generator?expert=1&mode=expert`
- 프로브 필드: bbox·scene.selectedId·nodes·pipelineErrors·resultNull·baseNull·baseGenError·**resultOcctHandle·resultHandleInWorker**·placedParts
- 도면 뷰: `[data-testid=drawing-view-toggle]` 클릭 → `실투영` 텍스트 버튼 `waitFor`(dynamic import 마운트 지연) → 클릭 → 12~15s 대기 → `.drawing-view-svg` 내 `<text>`/`<path>` 검사
- OCCT 자동활성은 3s 보증(258ecb59) — 시드 후 18s 대기가 안전

## 4. 👤 사용자 관문 (변동 없음)

| 신호 | 잠금해제 |
|---|---|
| push/배포 | M-C1 베타 + F-7(깊이 확장·텔레메트리 데이터 주도) + 누적 ~90커밋 반영 |
| 홀드아웃 소스+리뷰어 2인 | M-C4 인증 수치 1호(킷 완성 상태 — `mc4-certification-kit-260808.md`) |
| Paddle 계정 | M-C3 결제 |

## 5. 핵심 재사용 지식 (이번 루프에서 실측 확립)

- **좌표/투영 사상(실측 고정, 테스트 핀 있음)**: 명명 뷰 front=(x,−z)·top=(x,y)·right=(−y,−z) (`drawingProjectionMapping.test.ts`). XY 압출 B-rep=메시 동일 중심대칭(±d/2, planeOffset=중간평면). 어셈블리 시드: box=모서리원점→PlacedPart.position=중심, (x,y,z)→(x,z,y).
- **이중 증명 원칙의 실증**: 노드 테스트는 BVH 프로토타입 확장·OCCT 워커 레지스트리·requestIdleCallback 기아를 **구조적으로 못 본다** — "화면이 안 바뀜"류는 반드시 프로브 계측(resultNull/baseGenError)부터.
- **fail-closed 패턴**: not_run≠0, 기준자세 접촉 차등(mateMotionSweep), 부분 약속 금지(버튼 숨김), 슬라이더 상한 초과=거부(조용한 클램프 방지).
