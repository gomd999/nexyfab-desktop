# Changelog

모든 주요 변경사항은 이 파일에 기록됩니다.
버전 규칙: [SemVer](https://semver.org/lang/ko/) — `MAJOR.MINOR.PATCH`

CI(`release-desktop.yml`)의 `register-release` 잡은 이 파일에서 **해당 버전의 `##` 섹션을 추출**해 릴리즈 노트로 사용합니다. 섹션 헤더 형식은 `## [vX.Y.Z]` 또는 `## vX.Y.Z` 또는 `## X.Y.Z` 모두 지원됩니다.

---

## [Unreleased]

`v0.1.0` 이후 누적된 주요 변경. 다음 데스크톱 릴리즈에 포함될 항목.

### 추가 — CAD B-rep 엔진 (Phase 1+2)
- 스케치 → real B-rep extrude 체인 (멀티 컨투어 외곽+홀, revolve, sweep, loft, sketch-on-face boss/pocket, helix)
- B-rep base solids: cylinder, sphere, pipe/tube, torus, disk, cone/frustum, washer, wedge, L-bracket, I-beam, hex-nut, tSlot, bolt, pulley
- Features: countersink hole (real cone cut), rib (mesh-CSG → B-rep), selective fillet/chamfer on picked edge, shell with face selection survives rebuild
- Pattern/mirror: B-rep linear/circular pattern + mirror (handle-preserving)
- Topology naming: edge-signature + face-signature correspondence, persistent topological naming across rebuild history, scale-aware edge re-resolution, rebuild-stable edge ids
- 진단: true B-rep STEP export from an OCCT handle (test-locked), B-rep accuracy in OCCT burn-in CI

### 추가 — AI / SCAD
- Schema-aware clamping of AI-generated feature params
- Drop unbuildable feature types from AI output (native-builder hardening)
- Pure self-correction loop orchestrator + AI Layer-1 verifier
- NL→intent→render free path for lay AI front door
- Streaming AI sidebar chat
- Generous AI soft-cap with low-balance nudge
- BOSL2 vocab reference + role-based verification formatters

### 추가 — Partner portal i18n
- 13 페이지 + 9 패널 + 2 에디터를 6 언어(ko/en/ja/zh/es/ar)로 전면 확장 (Round 1~9)
- portfolio 뷰 트래킹 + legacy SSO deprecation
- demo 세션 데이터는 KR canonical 유지 정책

### 추가 — Shape-generator i18n
- ja/cn/es/ar 실번역: feature/shape parameter labels (a-batch), advanced-panel labels (b-batch)
- backfill safety net for modeling-critical keys

### 추가 — 제품 기능
- "Make it real → quote" lay-conversion CTA
- Live geometry verification (launch blocker close)
- AI + presets front door on the empty-state picker
- 3-tier signup: verify email + onboarding account-type + 사업자 정보
- Guest mode + unified sidebar + AI Studio + billing
- PWA, push, rate limit, admin, support chat
- Materialized standard parts, auto-dim, inline DFM, feature hover, onboarding

### 수정
- Sketch palette 기본 접힘, right-pane 탭 truncation
- Orientation cube가 view-preset grid와 겹치는 문제
- Overlay z-index가 ribbon/bottom chrome 가리는 문제
- `buildUnsubscribeUrl` 추출 + `webpackIgnore` for web-push (빌드 안정화)
- `package-lock` 재동기 (Railway 빌드 해제)

### 알려진 제약
- 데스크톱 코드 서명 여전히 미적용 (v0.1.0과 동일)
- Server Action ID는 배포마다 변경 — 옛 클라이언트 세션에서 "Failed to find Server Action" 발생 가능 (Next.js 16 알려진 동작)

---

## [v0.1.0] — 2026-04-19

NexyFab 데스크톱 최초 공개 (Tauri 번들).

### 추가
- Windows (MSI) / macOS Apple Silicon (DMG) / macOS Intel (DMG) / Linux (AppImage) 빌드
- 오프라인 3D 모델링 (shape-generator 전체 기능 포함)
- 네이티브 파일 저장/열기 (Tauri FS 플러그인)
- Minisign 기반 자동 업데이트 (`/api/desktop-update/...` 엔드포인트)
- 다운로드 페이지 `/[lang]/download/` — 6개 언어, OS 자동 감지, SmartScreen 우회 안내, 출시 대기자 폼
- 관리자 API `/api/admin/releases` — 릴리즈 CRUD + `is_latest` 전환 (트랜잭션)
- 다운로드 카운터 `/api/releases/track` (4 플랫폼)
- GitHub Actions 릴리즈 파이프라인: 매트릭스 빌드 → R2 업로드 → DB 자동 등록

### 알려진 제약
- 코드 서명 없음 (Windows SmartScreen / macOS Gatekeeper 첫 실행 경고 발생 — 우회 방법은 다운로드 페이지 안내 참조)
- Tauri 업데이터용 minisign 서명만 적용 (무료)

---

## 작성 규칙

새 버전 릴리즈 시 상단에 섹션 추가 — 카테고리 예시:

- `### 추가` — 새 기능
- `### 변경` — 기존 동작 변경
- `### 수정` — 버그 수정
- `### 제거` — 기능 제거
- `### 보안` — 보안 관련

예:
```
## [v0.2.0] — 2026-05-XX

### 추가
- STEP 파일 직접 불러오기
```
