# NexyFab 공개 페이지 개편 전 백업 (2026-07-11)

랜딩 개편 착수 전, 라이브(https://nexyfab.com)의 공개 페이지 렌더 HTML을 페이지별로 스냅샷한 "before" 기록.

| 파일 | 경로 | 크기 |
|---|---|---|
| `landing-kr.html` | /kr/ | 69KB |
| `landing-en.html` | /en/ | 77KB |
| `how-it-works-kr.html` | /kr/how-it-works | 55KB |
| `pricing-kr.html` | /kr/nexyfab/pricing | 65KB |
| `download-kr.html` | /kr/download | 44KB |
| `contact-kr.html` | /kr/contact | 40KB |
| `help-kr.html` | /kr/help | 43KB |
| `trust-kr.html` | /kr/trust | 42KB |
| `api-docs-kr.html` | /kr/api-docs | 36KB |
| `shape-generator-kr.html` | /kr/shape-generator (클라이언트 앱 셸) | 26KB |
| `simulator-kr.html` | /kr/simulator (클라이언트 앱 셸) | 36KB |

- 로그인 영역(admin/partner/dashboard)은 제외.
- 소스 자체의 백업은 git 히스토리가 담당 — 이 폴더는 **개편 전 실제 렌더 결과**의 동결본.
- 재수집: `node snapshot-nexyfab.mjs` (수집 일시·상태는 `snapshot-meta.json`).

## viewable/ — 더블클릭 열람용 자립형 버전

루트의 원본 스냅샷은 CSS/이미지를 라이브 상대경로로 참조해 **로컬에서 열면 깨져 보이고**,
개편 배포 후엔 해시된 `/_next/static` CSS가 사라져 복원 불가가 된다.
`viewable/`은 이를 대비한 자립형 변환본 (`node make-viewable.mjs`로 생성):

- 스타일시트 3종 fetch 후 `<style>` 인라인 → 배포 후에도 레이아웃 보존
- `<script>` 제거 (하이드레이션 오류 방지, 정적 열람 목적)
- 이미지/폰트 등 잔여 자산 경로는 `https://nexyfab.com` 절대경로화
- 파일당 ~270KB, 브라우저에서 바로 열면 개편 전 모습 그대로 렌더
