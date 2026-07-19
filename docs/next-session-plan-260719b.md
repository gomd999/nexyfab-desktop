# 다음 세션 인수인계 계획 (260719b — 큐 1~6 + T1~T3 완료 후)

목표 불변: **참고파일들 수준의 2D 도면 + 그 도면만으로 실시(제작 착수)**. 원칙: 생성≠검증 ·
날조 금지 · 근사/거부는 명시. 테스트는 CLI·MCP·API 3면 + 골든으로.

## 0. 이 세션에서 완료(전부 커밋·배포)

- **피팅 배치**(elbow/tee/flanged_fitting+flange 볼트홀 공제) 커밋→배포→3면 스모크 ✔
- **R2-⑪ 표준표**: T슬롯 8시리즈·볼베어링 23종·UCP 유닛 7종 — snap 3함수+감사+BOM/부품도 연동
- **C1 프록시 전수 인벤토리**: 어휘 30종 × analytic/SCAD/STEP 3열 자동 대조 → 회귀 편입.
  발견 폐형 버그 4건 정정(plate 구멍·base_plate 볼트홀·l_bracket 코너·bent_sheet 절곡).
  문서화 프록시=coil_spring(트위스트 압출)·pillow_block(STEP 박스)·mesh(표시) — C2 대상
- **E2 골든 확대**: 2D 11종(TEMA·피팅·RC보·SWRO 추가)+GA_3D 3종(swiftshader 0.000% 결정론)
- **E1 실윤곽 투영**: 비90° 회전=placedCorners 볼록헐 폴리곤(FRONT/PLAN)
- **D1 판독 역투영 diff**: reproject-diff(무의존 코어) — extract 자동 배선+route 되묻기
  (DEMOTE=수치 신뢰도 무관). 한계 명시: 균일 배율 오류=T3 몫
- **R2-⑨ 컨베이어**(벨트/롤러)·**⑩ 송전탑**(angle 격자 — Euler 유도·E1 헐 144폴리곤) 템플릿
  + **격자 절점 랩 규칙**(refineInterferencesMesh latticeLapMm3 opt-in)
- **T1 구멍류 제조 피처**: cbore·csink·탭(KS B 0201 하경)·블라인드·키홈·오링 홈 —
  holeFeature 단일 소스, 3면 체적 ±1% 정합, 부품도 구멍표
- **T2 실시 검도 게이트 M1~M6**(execution-gate.mjs): 치수충분성(PARAMS↔기입 숫자)·구멍표·
  용접기호 실배치(GA 지시선 신설)·나사 표기·재질+일반공차(표제란 주기 신설)·실윤곽.
  부품도에 제작 치수 행 신설(M1 단일 소스)
- **T3 DXF DIMENSION 결정론 판독**: dims 분류(선형H/V·지름·반지름)+reconcileIntentWithDxf
  (±2% 실측값 직사용·unverified 보고) — dxf-seed API intent 동봉 시 reconciled 응답

테스트 158/158 · visual-golden 14/14 · 3면 스모크 통과. 배포 -102(큐 배치)·-103(T 배치).

## 1. 다음 큐(우선순위 순 — 260719b 말 배선 감사 반영)

배선 감사 결론(에이전트 전수): **MCP/CLI generate_package = 완전 배선 기준면**(welds+A1+B1+
부품도+fab-spec — mcp-server.mjs:503~539). **웹 /drawing/package 라우트가 주 격차**:
ga2dDrawing 에 welds 미전달(route.ts:104)·부품도/fab-spec/A1/B1 전부 미포함.
미배선 3종(테스트 전용)=checkExecutionReadiness(T2)·auditAssemblyStd·buildProxyInventory(C1).
T3 reconcile=dxf-seed 라우트만(MCP/CLI 없음). extract 의 reproject 판정은 성공 시 UI 미표시.

1. **P0 웹 도면집 동급화**: /drawing/package 라우트에 ①welds 전달(1줄) ②partSheets+
   fabricationSpec 동봉 ③A1 stepRoundTrip·B1 refineInterferencesMesh(의심쌍 시)
   ④checkExecutionReadiness 검도 리포트 동봉 — MCP 경로와 동일 구성으로. 골든/스모크 갱신
2. **P0-b 스튜디오 정밀 검증 버튼**: A1/B1 온디맨드 라우트 신설(+웹 UI 버튼) —
   DesignInner ④ 간섭 카운트 옆에서 메시 2차 해제·실측 관통량 표시
3. **P1 미배선 노출**: T2·auditAssemblyStd(+snapBearing 도달화)·T3 reconcile 을 MCP 도구/
   generate_package 동봉으로 승격. extract 성공 시에도 reproject 지지율 배지 표시
4. **P1-b DXF→추출 체인**: 스튜디오 DXF 업로드 시 비전 추출→reconcile 실측 교체 자동
   (T3 를 이미지 경로와 봉합 — unverified 만 되묻기)
5. **P2 정확도 잔여**: C2 실형상화(coil_spring 헬릭스·pillow_block STEP — KNOWN_PROXY 축소)
   · HLR 스파이크(1일 타임박스) · D2 멀티뷰 모순 검출 · 체결 자동(플랜지 짝→볼트 세트)
6. F1 스냅 적용 모드(옵션)·G1 패치 프리뷰(옵션) — 종전 계획 유지
7. 짝(mate) 선언(ADR-013 경계 신중) → 끼워맞춤 검증 → 조립도 판독 트랙(별도 설계 문서)
8. 위생: 저장소 루트 `_*.png/_*.mjs` 디버그 산출물 10개 정리(.gitignore/.railwayignore)
   · 골든 CI 이식성(동일 머신 전제 문서화됨)

## 2. 세션 운영 규약(직전 계획에서 유지 + 이번 세션 추가)

- routes→scripts import = `webpackIgnore+pathToFileURL(cwd)` 필수
- 배포 = CACHEBUST 범프+`railway up`(워킹트리) → status --json 폴링 → smoke-3surface
- GA_3D/골든 = `--use-gl=angle --use-angle=swiftshader` 고정(0.000% 결정론 확인됨)
- ⚠도메인 어셈블리에서 `[[a,b],[c,d]].entries()` 분해 함정 — 이번 세션 2회 재발(쌍 배열은
  직접 순회). AABB 가 문자열 오염되면 supportCheck 가 unknown 으로 정직 분리됨(신호)
- 골든 재블레스는 육안 확인 후(이번 세션: +21px=표제란 행, 0.2%=E1 협착 — 모두 의도 변경)
- proxy-inventory.test 의 KNOWN_PROXY 는 실형상화 완료 시 제거해야 통과(가드 의도)
