# Changelog

모든 주요 변경사항은 이 파일에 기록됩니다.
버전 규칙: [SemVer](https://semver.org/lang/ko/) — `MAJOR.MINOR.PATCH`

CI(`release-desktop.yml`)의 `register-release` 잡은 이 파일에서 **해당 버전의 `##` 섹션을 추출**해 릴리즈 노트로 사용합니다. 섹션 헤더 형식은 `## [vX.Y.Z]` 또는 `## vX.Y.Z` 또는 `## X.Y.Z` 모두 지원됩니다.

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
