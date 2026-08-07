# 세션 인수인계 — 2026-08-07 워크스페이스 복구·P0~P2

- 브랜치: `feat/landing-chat-first` (HEAD `c7579dc9`, origin 동기화 완료)
- 정본 상태 문서: `docs/strategy/current-status-evaluation-and-execution-tracker-260807.md`
- 현재 감사: **379/379 pass** (`npm run audit:ai-cad-baseline`)
- 전체 단위 테스트: **26,123 pass · 실패 0** (26,212 중, 88 skip·1 todo)

## 1. 오늘 완료한 것

### 워크스페이스 사건 점검 — 유실 0 확정

새벽 파일 표시 이상 사건(`nexyfab.com/CURRENT_WORKSPACE_STATUS_GPT_260807.md`)에 대해
v3 체크포인트(`C:\tmp\nexyfab-workspace-checkpoint-260807-v3`) manifest 842개 파일을
전수 해시 대조: **누락 0 · 동일 837 · 이후 정상수정 5**. git fsck 클린.
사건 당시 관찰된 "v3와 다른 SHA의 ifcSemanticEvidence.ts"는 실체 미확인
(현재본=v3 동일, mtime 8/5) — 비정상 뷰에서의 오독으로 추정.

### P0 — 작업 보전 (배치 커밋 + 최초 push)

미커밋 14,713줄 + 신규 776파일을 논리 단위 6커밋으로 분할 커밋하고
브랜치를 origin에 **최초 push** (1,945커밋):

| 커밋 | 내용 |
|---|---|
| `1560476a` | IFC/STEP 실형상 복원 (brep-bridge·io) + 도면 테스트 갱신 |
| `747f579d` | 참조 corpus 거버넌스 (lineage-v2·Phase B·joint gate) |
| `40628991` | AI 생성 파이프라인 |
| `81ebc6fc` | CAD 커널·어셈블리 라이브러리 |
| `f8b71d8e` | 앱 셸·API 라우트·워크스페이스 UI |
| `70f3b66e` | 스크립트·전략 문서·빌드 설정 |

⚠️ `docs/evidence/` 대용량 산출물(208파일 ~155MB)은 저장소 관례대로 **git 비추적 유지**
— 보존처는 C:\tmp 체크포인트뿐(같은 디스크). §3 잔여 리스크 참조.

### P0.5 — 실패 테스트 18건 전량 수정 (회귀 0건)

모두 "의도된 업그레이드를 테스트 기대값이 못 따라온 것"으로 확정:

- IFC 4건: 임포터가 IfcFacetedBrep를 AABB 박스 근사 → 정확 표면 메시+수밀 체적
  (`exact_surface_mesh`)으로 승격. 라운드트립 기대값 갱신(L-프리즘 실부피 32000 정확 주장).
- 도면 14건: `_content.tsx` 참조검토 파티션(`referenceReview.ts`) 도입으로 더미 참조
  ('e1/e2') 치수가 시트·내보내기에서 제외됨 → 유효 topo 참조(`f.side.*`, `e.vert.*`)로
  교체, R5 재지정 진입점을 검토 큐(`drawing-reference-review`)로 이동.

### P1 — lineage-v2 88건 native 재추출 (커밋 `bf69275b`)

- 추출 도달: 31/88 (STEP 31 · IFC 4 포함). 중복 0 · unknown 0 · structure fail 0.
- **ZIP 28건 멤버 triage 완결** (`scripts/reference/triage-lineage-v2-zip-members.ts` →
  `zip-member-triage.json`): 아카이브 sha256=요청 sourceHash 28/28 일치, 멤버 sha256 결속.
- **핵심 판정: ZIP 내부에 로컬 추출 가능 멤버(STEP/IGES/IFC) 0건** — 전부 외부 워커 포맷
  (SolidWorks 9 · AutoCAD/ODA 11 · Revit 5 · Inventor 2 · Creo 1). 감사 체크
  `zip_triage.local_executor_available=0`으로 고정 — 워커가 생기면 감사가 알려줌.
- 라우팅 매니페스트 141개 job 소스 해시 독립 재계산 **141/141 일치**.
- IGES 2건은 원칙적 not_run(대형 타임아웃→`large_iges_worker`, 비강체 스케일 변환→
  `iges_non_rigid_transform_worker`).
- 미달 항목: coverage 증가 — **로컬 한계 도달**, 외부 워커(P4) 종속으로 이관.

### P2 — joint·motion·clearance, 로컬 가용 범위 완결 (커밋 `4c722dc3` + `c7579dc9`)

신규 모듈 2종 + 테스트 19종 + capability 아티팩트
(`docs/evidence/joint-motion-clearance-260807/specimen-run-1.json`,
재생성=`npm run evidence:joint-motion-clearance`):

1. **`src/lib/reference/jointMotionClearanceCertificate.ts`**
   - joint↔occurrence 결정론 해시 결속 (transform 1e-9 정밀도, 미지 타입 fixed 변환 금지)
   - 계획된 스윕 매 프레임 `preciseSeparation` 정밀 메시 충돌·간극 인증서
   - fail-closed: pair 예산 소진·기하 부재·미수렴 프레임 = not_run (false-clear 0)
   - 해석값 실증: 2링크 스펙시멘 0→90° 최소 간극 **정확히 5mm**, 0→180° 되접힘
     첫 접촉 해석 126.87° → 5° 격자에서 검출
2. **`src/lib/reference/userConfirmedJointGuard.ts`**
   - 확정 = joint 정의 해시 결속 (정의 변경 시 자동 실효, stale 확정은 repair 전체 fail)
   - 편집 가드: 확정 joint/치수 연산 거부, 명시 override로만 해제 (같은 값 no-op 허용)
   - 국소 repair: 인증서의 실패 joint만 제안 (격자 마지막 clear 값으로 상한 축소,
     **재인증 필수**), 확정 joint는 자동 수정 대신 `user_input`

P2 잔여는 전부 외부 종속: worker 연결, 비-revolute 타입 컴파일, 제품군별 승인
어셈블리 3개 pass.

## 2. 앞으로 해야 할 것 (우선순위 순)

### P3. Phase B 인간 검토 파일럿 — ★사용자/검토자 수작업 필요

95% 정확도 증명의 진짜 병목. ground truth 승인 **0/88**, 이게 0인 한 1,800-run
캠페인을 시작할 수 없음.

1. 검토 양식 32건이 이미 생성돼 있음:
   `docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-forms/`
   (런북: `docs/strategy/phase-b-human-review-runbook-260807.md`)
2. 검토자(사용자 본인 또는 위임)가 양식 작성 → `npm run evidence:phase-b-submissions-validate`
3. dual signoff 정책이라 승인 2인 필요 — 1인 운영이면 정책 조정 여부부터 사용자 결정
4. 부족 제품군 32건 확보 병행 (robot 11 · pressure_vessel 9 · turbomachinery 9 ·
   gearbox 3) — 라이선스 확인된 소스만, lineage 중복 금지

### P4. 외부 native worker 호스트 확보 — ★환경/비용 결정 필요

- 필요 실행기: SolidWorks(수요 최대: 직접 20+zip 9), Inventor(iam 4+zip 2), Revit 5,
  AutoCAD/ODA 11, Creo, CATIA, Parasolid, 대형 IGES 워커
- 계약·라우팅·canary 게이트·호스트 preflight는 전부 구축돼 있고 **worker ready 0**이 유일한 공백
- 배포 가이드: `docs/strategy/native-cad-worker-host-deployment-260807.md`
- 연결되면: lineage-v2 coverage 31/88 상승 + P2 비-revolute joint + DWG/Revit exact 진행

### 잔여 리스크·정리 항목

- [ ] **docs/evidence 외부 백업** (~155MB + C:\tmp 체크포인트) — git 비추적이라
      로컬 디스크가 단일 보존처. 외장/클라우드로 1회 백업 권장
- [ ] C:\tmp 체크포인트 3종은 워크스페이스 안정 확인 후에도 당분간 보존 (삭제 금지)
- [ ] 라이브 배포 반영 여부 결정 — 오늘 커밋분은 repo에만 있음. 배포 시
      `railway up --service nexyfab.com` + Dockerfile CACHEBUST 범프 (메모리 규칙)
- [ ] IFC exact volume 42.78% 상향 (open mesh closure) — P1 IFC 재추출과 묶어 후속
- [ ] 사용자 확정 가드를 API/UI 계층에 배선 (현재는 라이브러리+게이트 계층까지)

## 3. 검증 방법 (다음 세션 시작 시)

```bash
cd nexyfab.com/new
npm run audit:ai-cad-baseline      # 379/379 pass 기대
npm run typecheck                  # 무출력=통과
npx vitest run src/lib/reference/jointMotionClearanceCertificate.test.ts \
  src/lib/reference/userConfirmedJointGuard.test.ts   # 19 pass 기대
git --git-dir=.git --work-tree=. status -sb           # origin과 동기화 확인
```
