# M6 — 팀·권한 수동 시나리오 (DoD)

**상위:** [M6_PDM_LITE.md](./M6_PDM_LITE.md).  
**자동 스모크:** `e2e/m6-project-members-api.spec.ts` (비로그인 401). **2계정 E2E는 환경 의존**이라 여기서 수동으로 닫는다.

## 전제

- 사용자 A: 프로젝트 **소유자** (클라우드에 설계 저장).  
- 사용자 B: **같은 앱에 가입**된 계정(이메일로 멤버 검색 가능).

## 시나리오 1 — 뷰어

1. A로 로그인 → **대시보드 → 내 설계** → 해당 카드 **「팀」** → B의 이메일 입력 → 역할 **보기** → 추가.  
2. B로 로그인 → 같은 프로젝트 **열기** (`?projectId=` 또는 대시보드).  
3. **기대:** 상단 PDM 스트립에 **읽기 전용** 안내, 필드 비활성, 클라우드 저장/자동 동기 비활성(토스트 또는 무동작).  
4. B로 PATCH 시도 시 **403** `PROJECT_READ_ONLY` (개발자 도구로 확인 가능).

## 시나리오 2 — 편집자

1. A가 B를 **제거** 후 다시 **편집**으로 초대.  
2. B가 설계 수정 후 클라우드 저장.  
3. **기대:** 저장 성공, `nf_project_versions.user_id`는 **소유자 id**로 남음(버전 행 소유권 일관성).

## 시나리오 3 — 충돌(409)

1. A·B 둘 다 **편집자**인 상태는 지원하지 않음(동일 역할 중복 행은 upsert로 역할만 갱신).  
2. A와 B(편집자)가 **동시에** 편집하면 낙관적 잠금 **`ifMatchUpdatedAt`** 으로 한쪽 **409** — 한쪽이 “서버에서 다시 불러오기”로 수렴.

## 시나리오 4 — 소유자 전용

1. B(뷰어 또는 편집자)로 **보관/삭제** 시도 → **403** `PROJECT_OWNER_ONLY`.  
2. B로 **「팀」** 모달 열기 → 목록 API **403** (소유자만).

## API 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/nexyfab/projects/:id/members` | 멤버 목록 (소유자만). |
| `POST` | `/api/nexyfab/projects/:id/members` | `{ "email", "role": "editor"\|"viewer" }` (소유자만). |
| `DELETE` | `/api/nexyfab/projects/:id/members?userId=` | 멤버 제거 (소유자만). |
| `POST` | `/api/nexyfab/projects/:id/invites` | **가입 전 이메일** 초대 토큰 생성 (소유자만). 이미 `nf_users`에 있으면 `409 USER_ALREADY_REGISTERED`. |
| `GET` | `/api/nexyfab/project-invites/:token` | 공개 메타(만료·프로젝트 id·역할, 이메일 마스킹). |
| `POST` | `/api/nexyfab/project-invites/:token/accept` | 로그인 세션 이메일이 초대와 일치하면 멤버 추가 후 초대 행 삭제. |

### 가입 전 초대 (링크)

1. 대시보드 **팀** 모달에서 이메일 입력 → **「초대 링크 만들기」** → URL 복사해 전달.  
2. 수신자는 **동일 이메일로 가입·로그인** 후 링크 접속 (`/dashboard?acceptInvite=…`).  
3. 자동으로 `accept` 호출 후 **내 설계**에 프로젝트가 보여야 함.

## E2E (2계정)

- `npm run test:e2e:m6-team` — 환경변수: `E2E_BASE_URL`(선택), `E2E_M6_OWNER_EMAIL`, `E2E_M6_OWNER_PASSWORD`, `E2E_M6_MEMBER_EMAIL`, `E2E_M6_MEMBER_PASSWORD`. 없으면 스킵.  
- `npm run verify:e2e`에 `e2e/m6-team-members.spec.ts` 포함.

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | 초안 + 대시보드 팀 UI |
