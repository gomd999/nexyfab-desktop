# JSCAD ↔ OpenSCAD CLI 브리지 (설계 초안)

**버전:** 0.2 · **기준일:** 2026-05-06  
**상태:** 제품 **기본 경로 아님** — 브라우저는 `@jscad/modeling` + `runJscadCode` (`openscad/OpenScadPanel.tsx`). OpenSCAD CLI는 **1차 구현(MVP)** 으로 API·인메모리 큐·UI 탭이 추가됨(컨테이너 샌드박스·R2는 다음 단계).

---

## 1. 현재 제품 (단일 진실)

| 구간 | 구현 |
|------|------|
| AI 코드 생성 | `POST /api/nexyfab/jscad-gen` (**권장**); `openscad-gen`은 동일 동작의 레거시 URL |
| 실행 | `jscadRunner.ts` — 번들 내 `@jscad/modeling` |
| 형상 → 코드 힌트 | `POST /api/nexyfab/shape-to-jscad` |

**OpenSCAD** (`.scad` 문법 + `openscad` 바이너리)는 위 경로에 **없음**.

---

## 2. 브리지 목표

1. 사용자가 **순수 `.scad` 파일**을 업로드하거나 AI가 `.scad`를 생성한 경우 **STL/STEP(또는 메시)** 로 변환해 기존 뷰어·BOM·보내기 파이프에 넣는다.  
2. **보안**: 임의 코드 실행은 **샌드박스 워커**(컨테이너, 네트워크 off, CPU·시간·디스크 쿼터).  
3. **API**: `POST /api/nexyfab/openscad-render` (예시) — multipart `.scad` + 옵션 `--export-format` 등.

---

## 3. 아키텍처 스케치

### 3.1 구현됨 (MVP, 2026-05)

| 단계 | 코드 |
|------|------|
| API | `POST /api/nexyfab/openscad-render` — `checkPlan(free)` + IP·사용자당 rate limit |
| 동기 | 소스 ≤ ~200KB·출력 ≤ 2MB → 즉시 `dataBase64` (STL) |
| 비동기 | `async: true` 또는 큰 소스 → 인메모리 FIFO 큐 + `GET /api/nexyfab/openscad-render/job/[id]` 폴링 |
| 워커 | Node `child_process.execFile` + 임시 디렉터리 (`runOpenScadCli.ts`). `OPENSCAD_BIN` 미설정 시 Windows는 `openscad.com` 시도 |
| UI | `OpenScadPanel` 탭 **OpenSCAD(.scad)** — 동기/비동기 렌더·STL 다운로드 |
| 테스트 | `src/lib/openscad-render/__tests__/jobQueue.test.ts` (CLI 목) |

### 3.2 아직 없음 (상용 확장)

```
Client (.scad upload 또는 텍스트)
    → API
        → 분산 Job queue (Redis / SQS)
            → Worker pod: openscad-nightly 또는 고정 버전 (네트워크 off 컨테이너)
                → STL / OFF / 3MF 파일
    → R2 / S3 (대용량)
    → 기존 mesh import (STEP은 OCCT 별도)
```

- **동기 HTTP**는 소형만(현재 코드에 크기 상한).  
- **버전 고정**: 프로덕션에서는 OpenSCAD 이미지 태그 고정 권장.

---

## 4. JSCAD와의 관계 (중복 방지)

| 접근 | 역할 |
|------|------|
| **JSCAD (기본)** | 실시간 파라미터·AI 루프, 설치 없음 |
| **OpenSCAD CLI (옵션)** | 레거시 `.scad` 자산·교육용·외부 라이브러리 호환 |

**동시에 두 런타임을 같은 UX에 숨기지 말 것** — UI에서 “JSCAD 모드” / “OpenSCAD(.scad) 변환” 탭 또는 명시적 업로드 플로로 구분.

---

## 5. 상용 체크리스트 (도입 시)

- [ ] SBOM + 이미지 취약점 스캔  
- [x] per-user·per-org 쿼터·타임아웃 — MVP: `checkPlan` + rate limit + `execFile` timeout  
- [ ] 실패 시 `formatCadImportError` 수준의 사용자 메시지 (API는 JSON `error` 문자열)  
- [ ] `npm run verify`에 **스모크**만 (전체 CLI를 CI에 상시 올리지 않을 수 있음)  
- [ ] 컨테이너 샌드박스 + 객체 스토리지 업로드

---

## 6. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-06 | 초안 — UI는 JSCAD 중심으로 정리, 본 문서로 OpenSCAD 범위 분리 |
| 2026-05-06 | `POST /api/nexyfab/jscad-gen` 권장 URL 추가(`openscad-gen` 유지) |
| 2026-05-06 | MVP: `openscad-render` API + 인메모리 큐 + `OpenScadPanel` OpenSCAD 탭 |
