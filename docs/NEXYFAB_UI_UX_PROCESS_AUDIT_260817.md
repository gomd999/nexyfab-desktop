# NexyFab UI/UX 및 사용자 프로세스 전수 점검

- 점검일: 2026-08-17
- 대상: 운영 `https://nexyfab.com`, 동일 빌드 staging, 로컬 소스와 자동화 증거
- 범위: 게스트 → 가입/로그인 → AI 설계 → 정밀 CAD → 저장/재접속 → DFM/FEA → 도면/내보내기 → 견적/제조
- 원칙: 기능 존재 여부와 사용자가 실제로 발견·완료할 수 있는지를 분리해 평가

## 1. 결론

현재 서비스는 **안내가 있는 Closed Beta에는 투입 가능**하지만, **사용자가 도움 없이 전 과정을 완주하는 self-serve 상용 UX에는 아직 부족**하다.

| 평가 축 | 점수 | 판정 |
|---|---:|---|
| AI/CAD 기능 범위 | 8.0/10 | 강함 |
| 첫 진입과 설명 | 7.0/10 | 개선됨 |
| 정밀 CAD 화면 사용성 | 5.5/10 | 기능 과밀 |
| 프로세스 연속성 | 6.0/10 | 주요 공정 진입이 불명확 |
| 로그인·로그아웃 일관성 | 6.0/10 | NexyFab 내부는 양호, 일반 헤더 결함 |
| 모바일 | 7.5/10 | 읽기·뷰 전용 경로 양호 |
| 접근성 | 6.5/10 | 공통 언어 선택기 대비 실패 |
| i18n | 5.5/10 | 핵심 일부는 6개 언어, 많은 업무 화면은 한/영 분기 |
| 검증 가능성 | 7.0/10 | 공개 흐름 강함, 회원 lifecycle 증거 갱신 필요 |

종합 UI/UX·프로세스 점수는 **6.4/10**이다.

## 2. 점검 규모와 실행 증거

- 사용자·관리·파트너를 포함한 `page.tsx`: 165개
- Playwright E2E 스펙: 42개
- 운영 주요 사용자 경로 HTTP 확인: 30개 모두 응답
- 운영 랜딩·반응형·접근성·게스트 검사: 20개 중 18개 통과, 2개 실패
- 운영 AI/CAD 핵심 검사: 7개 중 5개 통과, 1개 실패, 1개 프로젝트 조건상 skip
- 운영 Assembly/Drawing/Analysis 검사: 4개 통과, 1개 실패, 2개 기존 fixme
- 인증 단위·통합 검사: 23개 통과
- TypeScript, 변경 파일 ESLint, 프로덕션 빌드, 비밀정보 검사 통과
- staging 회원 lifecycle: E2E 계정 자격 증명 불일치로 로그인 단계에서 중단

## 3. 사용자 여정별 판정

### A. 첫 방문과 서비스 이해

좋은 점:

- 첫 문장이 자연어 제품 요청과 치수 질문, 부품·조립·도면 흐름을 설명한다.
- 랜딩은 모바일 가로 넘침 없이 표시된다.
- 공개 경로와 주요 CTA는 응답한다.

문제:

- 설계 시작점이 `/[lang]`, `/nexyfab/ai`, `/nexyfab/design`, `/studio`, `/shape-generator`로 겹친다.
- `AI 설계`, `Guided`, `Standard`, `Expert`, `AI design`, `Precision CAD`가 동시에 등장해 초보자가 무엇을 선택해야 하는지 판단하기 어렵다.
- 도움말은 “전문가형 CAD 카드”, 수동 형상 선택, STL/STEP 버튼 중심으로 설명해 현재 AI-first 화면과 용어가 일치하지 않는다.

판정: **부분 통과**. 첫 문장은 쉬워졌지만 진입점과 용어가 너무 많다.

### B. 게스트 체험

좋은 점:

- 게스트는 서버 세션 확인 후 `GUEST/비회원`으로 표시된다.
- 게스트 메뉴에는 로그인·가입만 보이고 로그아웃은 보이지 않는다.
- 보호된 알림·refresh API를 불필요하게 호출하지 않는다.
- 모바일과 정밀 CAD 뷰 전용 화면이 깨지지 않는다.

문제:

- 게스트 저장은 브라우저 로컬, 프로젝트 저장은 서버, 일부 설계 패널은 자체 local project 저장을 사용한다. 같은 “저장”이 여러 의미로 보인다.
- 가입 유도 문구와 실제 이전되는 데이터의 범위를 화면마다 동일하게 설명하지 않는다.

판정: **Closed Beta 통과**.

### C. 로그인·로그아웃·재접속

좋은 점:

- 세션 쿠키와 `sessionStorage`를 사용하며 브라우저 종료 후 재로그인을 요구한다.
- 기존 장기 쿠키는 `nf_browser_session` 표식이 없으면 자동 제거된다.
- NexyFab 사이드바 로그아웃은 서버와 클라이언트 상태를 함께 정리한다.

중대 문제:

- 일반 `Header.tsx`의 데스크톱·모바일 로그아웃은 `sessionStorage.currentUser`만 제거한다.
- 이 경로는 `/api/auth/logout`을 호출하지 않아 httpOnly 서버 쿠키가 남고, 세션 hydrator가 다시 회원 상태를 복구할 수 있다.
- `currentUser`, Zustand auth store, 서버 세션을 아직 완전히 하나의 UI 상태로 통합하지 못했다.

판정: **실패(P0)**. 로그아웃은 어느 화면에서 눌러도 동일해야 한다.

### D. AI 설계와 누락 요구사항 확인

좋은 점:

- Guided 설계에서 치수·공차·재료·공정 요구사항 gate가 동작한다.
- L-bracket 시나리오에서 Preview → Explicit Apply → FeatureTree revision → Undo가 운영에서 통과했다.
- 정밀 모드가 기본이며 자유 형상과 정밀 CAD의 차이를 설명한다.

문제:

- 테스트된 결정론 L-bracket은 `AI MODEL · NOT_RUN` 경로다. 실제 live 모델의 복잡제품 자유 설계 UX와 동일한 증거가 아니다.
- 상단에 도구 수준(Guided/Standard/Expert), 작업 모드(AI design/Precision CAD), 하단 Guided AI/Expert CAD 전환기가 중복된다.
- 캡처 화면에서 서로 다른 전환기가 Guided와 Expert를 동시에 나타내어 현재 상태를 혼동시킨다.

판정: **기능 통과, UX 부분 통과**.

### E. 정밀 CAD 편집

좋은 점:

- 캔버스, 피처 트리, Inspector, AI 탭, 리본과 뷰 컨트롤이 로드된다.
- 데스크톱에서 가로 넘침, 주요 도구 겹침, 필드 label 누락이 없었다.
- 측정된 운영 샘플은 LCP 약 1.16초, CLS 0.003으로 안정적이었다.
- Undo/Redo와 기본 작업공간 생존 검사는 통과했다.

문제:

- 상단에 제목줄, 경험 수준, 작업 모드, 4단계 workflow rail, 리본이 연속으로 쌓인다.
- 우측 탭, 플로팅 AI 입력, 하단 경험 전환기가 동시에 떠서 실제 모델 면적을 크게 줄인다.
- 화면은 “Now: BLOCKED”를 표시하지만 해결 행동이 여러 위치에 분산된다.
- `DrawingRightPane`, `RenderRightPane`에는 “Coming soon — not yet wired”가 노출된다.

판정: **전문가 기능은 강하지만 초보자 완주 UX는 부족**.

### F. DFM·FEA·견적

좋은 점:

- DFM, FEA, Quote 컴포넌트와 이벤트 연결 코드는 존재한다.
- Inspector의 ANALYZE 영역과 하단 drawer 구조도 구현되어 있다.

문제:

- 운영 Q8 해피패스에서 Guided 상태의 `shell-open-dfm`을 찾지 못했다.
- Buckling 흐름에서도 `shell-open-fea`를 찾지 못해 timeout 됐다.
- 기능은 Inspector/하단 drawer에 있으나 Guided 사용자의 현재 AI 탭에서는 발견되지 않는다.
- workflow rail은 DFM 실행을 요구하지만 그 자리에서 실행 화면으로 바로 안내하지 않는다.

판정: **발견 가능성 실패(P1)**. 기능 존재와 사용자 완주는 다르다.

### G. Assembly·Drawing·내보내기

좋은 점:

- Assembly `.nfab` 열기·저장·재열기와 BOM 유지 검사가 통과했다.
- 모델러 Drawing 탭 → production drawing과 paper control 검사가 통과했다.
- Assembly에서 Drawing handoff 경로가 구현되어 있다.

문제:

- configuration family export에 `PLACEHOLDER STEP` 문자열을 생성하는 코드가 남아 있다.
- 직접 HTTP/bookmark 점검에서 assembly/drawing/analysis URL이 `/kr/`로 최종 이동했다. 브라우저 내부 연결 테스트는 Assembly·Drawing이 통과했으므로 proxy/bookmark 조건을 분리해 재검증해야 한다.
- 도움말의 내보내기 설명과 현재 release/evidence gate의 관계가 충분히 설명되지 않는다.

판정: **핵심 내부 흐름 통과, 외부 진입·일부 export 미완성**.

### H. 프로젝트 저장·재접속·회원 전용 흐름

좋은 점:

- 프로젝트 CRUD, CAD verify, storage-state reconnect, workspace reopen, cleanup을 검사하는 E2E가 작성돼 있다.
- 화면별 서버 세션 reconciliation 코드가 존재한다.

문제:

- 현재 staging 자격 증명이 맞지 않아 최신 배포본의 회원 lifecycle을 실제 재검증하지 못했다.
- 프로젝트 목록에는 “팀 공유 기능은 준비 중” 문구가 남아 있지만 별도 team/collab/permissions 기능도 존재해 사용자 메시지가 모순된다.

판정: **미검증(P1)**. 테스트 계정을 복구한 후 release evidence를 갱신해야 한다.

### I. 접근성·모바일·i18n

좋은 점:

- 모바일 랜딩, guided design 요약, 정밀 CAD view-only 화면은 가로 넘침 없이 통과했다.
- 정밀 CAD 필드 identity와 주요 컨트롤 배치 검사가 통과했다.

문제:

- `/kr/help`, `/kr/unsubscribe`에서 공통 언어 선택기의 `한국어` 텍스트 대비가 WCAG AA serious 위반이다.
- NexyFab 영역에서 단순 `isKo ? Korean : English` 분기를 사용하는 파일이 73개 검색된다.
- URL은 일본어·중국어·스페인어·아랍어를 지원하지만 많은 업무 화면은 영어 fallback이므로 전체 i18n 완료로 볼 수 없다.

판정: **모바일 통과, 접근성·전체 i18n 부분 실패**.

## 4. 우선 수정 순서

### P0 — 배포 즉시 수정

1. 일반 Header 로그아웃을 공통 `useAuthStore.logout()` 또는 동일 서버 logout 함수로 통합
2. `currentUser` 기반 회원 UI를 서버 session/Zustand selector로 제거·통합
3. 모든 헤더·사이드바·계정 화면에서 같은 로그인 상태 contract 사용

### P1 — Closed Beta 확대 전

1. CAD 상태 선택기를 하나로 통합: `AI 안내 / 정밀 CAD` 2개 주 모드, Standard/Expert는 고급 설정으로 이동
2. workflow rail의 현재 단계에 단일 primary action 연결
3. Guided AI 탭에서도 `검증 실행` 버튼이 DFM/FEA drawer를 직접 열도록 연결
4. 플로팅 AI, 하단 경험 전환기, 우측 AI 탭의 중복 제거
5. staging E2E 계정 복구 후 회원 lifecycle 재실행
6. 언어 선택기 대비 수정

### P2 — Self-serve 상용 전

1. 설계 진입점을 `새 AI 설계`와 `정밀 CAD 열기` 두 개로 정리
2. `/studio`, `/nexyfab/design`의 역할을 통합하거나 Labs/legacy로 명확히 분리
3. 현재 화면 기준으로 도움말과 온보딩 재작성
4. placeholder STEP 및 미연결 Drawing/Render pane 제거 또는 Beta로 명시
5. 프로젝트 공유 문구와 실제 collaboration 기능 정합화
6. 한/영 이외 4개 언어의 핵심 업무 화면 번역 완료

## 5. 상용 판정 기준

다음 조건이 모두 충족되면 self-serve Closed Beta 완료로 판정한다.

- 어느 화면에서 로그아웃해도 세션 API가 즉시 `authenticated:false`
- 게스트·회원·재접속 lifecycle이 staging에서 통과
- AI 설계 후 사용자가 추가 탐색 없이 DFM/FEA/도면/견적으로 이동
- CAD 화면에서 서로 모순되는 mode 표시가 없음
- 공개 핵심 페이지의 serious/critical axe 위반 0건
- production UI에 placeholder export 또는 `not wired` 버튼이 없음
- 도움말이 실제 UI 명칭·단계와 일치
- 핵심 6개 언어에서 영어 fallback 범위를 명시하거나 완전 번역

## 6. 최종 권고

현재는 **초대 사용자에게 짧은 온보딩을 제공하는 Closed Beta**로 운영할 수 있다. 그러나 무안내 self-serve 확대 전에는 P0와 P1을 완료해야 한다. 특히 일반 Header 로그아웃과 CAD의 중복 상태 선택기는 사용자의 신뢰와 완주율에 직접 영향을 주므로 가장 먼저 수정한다.

## 7. 260817 개선 실행 결과

전수 점검 직후 다음 항목을 구현·조정했다.

- 일반 Header를 서버 세션 기반 `useAuthStore`로 통합하고 로그아웃 시 서버 쿠키·리프레시 토큰 폐기 경로를 사용
- 정밀 CAD에서 `AI 설계 / 수동 편집 / 정밀 CAD` 한 개 선택기로 experience와 work mode를 함께 전환하도록 통합
- Expert 화면의 중복 하단 experience switcher 제거
- 상단 `Issues`를 사용자 목적에 맞는 `검증 / Verify` 진입점으로 변경하고 DFM·FEA drawer를 연결
- 새 shell에서 빠져 있던 실제 DFM/FEA overlay consumer를 다시 마운트해 `Open full panel` 동작 복구
- 저장 상태를 `ready / saving / saved / error`로 구조화하고 상태바에 항상 표시
- 언어 선택기를 자동 숨김하지 않도록 변경하고 포커스·색 대비를 WCAG AA 기준으로 조정
- 도움말 첫 화면을 `자연어 요구사항 → MUST_ASK 치수 → 계획/미리보기 → 정밀 CAD → DFM/FEA → Drawing/STEP/BOM → 견적`의 현재 흐름으로 교체
- 실제 kernel STEP exporter가 없는 configuration family export는 가짜 `.step`을 내려받지 못하도록 차단하고 명시적 unavailable 상태로 표시
- Drawing/Render의 미연결 도구는 Closed Beta 제외 기능으로 명시
- 구독 해지 로딩 상태의 다크 테마 대비와 live status 의미 보강

검증 결과:

- TypeScript: PASS
- 전체 ESLint: PASS
- 프로덕션 build 및 291개 static page 생성: PASS
- bundle budget: PASS (`worst first-paint 1584.3 KB / budget 1660.2 KB`)
- 인증·세션 회귀: 28 PASS
- CAD 모드·family export 회귀: 17 PASS
- 저장 상태 계약: 5 PASS
- Chromium Q8: DFM full panel → RFQ → persistence state, Undo/Redo 2 PASS
- Chromium M5: FEA → Buckling → result PASS, 명시된 후속 host-wiring 2건은 기존 fixme 유지
- 공개 화면 axe/help/AuthModal: serious·critical 위반 0, 관련 6 PASS
- secret scan: 7,076 files / 81,055,990 bytes / findings 0

현재 판정은 **UI/UX P0·P1 핵심 개선 완료, 초대형 Closed Beta 배포 가능**이다. 다만 self-serve 상용 공개 전에는 핵심 업무 화면의 6개 언어 완전 번역, 대형 assembly 성능 캠페인, 후속 host-wiring fixme 2건을 별도 release gate로 닫아야 한다.

## 8. 배포 및 실환경 자격화

- Staging 배포: `44134c22-755b-48b4-998d-13bd2627fb29` — SUCCESS
- Staging 회원 lifecycle: 로그인 → 프로젝트 생성/조회 → CAD 검증 → 세션 재접속 → Expert workspace 재진입 → 정리 → 로그아웃, 1 PASS
- Staging 공개 UI/CAD: 9 PASS, 명시적 host-wiring fixme 2 SKIP
- Production 배포: `82c76c4f-90aa-47bc-84c2-8638544edabc` — SUCCESS
- Production 공개 UI/CAD: 9 PASS, 명시적 host-wiring fixme 2 SKIP
- Production 세션 정책: 오래된 인증 쿠키 제거, 게스트 표시 및 로그인/회원가입 메뉴 노출, 1 PASS
- Production 런타임 보안 설정 존재 여부: `JWT_SECRET`, `REDIS_URL`, `DATABASE_URL`, `ADMIN_SECRET`, `ADMIN_PASSWORD_HASH` 모두 확인, `NODE_ENV=production`

최종 판정: **현재 운영 배포본은 초대 계정 기반 Closed Beta에 적합하다.** 공개 UI, 게스트 세션, 핵심 CAD 검증·해석·견적 진입, 저장 상태, 재접속을 실환경에서 확인했다. 아직 자동 자격화하지 않은 임의 대형 조립품과 fixme 2건은 “모든 복잡 제품을 완전 보장”하는 근거가 아니므로 self-serve 정식 상용 전 별도 성능·정확도 gate로 유지한다.
