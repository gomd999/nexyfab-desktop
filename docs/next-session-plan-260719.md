# 다음 세션 인수인계 계획 (260719 확정)

목표 불변: **참고파일들 수준의 2D 도면 + 그 도면만으로 실시(제작 착수)**. 원칙: 생성≠검증 ·
날조 금지 · 근사/거부는 명시. 테스트는 CLI·MCP·API 3면 + 골든으로.

## 0. 현재 상태(이 세션 종료 시점)

- **라이브(-100 이후 추가 배포 완료)**: 픽킹 편집 전 스택·LOD·REV·외부 3면(API/CLI/MCP·
  developers 페이지)·GD&T 판독·LandXML·철근 어휘·A1/B1 정확도 게이트·TEMA 템플릿까지
  전부 배포 SUCCESS + 프로덕션 3면 스모크 통과.
- **미커밋 워킹트리(검증 완료·커밋만 보류)** — 6파일:
  reconstruct/assembly/structural/to-step/roundtrip/domain-assemblies.mjs
  = 피팅 배치: `pipe_elbow`(파푸스 폐형·revolve 부분각 STEP {angle:도} 실측 0.04%)·
  `pipe_tee`(부품 내 부울)·`flanged_fitting` 템플릿(elbow90/ubend180/tee — 3종 RT PASS,
  1차 AABB 간섭은 B1 부울이 전건 해제)·**flange 체적 볼트홀 공제 수정**(A1 게이트가 잡은
  ~5% 질량 과대 — 제트 RT 0.07%→0.00%). 커밋 메시지 초안은 세션 로그 참조, 재검증:
  `npx vitest run scripts/drawing-to-3d`(134+) 후 커밋→배포(3면 스모크+골든).

## 1. 즉시 큐(승인된 "순차로 모두" 잔여 — 상세는 §3)

1. 미커밋 피팅 배치 **커밋 → 배포 → 3면 스모크**
2. **⑪ 표준표**(T슬롯 시리즈·SKF 베어링 → std-catalog+snap 함수+BOM 연동)
   + **C1 프록시 인벤토리**(어휘×SCAD/intent/STEP 3열 부피 자동 대조 스크립트 — 회귀 편입)
3. **E2 골든 회귀**(visual-golden 확대: 제트·TEMA·RC보·SWRO GA_2D/3D — swiftshader 고정)
4. **E1 실윤곽 투영**(GA 부품 사각→실린더 사영/OBB 헐 — 골든이 지켜줌)
5. **D1 판독 역투영 diff**(도면 경로만 — 클라 캔버스 IoU+치수 잔차 → 신뢰도 강등·되묻기)
6. **⑨ 컨베이어**(벨트/롤러)·**⑩ 송전탑**(angle 격자 — 교차부 접촉 규칙 1개 예상) 템플릿
7. F1 스냅 적용 모드(옵션)·G1 패치 프리뷰(옵션)·A1/B1 웹 온디맨드 버튼(스튜디오 "정밀 검증")

## 2. 실시 검도 게이트 트랙(사용자 요구 "실시제품 수준" — 1번 큐와 병행 삽입)

핵심 3종(상호 의존 — 이 순서):
- **T1 구멍류 제조 피처 어휘**: counterbore·countersink·탭홀(M+깊이)·키홈·오링 홈
  (reconstruct 4곳+composeIntent+STEP+체적) → 도면 구멍표(hole table)·N×⌀d·나사 표기와 짝
- **T2 치수 충분성 게이트(M체크리스트)**: 부품 파라미터 자유도 ↔ 도면 기입 치수 결정론
  대조 → "post_1: 높이 치수 누락" 거부. 신규 체크리스트 M1~M6:
  M1 치수충분성 · M2 구멍표 · M3 용접기호 실배치(KS B 0052 화살표) · M4 나사/모따기 표기 ·
  M5 재질·일반공차 주기(ISO 2768-mK 표제란) · M6 실윤곽 투영(E1/HLR)
- **T3 DXF/DWG 치수 엔티티 결정론 판독**: 벡터 도면이면 비전 대신 DIMENSION 엔티티
  실측값 직사용(dxf-seed 확장) — 판독을 추론→판독으로 격상
후속: HLR 스파이크(1일 타임박스, replicad/OCCT) → 용접기호 배치 → 체결 자동
(플랜지 짝→볼트 세트+길이 그립 계산) → 짝(mate) 선언(ADR-013 경계 신중) → 끼워맞춤 검증.

## 3. 참고 문서(전부 저장소에 있음)

- `docs/accuracy-roadmap.md` — 정확도 축 A~G 진단(A1/B1 완료 표시로 갱신 필요)
- `docs/interactive-edit-plan.md` — 픽킹 편집 P0~P2 완료 이력+P3/P4
- `docs/execution-level-plan.md` — 실시 트랙 원 계획(C1~C9 완료)
- 코퍼스 R2 잔여: ⑤RFA/RVT ⑫스키마 ⑬IFC4.3 테이퍼보 ⑥CRS ⑭SKP/F3D/3DM — 독점 포맷은
  "변환 안내"가 정직, 고객 요청 시 재평가
- 조립도 판독 트랙(대형): 뷰 분리→부품 후보→치수 귀속 3단계 별도 설계 문서 필요

## 4. 세션 운영 규약(학습된 함정 — memory 에도 있음)

- routes→scripts import 는 반드시 `webpackIgnore+pathToFileURL(cwd)` (배포 FAILED 원인이었음)
- FAILED 빌드 로그는 CLI stale — 로컬 `docker build` 재현이 정답
- webpack 증분 빌드 캐시 손상 재발 → 배포 빌드는 `rm -rf .next` 클린
- GA_3D 검증=캔버스 실렌더 기준, 스크린샷은 `--use-angle=swiftshader`
- 빈 openscad 교집합=STL 미출력(FS error) → 마커 큐브
- callGeminiJson 반환={data,model,repaired} 래퍼 — data 언랩
- 배포 후 표준: `node scripts/e2e/smoke-3surface.mjs --base https://nexyfab.com`
