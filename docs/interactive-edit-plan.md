# 인터랙티브 편집 계획 — 픽킹→대상만 수정 + 다단 LOD (260719, 사용자 방향)

목표: 미리보기(확대·축소·선택 완비)에서 **면/선/바디를 잡고 그것만 수정**, LOD 는
1차 골격→2차 상세→**원하면 더 상세/일부 부품 교체**로 반복.

계약(불변): AI=지시→패치 이해만. 적용·게이트(어휘·간섭·지지·구조)=buildAssembly 결정론.
대상 외 부품 불변은 코드가 보장(AI 에 어셈블리 전체 재생성 금지).

## P0 — 엔진+라우트 (완료 260719)
- `scripts/drawing-to-3d/edit-part.mjs`: `applyPartPatch`(결정론 병합+재빌드 게이트),
  `faceOfPart`(월드 노멀→명명 면: box 6면·회전체 축단±/원통면 — 회전 box=v1 정직 null),
  `aiEditPart`(대상 부품 JSON+선택 면+이웃 AABB 10개만 프롬프트, 게이트 실패시 교정 1회)
- `/api/nexyfab/drawing/edit-part` (guardStudioAi·브레이커·800KB/600부품 캡)
- LOD: `assemblyAtLevel(asm, level)` — detail 정수 단계(1=골격, 2=상세, 3+=확장 여지)
- 실증: NX-TJ520 노즐 출구 확경(면 컨텍스트)·받침대 폭(중심 유지 보정)·기어박스 이동
  3연속 체인, 전부 간섭 0 게이트 통과

## P1 — 바디 픽킹 UI (다음)
- ChatHero splitMode 우측 패널 + DesignInner 뷰어: 부품별 AABB 프록시 레이캐스트
  (GA_3D 의 PARTS 픽킹과 동일 데이터 — placedAabb) → 클릭=선택 칩(부품 id)
- 선택 상태에서 입력창 전송 → `/drawing/edit-part` {assembly, partId, instruction}
  → 응답 assembly 로 재렌더(+검증그물 재실행·placeCorrections 표시)
- 선택 해제·다중 선택(v1 단일)·선택 부품 하이라이트(THREE.Box3Helper — H3 재사용)

## P2 — 면 픽킹
- 레이캐스트 히트 삼각형의 월드 노멀 → `faceOfPart` → {face,label} 를 edit-part 에 동봉
- UI: 선택 칩에 면 라벨 표기("nozzle · 축단(+)"). 회전 box 면 명명 확장(역회전 변환)

## P3 — 선(엣지)
- 프리미티브 엣지=파라메트릭 명명(원통 끝단 원호·box 모서리) → 필렛/챔퍼 인텐트
  (`intentToStep filletMm` 경로 재사용, 부품 단위)

## P4 — 부품 교체·3차 상세
- 같은 role/계통의 교체 후보 카탈로그(detail-macros·std-catalog) → "이 부품을 ○○로 바꿔"
- detail:3 확장(기어박스 내부 기어열·배관 상세 등) + "이 부품만 더 자세히"
  (부품→매크로 승격: casterAssembly/flangedNozzle 패턴)

## 비범위(정직)
- 자유곡면(mesh) 부품의 면 단위 편집(블레이드=생성기 파라미터 재생성이 정도)
- 위상 지속 참조(진짜 B-rep face id — own CAD ADR-013 영역)
