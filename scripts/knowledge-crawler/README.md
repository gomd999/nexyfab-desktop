# NexyFab knowledge crawler + local RAG index (Wave 1)

`docs/strategy/domain-expansion-plan.md` §2의 코퍼스 정책 구현 1단계.
저작권-안전분만 수집: 미 연방 간행물(퍼블릭 도메인, 17 U.S.C. §105). **문서별 라이선스 메타데이터 필수** — sidecar `<id>.meta.json` 없으면 인덱서가 반입 거부.

## 재실행 커맨드

```sh
cd scripts/knowledge-crawler
npm install                 # pdf-parse만 설치 (앱 package.json과 무관)
node crawl.mjs              # sources.json → data/<id>.pdf + <id>.meta.json (robots.txt 준수, 2s 스로틀)
node index.mjs              # 페이지별 텍스트 추출 → 1000자/150 오버랩 청크 → bge-m3 임베딩 → data/index/<id>.jsonl
node query.mjs "retaining wall overturning safety factor"   # 코사인 top-5 검색
node query.mjs "옹벽 전도 안전율"                             # 한국어 크로스링구얼 검색
```

- `--force` 재다운로드/재인덱싱, `--only id1,id2` 부분 실행.
- 임베딩 인증: `CLOUDFLARE_AI_API_TOKEN` env → 없으면 wrangler OAuth(`~/.wrangler/config/default.toml`, scope `ai:write`) 자동 사용.
  `Downloads/.env`의 `CLOUDFLARE_API_TOKEN` 2종은 Workers AI 권한 **없음**(2026-07-11 확인).
  OAuth 만료 시: wrangler.toml 없는 디렉터리에서 `npx wrangler whoami` 1회 → 토큰 자동 갱신.
- 모델: `@cf/baai/bge-m3` (1024-dim, 다국어 — 한국어 질의로 영문 코퍼스 검색 가능).

## KDS/KCS (국가건설기준) — manual-assisted, 자동 수집 금지

kcsc.re.kr은 React SPA + 인증 API. 2026-07-11 확인 결과:

- 문서 API(`/api/v1/tn_document_infos…`, `/api/v1/tn-document-contents?doc_info_seq=`)는 비로그인 시
  `403 "인가된 사용자가 아닙니다"` → **세션 없이 PDF 직접 다운로드 불가. 우회 금지.**
- 사이트에 robots.txt 없음(SPA 폴백). 번들/공개 API에서 공공누리(KOGL) 표기 미발견 → **KOGL 유형 미확인 상태.**

사람이 하는 절차(무료):
1. https://www.kcsc.re.kr 회원가입(무료) 후 로그인.
2. 건설기준코드 검색(`/standardCode/list`) → 해당 기준(예: KDS 11 80 05 콘크리트옹벽) → 뷰어에서 PDF 다운로드.
3. **또는(권장, 프로그램적)**: 마이페이지 → API서비스(`/support/api`)에서 OpenAPI key 발급 →
   `https://kcsc.re.kr/OpenApi/CodeList?key=…`, `https://kcsc.re.kr/OpenApi/CodeViewer/KDS/{6자리코드}?key=…`
4. 문서/사이트에서 공공누리 유형 확인 → `sources.json`의 `kds-kcs-kcsc` 항목 `license`를 실제 유형(예: `KOGL-Type1`)으로 교체하고 `enabled:true`로 전환해야 인덱서가 반입 허용.
5. 참고: KDS/KCS 본문은 국토교통부 **고시(행정규칙)** 로 law.go.kr에도 게재 — 저작권법 §7(보호받지 못하는 저작물) 적용 검토 여지. 단 plan §6-3의 법률 확인 선행.

## 산출물 포맷

- `data/<id>.meta.json`: `{docId,title,publisher,sourceUrl,license,licenseNote,tags,fetchedAt,sha256,bytes,contentType}`
- `data/index/<id>.jsonl`: 청크당 1줄 `{docId,title,page,chunkId,text,embedding[1024],license,sourceUrl,tags}`
- `data/index/_manifest.json`: 문서별 pages/chunks 통계.
- `data/`는 gitignore — 코퍼스는 커밋하지 않음.

## TODO (Wave 2)

- 인덱스를 Cloudflare Vectorize로, 원본 PDF를 R2 `/knowledge/usgov/`로 업로드, 라이선스 메타데이터 D1 등재 후 Worker 검색 API.
- KDS: KOGL 유형 확인 + OpenAPI key 발급 후 `kds` 소스 활성화 (`/knowledge/kds/`).
- 스캔 PDF OCR 경로 (현재 인덱서는 `no-text-ocr-needed`로 플래그만).
