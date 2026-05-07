# 3D 툴 순차 구현 트래커

**기준:** `docs/3d-tools.md` §9–10 및 `JSCAD_OPENSCAD_BRIDGE.md`  
**목적:** “다음에 무엇을 실제 코드로 할지” 한 페이지에서 추적합니다.

---

## 다국어 (i18n) — 상용 AI CAD 공통 규칙

라우트 언어 코드는 `kr`, `en`, `ja`, `cn`, `es`, `ar` (**6개**)이며, 일부 UI 사전은 ISO 스타일 키 `ko`, `zh`를 씁니다. **`toIsoLang()`** (`src/lib/i18n/normalize.ts`)으로 첫 경로 세그먼트를 **`ko` | `en` | `ja` | `zh` | `es` | `ar`** 중 하나로 정규화한 뒤 문자열 테이블을 고르세요.

| 규칙 | 설명 |
|------|------|
| **6개 동시** | Phase 1·2·상용(쿼터·에러·설정)으로 **추가하는 모든 사용자 노출 문구**는 위 6개 로케일에 동시에 추가합니다. 영한만 넣고 나머지 TODO는 금지(번역은 영어 복붙 후 네이티브 교체 가능). |
| **RTL** | `ar`는 루트 `layout`에서 `dir="rtl"` — 새 패널은 가능하면 논리 속성(`margin-inline`, `text-align: start`) 사용. |
| **서버 메시지** | API `error` 문자열은 기본 **영어** 또는 추후 `Accept-Language` / 저장된 locale과 매칭하는 별도 작업으로 일원화(상용 출시 전 정리). |
| **신규 사전** | shape-generator 계열은 `OpenScadPanel`처럼 `ko`/`zh` 키 + `langMap` 대신 **`toIsoLang`** 기반으로 통일하는 것을 권장합니다. |

---

## Phase 0 — OpenSCAD CLI 브리지 (MVP)

| 항목 | 상태 |
|------|------|
| `POST /api/nexyfab/openscad-render` + job GET | ✅ |
| 인메모리 FIFO 큐 + 단일 워커 루프 | ✅ |
| `OPENSCAD_BIN` / Windows `openscad.com` | ✅ |
| `OpenScadPanel` 전용 탭 | ✅ |
| Redis 큐 + S3/R2 아티팩트 + Docker 샌드박스 옵션 | ✅ (`REDIS_URL`, `S3_BUCKET`, `OPENSCAD_USE_DOCKER`) |

---

## Phase 1 — shape-generator 모놀리식 분리

| 항목 | 상태 |
|------|------|
| 라우트/레이아웃 단위로 sketch · assembly · topology · analysis 진입 분리 | ✅ 서버 리다이렉트 + `?entry=` (`sketch`·`assembly`·`topology`·`analysis`) |
| 공유 상태·번들 분할 (동적 import 경계) | ✅ `ShapeGeneratorInner`: 주요 툴바·바디·카트·파라미 등 `dynamic()` 분리 + 미사용 `FeatureTree` import 제거 |

---

## Phase 2 — 서버 사이드 B-Rep

| 항목 | 상태 |
|------|------|
| OCCT WASM 또는 전용 백엔드 기하 API 설계 | 부분 ✅ `BREP_WORKER_URL` → `…/tessellate` JSON 연동, 미설정 시 STEP 헤더 검증 + 안내 |
| STEP/B-Rep와 기존 클라이언트 파이프 연동 | ✅ `serverStepImport` → API 우선 / 실패 시 WASM; Redis 시 `nf:brep:queue` + `nf:brep:job:*` |

---

## Phase 3 — CAM (G-code 미리보기)

| 항목 | 상태 |
|------|------|
| 툴패스 생성 → 뷰어에서 경로 시각화 | ☐ |

---

## Phase 4 — 어셈블리 제약 솔버

| 항목 | 상태 |
|------|------|
| mate / contact / hinge 고급 제약 | ☐ |

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-06 | 문서 추가 — Phase 0 MVP 완료 반영 |
| 2026-05-06 | Phase 0 Redis/S3/Docker + Phase 1 스케치 라우트·로딩 컴포넌트 반영 |
| 2026-05-06 | 상용 AI CAD 대비 6개 로케일·`toIsoLang`·RTL·API 메시지 원칙 문서화 |
| 2026-05-06 | Phase 1: `assembly` / `topology` / `analysis` 라우트 + `entry` 쿼리 연동 |
| 2026-05-06 | Phase 1: `ShapeGeneratorInner` 동적 import 분리; Phase 2: `brep-bridge/contracts.ts` 계약 스켈레톤 |
| 2026-05-06 | Phase 1: `LeftPanel` 동적 import; Phase 2: `brep` STEP import API + 잡 큐 + `BREP_WORKER_URL` 스텁/워커 |
| 2026-05-06 | B-Rep: Redis 큐 + 임포트 UI(API 연동), `NEXT_PUBLIC_SERVER_STEP_IMPORT` |
