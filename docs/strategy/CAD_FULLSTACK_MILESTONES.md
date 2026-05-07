# 풀스택 기계 CAD 로드맵 — 마일스톤

목표: **상용 수준의 3D 기계 설계 CAD**다. 즉 **파트(스케치–피처–히스토리)·어셈블리(배치·메이트·간섭)·3D 교환·도면/CAM 파생**을 같은 제품 안에서 신뢰 가능하게 쌓는 것이 북극성이다. (순수 2D만이 아니라, **3D가 단일 진실 소스**이고 2D·가공·검증은 여기서 파생된다.)

기간은 팀 규모·커널 전략에 따라 변동하므로, 아래 **분기(Quarter)는 가이드**이며 롤링으로 조정한다.

**상용 3D 관점에서 반드시 커버할 축(이 문서의 M0–M7과 대응):** 기하·히스토리 재현성(M2), 어셈블리 일관성(M3), 도면/MBD 출구(M4), 검증·가공 브리지(M5), 리비전·협업(M6), 대형 어셈블리·엔터프라이즈(M7). M0/M1은 회귀·교환으로 **상용 데이터가 깨지지 않게** 하는 바닥이다.

---

## 원칙

1. **한 마일스톤 = 출시 가능한 “완료 정의(DoD)”**가 있어야 한다.  
2. **다음 마일스톤은 이전 마일스톤의 산출물**에 의존한다.  
3. **커널·STEP 등**은 초기부터 “전부 자체 개발”에 묶이지 말고, **라이선스/OSS + 워커** 옵션을 병행해 리스크를 낮춘다.  
4. **3D 파이프가 우선** — 뷰어·도면·보내기는 3D 스키마와 동기화되어야 하며, “보이기만 하는 UI”와 “저장·재생성되는 모델”을 혼동하지 않는다.

**일괄 자동:** `npm run verify`는 `typecheck` 후 **`m0` → `m1` → `m2` → … → `m7`** → `security:smoke`를 순서대로 실행한다(M2 단계에서는 M0/M1과 겹치는 Vitest만 생략해 중복을 줄인다). 단독으로 돌릴 때는 `npm run m2`가 여전히 M0·M1·M2 회귀를 한 번에 포함한다. E2E까지 한 번에 보려면 `E2E_BASE_URL` 또는 `CI=true`를 두고 `npm run verify:e2e`.

---

## M0 — 기준선 & 회귀 (항상 진행)

**목표:** 이후 변경이 깨뜨리지 않도록 **안전망**을 둔다.

**산출물 (구현됨)**

- **자동:** `npm run m0` → 타입체크 + 골든 `.nfab` 파싱 (`tests/golden/m0-minimal.nfab.json`).  
- **문서:** [M0_BASELINE.md](./M0_BASELINE.md) (자동 저장 요약), [M0_RELEASE_CHECKLIST.md](./M0_RELEASE_CHECKLIST.md) (릴리스 수동 게이트).  
- **수동 스모크:** 체크리스트의 “열기 → 편집 → 저장 → 재열기” 플로우.

**완료 정의**

- `npm run m0` 통과 + [M0_RELEASE_CHECKLIST.md](./M0_RELEASE_CHECKLIST.md) 완료.  
- 알려진 크리티컬 버그 0건(또는 명시적 완화).

**의존:** 없음.

**가이드 기간:** 지속 (스프린트마다 10~20% 할당 권장).

---

## M1 — 교환(Exchange) v1: “가져오기·내보내기 신뢰” ✅ (기준선 완료)

**목표:** 현업에서 **다른 CAD와 손을 맞잡을** 수 있는 최소 교환 품질 + **클라우드 저장 경로(R2·API) 명시**.

**산출물**

- **문서:** [M1_EXCHANGE.md](./M1_EXCHANGE.md) — CAD 단위·포맷·한계 + **프로젝트 `sceneData` vs R2 파일** 이원 저장.  
- **수동:** [M1_RELEASE_CHECKLIST.md](./M1_RELEASE_CHECKLIST.md).  
- **UI:** `formatCadImportError` — 메인 가져오기·스케치 참조 import.  
- **자동:** `npm run m1` — M0 골든 nfab + M1 exchange 테스트.

**완료 정의**

- `npm run m1` 통과.  
- [M1_RELEASE_CHECKLIST.md](./M1_RELEASE_CHECKLIST.md) 수동 항목(교환 + 클라우드 저장 스모크).  
- 이후 M2+에서 **STEP 골든 바이너리 CI**·히스토리 연동은 별도 확장.

**의존:** M0.

**가이드 기간:** 1~2분기 (커널/라이브러리 선택에 따라 변동).

---

## M2 — 히스토리·모델링 신뢰 (Feature 파이프) ✅ (v1 기준선 완료)

**목표:** Sketch–Feature–History가 **재생성 가능**하고, 실패 시 **진단 가능**해야 한다.

**산출물**

- 피처 순서 변경/편집 시 **예측 가능한 결과** (파이프라인 롤백·캐시).  
- 재생성 실패 시 **어느 피처에서 왜** 실패했는지 표시 (`pipelineErrors` → 트리/토스트, `classifyFeatureError`).  
- 주요 실패 유형 **에러 분류** — `features/featureDiagnostics.ts` (`features/index.ts` 재수출).  
- **텔레메트리:** `diagnosticCode` / `stage` / 감사 로그 평탄화·Sentry 태그 — [M2_MODELING.md §6](./M2_MODELING.md).  
- **문서:** [M2_MODELING.md](./M2_MODELING.md) — 파이프라인·지원 범위·한계·운영 런북.  
- **수동:** [M2_RELEASE_CHECKLIST.md](./M2_RELEASE_CHECKLIST.md).  
- **자동:** `npm run m2` — 타입체크 + M0·M1·M2·텔레메트리·`runPipeline` 회귀.

**완료 정의 (v1)**

- `npm run m2` 통과.  
- [M2_RELEASE_CHECKLIST.md](./M2_RELEASE_CHECKLIST.md) 릴리스 게이트 수행.  
- 베타/필드에서 나온 **원시 오류 문자열**은 `classifyFeatureError`에 패턴만 추가하는 롤링 개선으로 관리(별도 OKR 가능).

**의존:** M1(외부 기하 유입 시 히스토리와 충돌이 많아짐).

**가이드 기간:** 2~3분기(본 문서의 **v1 기준선**은 위 산출물로 닫음. 이후는 품질·시나리오 확장).

---

## M3 — 어셈블리 단일 파이프 (배치·메이트·솔버·간섭) — **P0–P2 자동 게이트 통과, P3·솔버 통합·수동 A절은 롤링**

**목표:** **한 데이터 모델**에서 배치, 메이트, 솔버 결과, 간섭 검사가 일관된다.

**준비 문서:** [M3_ASSEMBLY.md](./M3_ASSEMBLY.md) — 코드 맵, 갭, M3-P0…P3. 릴리스 수동·자동 대응 표: [M3_RELEASE_CHECKLIST.md](./M3_RELEASE_CHECKLIST.md) §D.  
**수동 게이트:** [M3_RELEASE_CHECKLIST.md](./M3_RELEASE_CHECKLIST.md) — 저장·메이트·간섭 스모크.  
**자동:** `npm run m3` — 타입체크 + `src/test/m3`(스냅샷, `solveMates`, 간섭 파이프, BOM 단위 일치).

**산출물**

- `placedParts` / BOM / 메이트 정의 / 솔버 입력이 **동기화된 스키마**(P0 회귀).  
- 솔버 **이원화 역할 고정**(P1 — `solveMates` vs `solveAssembly`, [M3_ASSEMBLY.md](./M3_ASSEMBLY.md) §1).  
- 간섭이 **`placedParts` 기반 월드 기하**와 일치(P2 — `bomPartWorldMatrixFromBom`).

**완료 정의 (롤링)**

- `npm run m3` 통과.  
- [M3_RELEASE_CHECKLIST.md](./M3_RELEASE_CHECKLIST.md) A절 수동 확인(베타/릴리스 직전).  
- 사용자 시나리오(문서화된 기대): 메이트 적용 → 간섭 검사 → 저장 → 재로드 후 배치·메이트 복원 — **수동 체크리스트**; 스냅샷 **JSON 왕복**(`assemblySnapshotRoundTrip.test.ts`); 전체 `.nfab` **parseProject** 골든(`tests/golden/m3-assembly-minimal.nfab.json`); 브라우저 **E2E** `e2e/m3-assembly-load.spec.ts` (`npm run test:e2e:m3`).

**의존:** M2 v1 완료(파트 파이프).

**가이드 기간:** 1~2분기.

---

## M4 — 도면·MBD v0

**목표:** 제조·검사와 말할 수 있는 **2D 도출물**과 3D 주석의 시작.

**산출물**

- **자동(스모크):** `npm run m4` — 타입체크 + `generateDrawing` + PDF/DXF export 회귀(`src/test/m4`). `npm run verify`에 포함. 상세: [M4_DRAWING.md](./M4_DRAWING.md).  
- 모델에서 **뷰·단면·치수**까지(또는 외부 도면 툴로 넘길 **규격 데이터**).  
- GD&T/치수 데이터가 **모델과 연동**되는 방향(최소: 단방향 export).  
- 도면 템플릿(시트, 스케일, 리비전 블록) 초안.

**완료 정의**

- 대표 부품 1개에 대해 **PDF + DXF** 출하 가능(스모크에서 동일 파이프 검증).  
- 모델 변경 시 도면 **불일치 경고**(완전 자동 업데이트는 후속).

**의존:** M3 권장(어셈블리 도면은 더 늦게).

**가이드 기간:** 2~3분기.

---

## M5 — 시뮬레이션·DFM·CAM 브리지

**목표:** 설계 검증과 가공 연결 **최소 실무선**.

**산출물**

- **자동(스모크):** `npm run m5` — 타입체크 + FEA·DFM·CAM 라이트 동기 API 회귀(`src/test/m5`). `npm run verify`에 포함. 상세: [M5_SIMULATION_DFM_CAM.md](./M5_SIMULATION_DFM_CAM.md).  
- FEA(선형 정적) **워크플로 고정** — [M5_FEA_TUTORIAL.md](./M5_FEA_TUTORIAL.md).  
- DFM 규칙과 **파라미터 힌트** 통합 — `analysis/dfmParamMapper.ts`, `analysis/DFMPanel.tsx` `FIX_SUGGESTIONS`.  
- CAM **STEP/공구·프리셋 정책** — [M5_CAM_EXPORT.md](./M5_CAM_EXPORT.md).

**완료 정의**

- 교육용 튜토리얼 1개(FEA 워크플로 위 문서).  
- 베타 사용자 피드백 반영 체크리스트(롤링).

**의존:** M2~M4 중 기하·도면 안정도.

**가이드 기간:** 2분기+ (범위에 따라 분할).

---

## M6 — PDM-lite & 협업

**목표:** “파일 하나”가 아니라 **부품·리비전·권한**으로 운영 가능.

**상세·v0 범위:** [M6_PDM_LITE.md](./M6_PDM_LITE.md).

**산출물**

- **자동(v0):** `npm run m6` — 타입체크 + `meta.nexyfabPdm` 파서·병합·릴리스 가드·멤버 입력 헬퍼 회귀(`src/test/m6`). `npm run verify`에 포함.  
- 부품 ID·리비전·상태(작업/릴리스) — v0는 `.nfab` `nexyfabPdm` + 워크스페이스 스트립.  
- 변경 이력·감사 로그(최소) — 프로젝트 `PATCH` 성공 시 `project.update`를 `nf_audit_log`에 기록(릴리스 잠금은 동일 API).  
- 역할: **`nf_project_members`** + `GET/PATCH` 프로젝트의 `role`/`canEdit` + 대시보드 **팀** 멤버 API(`.../members`). 상세 [M6_PDM_LITE.md](./M6_PDM_LITE.md).

**완료 정의**

- 팀 시나리오(2인 이상) **충돌·권한** — [M6_TEAM_MANUAL.md](./M6_TEAM_MANUAL.md) 수동 절차 + E2E 401 스모크.  
- 백업/복구·ID 정책 — [M6_BACKUP_RECOVERY.md](./M6_BACKUP_RECOVERY.md), [M6_PART_ID_POLICY.md](./M6_PART_ID_POLICY.md).

**의존:** M1~M4 중 저장 포맷·메타데이터 안정.

**가이드 기간:** 2~3분기.

---

## M7 — 대형 어셈블리·엔터프라이즈

**목표:** 느리지만 **쓸 수 있는** 대규모 어셈블리와 기업 요구.

**상세:** [M7_ASSEMBLY_SCALE.md](./M7_ASSEMBLY_SCALE.md).

**산출물**

- **자동(정책 스모크):** `npm run m7` — 타입체크 + `assemblyViewportLoadTier` 회귀(`src/test/m7`). `npm run verify`에 포함.  
- **초기(뷰포트·간섭):** `@/lib/assemblyLoadPolicy` — `assemblyViewportLoadBand`(5단계), `interferenceWorkloadBand`(쌍 수 기준), `getAssemblyLoadGuidance`; `ShapePreview` 배지+LOD, `AssemblyPanel` 간섭 안내, 간섭 실행 전 정보 토스트.  
- LOD·로드 정책·그래픽/기하 분리.  
- SSO·데이터 레지던시·보안 요구사항 대응 로드맵.  
- SLA·지원 프로세스.

**완료 정의**

- 목표 부품 수/삼각형 수에서 **성능 예산** 달성(수치는 제품별로 정의).  
- 보안 체크리스트 통과.

**의존:** M3~M6.

**가이드 기간:** 지속.

---

## 권장 실행 순서 (요약)

```
M0 ════════════════════► (병행 지속)
  ► M1 교환
    ► M2 히스토리 신뢰
      ► M3 어셈블리 단일 파이프
        ► M4 도면/MBD v0
          ► M5 시뮬/DFM/CAM
            ► M6 PDM-lite
              ► M7 스케일·엔터프라이즈
```

---

## 다음 액션 (이 문서 사용법)

0. **상용 완성** 관점의 페이즈·우선순위는 [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md)를 본다. Phase A/B 콘솔 체크: `npm run phase-a:checklist`, `npm run phase-b:checklist`(본 문서는 M0–M7 정의·자동 게이트의 단일 참조로 유지).
1. **현재 분기**에 해당하는 마일스톤 하나만 “진행 중”으로 표시한다(M3 핵심 자동 게이트는 통과; 롤링은 **M6 PDM-lite·M7 스케일** 권장, M4·M5 자동 게이트는 `verify`에 포함).  
2. 스프린트 계획은 해당 마일스톤의 **완료 정의**에서만 역산한다.  
3. 분기 말에 **완료/미완료 이유**를 이 파일 하단에 짧게 기록한다(롤링). 상용 완성 페이즈 요약은 [CAD_COMMERCIAL_COMPLETION_ROADMAP](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md) §5와 맞출 수 있다.

---

## 변경 이력

| 날짜       | 내용        |
|------------|-------------|
| 2026-04-30 | 초안 작성   |
| 2026-04-30 | M0: `npm run m0`, 골든 nfab, M0_BASELINE / M0_RELEASE_CHECKLIST |
| 2026-04-30 | M1: `npm run m1`, M1_EXCHANGE.md, formatCadImportError, exchange.test |
| 2026-04-30 | M1 완료: R2·프로젝트 API 문서, M1_RELEASE_CHECKLIST, 스케치 참조 import 오류 통일, m1에 M0 테스트 포함 |
| 2026-04-30 | M2 v1 완료: `featureDiagnostics`, `npm run m2`, 텔레메트리·감사 로그 `diagnosticCode`/`pipelineStage`, M2_MODELING §6·7 |
| 2026-04-30 | M2 문서 확정·M3 착수 준비: [M3_ASSEMBLY.md](./M3_ASSEMBLY.md), M3를 다음 마일스톤으로 표시 |
| 2026-04-30 | M3 P0: `npm run m3`, `assemblySnapshot.test.ts`, M3_ASSEMBLY.md |
| 2026-04-30 | 목표를 **상용 3D** 기계 CAD로 명시, M0–M7과 상용 3D 축 대응·원칙 4(3D 파이프 우선) 추가 |
| 2026-04-30 | M7 선행: `assemblyLoadPolicy`·뷰포트 힌트, `npm run m7`, `verify`에 m7 단계 추가 |
| 2026-04-30 | M3 체크리스트 §D(자동 대응표), M4 `M4_DRAWING.md`·다뷰/fingerprint 회귀 |
| 2026-05-02 | M5: `npm run m5`, `M5_SIMULATION_DFM_CAM.md`, `src/test/m5`, `verify`의 m5 단계; 롤링 문서 `M5_FEA_TUTORIAL`/`M5_CAM_EXPORT`·DFM 매핑; 다음 마일스톤 준비 `M6_PDM_LITE`·`M7_ASSEMBLY_SCALE`; 본문 `verify` 순서에 m5 명시 |
| 2026-04-30 | M6 v0: `nexyfabPdm` 메타, `npm run m6`, `src/test/m6`, `verify`에 m6 단계 |
| 2026-04-30 | M6: 릴리스 씬 서버 잠금(`nfProjectReleasedGuard`), `project.update` 감사 로그, PDM 스트립 안내 |
| 2026-04-30 | M6: PATCH `ifMatchUpdatedAt` 낙관적 동시성(409)·`nfProjectConcurrency`, 클라우드 싱크 |
| 2026-04-30 | M6: `nf_project_members`·팀 API·대시보드「팀」·ACL UI 가드; M6_PART_ID_POLICY / BACKUP / TEAM_MANUAL; M7 성능·보안 보조 문서 |
| 2026-04-30 | M6: 가입 전 초대(`nf_project_invites`)·대시보드 토스트·`credFetch`; 도면 `getDrawingTitlePartName`; E2E `m6-team-members`; M7 정책 타이밍 Vitest·`security:smoke` |
| 2026-04-30 | 상용 완성 로드맵 분리: [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md); 본 문서 “다음 액션”에 교차 링크 |
| 2026-04-30 | Phase B: `phase-b:checklist`·ISSUE_TEMPLATE; M1 STEP 한계 요약표 |
