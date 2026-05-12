# 3D Tool Smoke Test — 2026-05-13 session

본 세션이 36 commits을 master에 쌓았는데, 그중 5개 callback hook 추출
(MW step 5.1-5.5), B1 deep face provenance (boolean/hole/fillet/chamfer/
shell), STEP Route A, dead code 제거 (FeatureTree 1329 lines) 같은 작업
이 사용자 클릭 경로에 닿습니다. **브라우저에서 한 번도 검증 안 됨** —
이 가이드대로 5개 시나리오를 한 번씩 클릭해서 회귀 없는지 확인.

## 환경 준비

```bash
cd nexyfab.com/new
npm run dev
```

`http://localhost:3000/kr/shape-generator` 또는 `/en/shape-generator`
접속. (kr 도 ko 도 같은 페이지로 라우팅됨)

## 시나리오 1 — Sketch → Extrude (radial 메뉴)

**검증 대상**: `useRadialCommand` 훅 (MW step 5.3)

1. 빈 캔버스에서 우클릭(또는 라디얼 메뉴 핫키) → "sketch start" 선택
2. 캔버스가 sketch 모드로 전환되는지 (그리드/평면 표시)
3. 점 3-4개 찍어 닫힌 폴리곤 만들기
4. 다시 라디얼 메뉴 → "extrude" 선택
5. 3D 솔리드가 생성되는지

**OK 신호**: 메뉴 명령이 의도대로 작동 (sketch_start/finish/extrude/cancel/fillet 분기), sketch tool 변경 가능
**FAIL 신호**: 메뉴 클릭 후 모드 전환 안 됨, 콘솔에 `useRadialCommand` 관련 에러

## 시나리오 2 — Boolean cut + B1 face provenance

**검증 대상**: B1 deep (boolean.ts), DFM↔FeatureTree highlight 흐름

1. 박스 shape 선택 (왼쪽 패널)
2. Feature 추가 → "boolean" 또는 "hole"
3. 파라미터 설정 후 적용
4. DFM 패널 열기 (분석 → DFM)
5. "분석 실행" → 결과 issue 중 하나 클릭
6. **기대**: FeatureTree에서 해당 issue를 만든 feature 행이 하이라이트됨
7. 더 강력한 검증: cylinder cut을 적용한 후 DFM issue가 cut 영역에서 발생하면 cut feature가 하이라이트 (이전 coarse 구현에선 항상 마지막 feature가 하이라이트되어 wall 이슈도 cut으로 잘못 표시됐음)

**OK 신호**: 정확한 feature 행 하이라이트 (~4초 후 자동 해제)
**FAIL 신호**: 잘못된 feature 하이라이트, 또는 하이라이트 안 됨

## 시나리오 3 — Face click + Mate

**검증 대상**: `useCanvasSelectionHandlers` 훅 (MW step 5.1)

1. 박스 추가 후, 라이브러리에서 추가 파트 드래그-인 (2개 파트 어셈블리)
2. Face selection 모드 활성화
3. 파트 A의 한 면 클릭 → 강조 (highlight triangles)
4. 파트 B의 한 면 클릭 → Mate 자동 생성, toast 메시지
5. Assembly 패널 열기 → mate 항목 1개 존재
6. Shift+click으로 multi-face 선택도 테스트 (같은 파트의 여러 면)

**OK 신호**: face 강조 즉시 반응, mate 생성 후 적절한 type 추정(coincident/concentric), parallel 경고 toast
**FAIL 신호**: face click 후 강조 없음, mate 생성 안 됨, 같은 파트 face 두 개 선택 시 mate 에러 메시지

## 시나리오 4 — STEP export (Route A 검증)

**검증 대상**: STEP Route A (mesh → OCCT bridge)

1. 박스 export → STEP 다운로드 → 파일 열어서 헤더 확인 (AP214 또는 AP242)
2. 박스에 hole 추가 (또는 cylinder shape 직접) → STEP export
3. **변화 전**: cylinder/sphere는 export 버튼이 grey-out 되어 있었음
4. **변화 후**: Route A로 export 가능 (1초 정도 OCCT 변환 지연 후 다운로드)
5. 다운받은 STEP 파일을 다른 CAD 뷰어 또는 NexyFab에 import → 같은 형상 재현

**OK 신호**: cylinder/sphere geometry도 STEP export 성공, re-import 가능
**FAIL 신호**: export 버튼이 여전히 grey, 또는 다운로드된 파일이 빈 내용/invalid

## 시나리오 5 — File import + Auto Drawing

**검증 대상**: `useCanvasFileImport` 훅 (MW step 5.2), AutoDrawing J5

1. STL 또는 OBJ 파일 캔버스에 드래그-앤-드롭 (또는 import 버튼)
2. 형상이 표시되는지, BOM 패널에 multi-part 면 보이는지 (어셈블리 STL이면)
3. AutoDrawing 패널 열기 → "도면 생성" 클릭 → 4개 view 표시
4. 패널 닫기
5. 다시 AutoDrawing 패널 열기
6. **기대**: 이전 생성한 도면이 그대로 복원 (J5 store 패턴)

**OK 신호**: 도면 close/reopen 후 복원, import 후 toast 메시지 ("Imported X")
**FAIL 신호**: 도면이 매번 초기화, import 실패 toast, BOM 비어있음

## 일반 sanity check

- 콘솔에 빨간 에러 0개 (warning은 무시 가능)
- DevTools Network 탭에서 `/api/...` 호출 정상 (401/403/500 없음)
- 큰 어셈블리(50+ parts) 로드 시 5초 안에 첫 렌더

## 발견 사항 기록 위치

각 시나리오에서 회귀 발견 시:
- 콘솔 에러 → 메모 (어떤 액션 + 어떤 에러)
- 동작 차이 → "expected X, got Y" 형태로
- 보고: 다음 세션에서 "smoke test로 X 회귀 발견" 한 줄로 시작하면 빠르게 잡을 수 있음

## 안전 fallback

치명적인 회귀가 발견되면 이번 세션 commits 중 의심 commit revert:
- 5 hooks 의심: `git revert 0bb8a3e 5c63ab0 406cfe5` (Inner.tsx 마이그레이션만)
- B1 deep 의심: `git revert 53a7c22 f6d5a22 2c6eb58 2547239`
- STEP Route A 의심: `git revert edfad4e c348c4a`

각 commit이 의미 단위로 분리되어 있어 부분 revert 안전합니다.
