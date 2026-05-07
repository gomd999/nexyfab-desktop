# M6 — 부품·프로젝트 ID 정책 (v1 요약)

**상위:** [M6_PDM_LITE.md](./M6_PDM_LITE.md), [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) §M6.

## 식별자 종류

| 식별자 | 출처 | 용도 |
|--------|------|------|
| **`projectId`** | 서버 `nf_projects.id` (UUID) | 클라우드 동기화·URL `?projectId=`·감사 로그·팀 멤버 테이블 `nf_project_members.project_id` |
| **`nexyfabPdm.partNumber`** | `.nfab` `meta.nexyfabPdm` | 사람이 읽는 부품 번호(ERP/도면 타이틀 블록과 맞출 값). **전역 유일을 강제하지 않음** (같은 번호가 여러 클라우드 프로젝트에 존재할 수 있음). |
| **프로젝트 `name`** | `nf_projects.name` / 직렬화 시 디자인 이름 | 목록·파일명 힌트. `partNumber`와 **독립** — 서로 대체하지 않는다. |

## 우선순위 (표시·보내기)

1. **UI/보내기 라벨**에 부품 번호가 필요하면: `partNumber`가 비어 있지 않으면 그것을 쓰고, 비어 있으면 `name`, 그다음 `projectId` 앞 8자 등은 제품별로 정한다.  
   - 도면 타이틀 블록: `getDrawingTitlePartName` (`src/lib/nfabPartDisplay.ts`) + `ShapeGeneratorInner` → `DrawingView` `partName`.  
2. **시스템 참조·API**는 항상 **`projectId`**를 단일 키로 사용한다.

## 중복·충돌

- `partNumber` 중복은 **경고만**(향후 팀 단위 유일성 검사 가능).  
- **`projectId`는 서버에서 유일**하다.

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | 초안 — M6 v1+ 정책 고정용 |
