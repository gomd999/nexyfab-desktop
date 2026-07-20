# 다음 세션 인수인계 — 2026-07-21b (G2 통과 · Wave 5 1차분 6트랙 · 배포 배치)

**전임 문서**: `next-session-plan-260721.md` (Wave 4 완결·행 근본수정)
**이 세션의 궤도**: 배포 배치 + G2 판정 실증 + Wave 5 병렬 1차분(에이전트 6트랙)

## 1. 완료 (전부 커밋됨)

### G2 게이트 ✅ 통과 (`8c8c6582`)
`src/test/drawing/g2MachinedPartGate.test.tsx` — Wave 4 게이트 문장("치수 기입
제작도면이 PDF로 나오고 모델을 바꾸면 따라온다")을 그대로 실행: L-브래킷
60×50×12+⌀50 보스 치수 7종 실측 1e-6 → 실제 jspdf+svg2pdf 벡터 PDF 바이트에
라벨 텍스트 확인 → t12→18 재실측. ROADMAP §5 G2=✅. **한계 고정**: R12 DXF는
치수 엔티티 미탑재(assert로 못박음, R6 이월) — 치수 반출은 벡터 PDF 기준.

### Wave 5 1차분 — 6/8트랙 (병렬 에이전트+오케스트레이터 재실측, 상세=EXECUTION_PLAN 표)
- **W5-F** `2e5934b8` solveMates 공개 파사드(F14 해소) — ref pre-flight로 가짜 수렴 차단
- **W5-B** `4aac93e1` 나사산 실절삭(종전 UNION=제거 0 → ISO 68-1 SUBTRACTION, Pappus 0.990)
- **W5-C** `05ea9cf1`+`5ad9e3fa` 면 선택 드래프트(종전 전역 shear)+정밀 캐비티 쉘(종전 +767%)
- **W5-E** `9ec1c9a3`+`a177ffe4` 마이터 프레임 엔진+컷리스트+툴바 sectionType 실전달(종전 4버튼 바이트 동일)
- **W5-G** `bb73f75b` SAT 실 B-rep 재구성(종전 3포맷 AABB)+XT/IGES fidelity 플래그
- **W5-A** `6a5b6471` 로프트 실형상(종전 닫힌 솔리드 아님·가짜 블렌드)+스윕 twist
- 병행: ADR-016·OWN_PRO_CAD 정정 추록 `3d8fd333` · 도면 관련분 테스트 함정 0건 확인

### 웨이브 종료 검증 (오케스트레이터 직접 실행, 260721)
전체 shape-generator **14,276 통과**(+78 vs Wave4 시점) · src/lib **5,304** ·
visual-golden **14/14** · ADR-017 스파이크 재실행 **9/9 수치 동일**(checkout 복원) ·
tsc 클린 · smoke-3surface **전부 통과**

### 배포
CACHEBUST -106/-107 두 차례 업로드(1차는 마커 오판정으로 재업로드 — 아래 ⚠️ 참조),
최종 -107 = Wave 4+5 커밋 정본 배치. **⚠️검증법 교훈**: 도면 페이지는 SSR 셸만
내려보내고 본문은 전부 클라이언트 렌더 — HTML 마커 폴링은 무효. 유효한 판정법 =
초기 셸 청크 지문(`/_next/static/chunks/*` 목록 md5) 변화 감시. 스모크는 3면 통과.

## 2. 다음 작업 (우선순위 순)

1. **배포 전환 최종 확인** — 셸 청크 지문이 `4B5E6951EF77559CA16BC69863C32EFC`
   (구 빌드)에서 바뀌었는지 + smoke 재실행. 안 바뀌면 Railway 대시보드에서 -107
   빌드 상태 직접 확인(⚠️ `railway redeploy`는 GitHub 롤백 함정 — 금지).
2. **Wave 5 2차분**: W5-D(end condition+피처 단위 패턴 — featurePlan의 pattern
   미지원 유지 판정과 조율 필요) · W5-H(익스포트 5종 신설) · 잔여 심화(W5-A
   가이드레일 스윕, W5-F mate 실구현 심화·gear 구동 semantics, W5-G XT/IGES 실
   재구성, 브라우저 워커 seamKeys 공급)
3. **커버리지 매트릭스 재실사** — Wave 5 게이트(D등급 절반 이상 A 승격) 판정은
   재실사로만. 1차분 6트랙이 실측 근거를 만들어 둠.
4. LCG 9곳 정밀도 손실 정리(골든값 영향 검토 후) — 260721 문서 §3 이월.

## 3. 정직 기록 잔여 (이월 포함)

1. W5 각 트랙의 명시 한계: 로프트 볼록 한정·원 32각형 / 나사산 샤프 프로파일·
   런아웃 미모델 / 쉘 볼록 평면다면체 한정(곡면=OCCT 전용) / 마이터 2멤버 노드
   한정 / SAT 평면 단일 폐셸 한정·실물 코퍼스 미실행(라이선스) / gear ratio
   정적 미소비 / GD&T 데이텀 "체인"은 datum feature IR 부재로 최소 검증
2. DXF 치수 엔티티 미탑재(G2 하네스가 assert로 고정) — R6/W5-H에서 처리 후보
3. 전임 문서 §3 이월분: LCG 9곳·childExtrude SCHEMA_VERSION 2·워커 심 명명
   legacy·System B S6 rows[55]

## 4. 검증 명령 (재현)

```bash
npx vitest run src/test/drawing/g2MachinedPartGate.test.tsx   # G2 게이트 5/5
npx vitest run scripts/dogfood/06-assembly-api.test.ts         # F14 재현 7/7
npx vitest run "src/app/[lang]/shape-generator"                # 전체 14,276 (~6분)
npx vitest run src/lib scripts/drawing-to-3d && node scripts/drawing-to-3d/visual-golden.mjs
npx vitest run scripts/spike/topo-naming-k22.test.ts           # 재실행 후 result.json checkout 복원
node scripts/e2e/smoke-3surface.mjs --base https://nexyfab.com
```
