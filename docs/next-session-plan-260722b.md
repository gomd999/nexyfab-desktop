# 다음 세션 인수인계 — 2026-07-22b (Wave 5 게이트 공식 통과 · G2/G3 한계 해소 · Wave 6 착수)

**전임 문서**: `next-session-plan-260722.md`
**이 세션의 궤도**: 병렬 6트랙 — 한계 해소 4 + 커버리지 재실사 + W6-A

## 1. 완료 (전부 커밋됨)

### ★ Wave 5 웨이브 게이트 공식 통과 (재실사, 전 판정 실행 근거)
- **문서 D등급 10항목 기준 7/10 A 승격 = 70% ≥ 50%** (하류 재생성·실측 치수·
  도면 연동·end condition·피처 패턴·나사산·면 드래프트)
- 엄격 16분해 병기: A7/B4/D5 — D유지 5건 중 3건(SLDPRT·DWG·X_T)은 날조 금지
  정책의 의도적 정직 제외. 실 결손 = PDM 잠금·체크아웃/버전복원(Wave 6 소관)
- 판정표 전문은 EXECUTION_PLAN Wave 5 게이트 절 참조

### G2·G3 한계 해소 4트랙
- **R6 DXF 치수** (`2bce4bac`): sheetToDxf topologies 옵션 — 실측 치수를
  DIM_<id> 레이어 전개 프리미티브로. 실패는 숫자 미방출+사유 코멘트.
  G2 하네스의 한계 assert 반전. 미공급 시 바이트 동일
- **가이드레일 스윕** (`9f34abc8`): 파라미터 동기 1-가이드, 절두체 relErr
  1.7e-15, 무가이드 비트 동일. shapeDict 6언어 라벨 5종 포함
- **UI 배선** (`477937b1`): useRefRelinkWiring(상실→패널→적용→자동 재빌드,
  G3 한계 해소) + SAT/IGES/IFC 버튼+planLimits(STEP 동급). ⚠️named 채널
  (도면 치수/메이트 상실)은 미배선 선언 — 페이지가 앵커 소스 미보유
- **assembly 잔차** (`96153550`): distance plane 양 엔진 가짜 수렴 수정
  (gauss 정렬 회전 확장), hinge 프록시 기계판독 근사 마커
  (`MateResidual.approximation`)

### Wave 6 착수 — W6-A ✅ (`3f1d1ed6`)
/api/documents 500 근본 복구: **int4 오버플로**(ms-epoch>2.1e9)가 본체.
실 Docker PG16 재현→BIGINT 포팅 검증(멱등·bigint 12/12·기존 행 보존)→
실DB 통합테스트 10케이스(상태코드 전수). 프로덕션은 재배포 시
initPostgresSchema 경로로 자동 적용.

### 검증·배포
documents+cloudDoc 90/90 · 어셈블리 585 · UI 배선 85 · 도면 401 · tsc 클린.
배포 -109 = 이 배치 (전환 확인 절차: 셸 청크 지문 변화+smoke).

## 2. 다음 작업 (우선순위 순)

1. **배포 -109 전환 확인**(지문+smoke) — 특히 이번엔 /api/documents가
   프로덕션에서 처음으로 살아나는 배포: 배포 후
   `curl https://nexyfab.com/api/documents` 401(200 아님, 미인증) 확인 권장.
2. **Wave 6 잔여 (→G4)**: W6-B PDM 배타 잠금·체크아웃(코드 부재 — 재실사
   확인) · W6-C 버전복원(restore 라우트 부재)·머지 UI(mergeFeatures 엔진은
   25/25 실증, 소비자 0) · W6-D VersionTreePanel 실데이터 연결(현재
   DEMO_SEED 시각화 — mock 원칙 정합) + 협업 WS 배선.
3. B 잔여 소탕: named 채널 재지정 배선(도면 페이지 쪽) · IGES 서피스(144)
   승격 검토 · promptUpgrade 라벨 labels.ts 6언어 편입.
4. LCG 9곳 정리(이월).

## 3. 검증 명령 (재현)

```bash
npx vitest run src/app/api/documents src/lib/cloudDoc               # 90/90
npx vitest run src/test/drawing/g2MachinedPartGate.test.tsx          # 6/6 (DXF 치수 포함)
npx vitest run src/test/assembly/g3AssemblyGate.test.ts              # 4/4
npx vitest run src/lib/assembly scripts/dogfood                      # 585
npx vitest run "src/app/[lang]/shape-generator"                      # 전체 (~6분)
node scripts/e2e/smoke-3surface.mjs --base https://nexyfab.com
```
