# M5 — FEA 워크플로 튜토리얼 (v0)

**상위:** [M5_SIMULATION_DFM_CAM.md](./M5_SIMULATION_DFM_CAM.md) · [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) §M5.

이 문서는 Shape Generator에서 **선형 정적 FEA(선형 FEM Tet4 또는 보 이론 폴백)** 를 한 번 끝까지 돌리는 최소 절차를 고정한다. 코드 기준: `analysis/FEAPanel.tsx`, `analysis/simpleFEA.ts`, `workers/feaWorker.ts`, `ShapeGeneratorInner.tsx`의 `handleFEARunAnalysis`.

## 전제

- 파트에 **유효한 삼각 메시**가 있다(박스·라이브러리 파트·익스트루드 결과 등).
- 플랜에서 FEA가 허용된다(미허용 시 업그레이드 프롬프트).

## 절차 (고정 워크플로)

1. **분석 패널 열기**  
   리본 **Evaluate** 그룹에서 **FEA**(`ev-fea`)를 누른다. 우측에 **응력 해석 (FEA)** 패널이 열린다.

2. **재료**  
   패널 상단 재료 프리셋(알루미늄, 스틸, 티타늄, 구리, ABS, 나일론 등) 중 하나를 선택한다.  
   내부적으로 탄성계수·포아송비·항복·밀도가 `FEAMaterial`로 `runSimpleFEA` / 워커에 전달된다.  
   (씬의 `materialId`와 연동되는 표시는 UI 버전에 따라 다를 수 있으나, **해석에 쓰이는 값은 패널에서 고른 재료 프리셋**이 기준이다.)

3. **경계 조건**  
   - **고정(Fixed)**: 면을 클릭해 고정할 삼각형 면을 지정한다.  
   - **하중(Force)** 또는 **압력(Pressure)**: 하중이 가해질 면과 크기/방향을 지정한다.  
   최소 **고정 1개 + 하중(또는 압력) 1개** 조합을 만든 뒤 진행한다.  
   조건이 비어 있으면 **해석 실행**이 동작하지 않는다(`feaConditions.length === 0` 가드).

4. **해석 실행**  
   **해석 실행**을 누른다. 워커가 `runSimpleFEA`를 호출하고, 완료되면 **최대 응력·변위·안전율** 등이 패널에 표시된다.

5. **결과 읽기**  
   - **표시 모드**: 응력 / 변위 / 변형(배율 조절) 등 오버레이와 패널 수치를 함께 본다.  
   - 정확도는 제품 내 고지대로 **대략 ±30–50%** 범위의 교육·개념 검증용이다.

6. **종료**  
   패널 닫기로 조건·결과 상태를 정리한다(필요 시 다시 FEA를 열어 초기화).

## 자동 회귀와의 대응

`src/test/m5/m5BridgeSmoke.test.ts`는 박스 메시에 대해 **고정 면 1 + 하중 면 1** 만으로 `runSimpleFEA`를 호출한다. UI 튜토리얼의 **재료·하중·고정** 최소 조합은 이 스모크와 동일한 물리적 의미를 갖도록 맞춰 두었다.

## 수동 검증(로드맵)

샘플 파트로 고정·하중 방향을 바꿔 가며 응력 분포가 직관과 크게 어긋나지 않는지 **눈 검증** 한 번을 권장한다([M5_SIMULATION_DFM_CAM.md](./M5_SIMULATION_DFM_CAM.md) 수동 항목).
