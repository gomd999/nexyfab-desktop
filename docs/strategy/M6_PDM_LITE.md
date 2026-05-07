# M6 — PDM-lite & 협업 (준비·v0 범위)

**상위 로드맵:** [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) §M6.

M6의 북극성은 “**파일 하나**”가 아니라 **부품·리비전·권한**으로 운영 가능한 최소선이다. 이 문서는 **현재 코드베이스에 이미 있는 토대**와 **v0에서 채울 갭**을 나누어 다음 스프린트의 경계를 고정한다.

## 이미 있는 토대 (제품 안)

| 영역 | 설명 | 코드 |
|------|------|------|
| **프로젝트 단일 소스** | `.nfab` JSON 스키마, 버전 필드, 트리·씬·어셈블리 스냅샷 | `shape-generator/io/nfabFormat.ts` |
| **로컬 설계 이력** | 스냅샷 저장·복원·라벨, 브랜치 상태, 최대 50개(로컬스토리지) | `shape-generator/history/useVersionHistory.ts`, `VersionPanel.tsx` |
| **3D 버전 비교** | 두 스냅샷 간 비교 UI | `history/VersionDiff3DViewer.tsx` |
| **클라우드 저장 훅** | 로그인 시 서버 동기화 플로우(정책은 제품 설정에 따름) | `shape-generator/useCloudSaveFlow.ts` |
| **자동 저장 슬롯** | 워크스페이스 단기 복구용 로컬 상태 | `shape-generator/useAutoSave.ts` |
| **PDM 메타 v0** | `.nfab` `meta.nexyfabPdm` + 워크스페이스 스트립 | `io/nfabPdmMeta.ts`, `store/pdmProjectMetaStore.ts`, `PdmMetaWorkspaceStrip.tsx` |

이것만으로도 **단일 사용자·단일 기기** 기준 “경량 리비전”은 동작한다. M6 **완료 정의**에 필요한 **팀·권한·감사**는 아직 별도 제품 결정이 필요하다.

## v0 (PDM-lite) — 구현됨 (2026-04 롤링)

- **`meta.nexyfabPdm`** — 예약 키 아래에 `partNumber`, `revisionLabel`, `lifecycle: 'wip' | 'released'`를 저장한다. 그 외 `meta` 키는 그대로 보존·직렬화된다.  
- **코드:** `shape-generator/io/nfabPdmMeta.ts`, `shape-generator/store/pdmProjectMetaStore.ts`, `hooks/useNfabFileIO.ts`(저장/열기 시 hydrate), 워크스페이스 상단 **`PdmMetaWorkspaceStrip`**.  
- **자동 게이트:** `npm run m6` — 타입체크 + `src/test/m6/pdmMeta.test.ts`. `npm run verify`에 M5와 M7 사이로 포함.
- **릴리스 잠금(서버):** `PATCH /api/nexyfab/projects/[id]` — DB에 저장된 `sceneData`가 `meta.nexyfabPdm.lifecycle === released`이면, 동일 릴리스로의 씬 변경을 **403**으로 막는다. `lifecycle`을 `wip`로 바꾸는 페이로드만 허용(언릴리스). 구현: `src/lib/nfProjectReleasedGuard.ts`.
- **감사 로그:** 위 PATCH가 씬/이름 등을 바꾼 뒤 성공하면 `logAudit`에 `action: project.update`, `metadata: { sceneChanged, nameChanged }` 기록(`nf_audit_log`).
- **낙관적 동시성:** PATCH 바디에 `ifMatchUpdatedAt`(클라이언트가 알고 있는 `updated_at`)을 넣으면, 서버 값과 다를 때 **409** + `code: PROJECT_VERSION_CONFLICT`, 감사 `project.update_conflict`. 생략 시 기존과 동일하게 동작. `useNfabFileIO` 자동 플러시·`useCloudSaveFlow`·대시보드 `?projectId=` 로드 시 `updatedAt`을 ref에 싱크.
- **409 UX:** `useProjectsStore.lastErrorCode`로 구분. `useNfabFileIO`는 수동/자동 클라우드 저장 실패 시 **경고 토스트 +「서버에서 다시 불러오기」** 액션(같은 URL에 `projectId` 쿼리로 `location.assign`). `useCloudSaveFlow`는 409 시 `serverUpdatedAt`을 ref에 반영·`cloudError` 안내·`AutoSaveIndicator`에 **「서버에서 다시 불러오기」** 버튼(`reloadToFetchServerProject`).
- **ACL v0.2:** `nf_project_members` + GET 프로젝트 응답의 `role` / `canEdit`. 뷰어는 PATCH 씬 저장 **403** `PROJECT_READ_ONLY`. 소유자만 보관·삭제·**팀 멤버 API** + **가입 전 초대** (`nf_project_invites`, `.../invites`, `project-invites/[token]`). 대시보드 **「팀」**·`acceptInvite` 쿼리 처리.  
- **부품 ID·백업·팀 수동 시나리오:** [M6_PART_ID_POLICY.md](./M6_PART_ID_POLICY.md), [M6_BACKUP_RECOVERY.md](./M6_BACKUP_RECOVERY.md), [M6_TEAM_MANUAL.md](./M6_TEAM_MANUAL.md).

## v1+ (롤링)

1. ~~**부품 ID 정책**~~ — [M6_PART_ID_POLICY.md](./M6_PART_ID_POLICY.md)에 요약 고정.  
2. ~~**역할·감사·팀 UI**~~ — 멤버 API + 클라이언트 가드 + `project.member_add` / `project.member_remove` 감사. 관리자 전역 롤은 별도.

## 완료 정의 (로드맵 본문과 정렬)

- [x] 팀 시나리오(2인 이상) **충돌·권한** — [M6_TEAM_MANUAL.md](./M6_TEAM_MANUAL.md) 수동 시나리오; E2E는 비로그인 401 스모크(`e2e/m6-project-members-api.spec.ts`).  
- [x] 백업/복구·`.nfab` 마이그레이션 요약 — [M6_BACKUP_RECOVERY.md](./M6_BACKUP_RECOVERY.md).  
- [x] 변경 이력·감사 로그(최소) — 프로젝트 씬/이름 변경 `PATCH` 성공 시 `nf_audit_log`에 `project.update` (필드 변경 플래그 메타).  
- [x] 팀 단위 ACL·다른 사용자 편집권한 — `nf_project_members` + 대시보드 팀 UI + Shape Generator 읽기 전용 가드.

## 관련 마일스톤 의존성

M1 저장·교환, M2 히스토리 신뢰, M3 어셈블리 스냅샷이 **같은 nfab 트리**에 올라와 있어야 M6 메타데이터·권한이 의미가 있다.
