# AI 제조 검증 게이트 G0–G9

모든 판정은 `src/lib/ai/manufacturingGates.ts`의 fail-closed 규칙을 따른다. 증거가 없거나 검사가 실행되지 않은 경우 `not_run`이며 통과가 아니다.

| 게이트 | 판정 대상 | 필수 증거 | 현재 연결 상태 |
|---|---|---|---|
| G0 | 입력 출처·개인정보 | 입력 해시/참조, 보존 정책 | precise 프로그램에 SHA-256 참조 연결(원문 미보존) |
| G1 | 설계 의도 확정 | IR의 미확정 0, 충돌 0, 가정 확인 | Design Intent IR 및 clarification 완료 상태 연결 |
| G2 | 피처 프로그램 | 공용 계약 검증, 프로그램 해시 | API와 STEP 서버에 구현 |
| G3 | 해석형 커널 생성 | OCCT/replicad 빌드 성공, mesh 변환 아님 | precise STEP 서버에 연결 |
| G4 | 닫힌 단일 솔리드 | closed/manifold/solid count 실측 | OCCT topology의 실제 solid 수로 연결 |
| G5 | 치수 일치 | 결과 B-Rep 실측값과 IR 공차 비교 | base 3축 bbox를 0.05mm 공차로 연결 |
| G6 | 피처 일치 | 요청/검출 피처 수, 누락 0 | base와 관통홀/홀 패턴의 원통면 검출 연결; 리브·쉘·필렛은 미지원 |
| G7 | DFM | 공정·재료 명시, 위반 0 | 명시된 공정·재료의 호환성과 최소 두께 screening 연결; 미명시 시 not_run |
| G8 | STEP 왕복 | 같은 STEP 재가져오기 및 G4/G5 재비교 | OCCT 재가져오기 후 solid/face/bbox/volume 비교 연결 |
| G9 | 산출물 출고 승인 | 정확한 artifact ID와 승인 기록 | 현재 미연결(`not_run`); Studio는 제조·견적 출고를 수행하지 않음 |

## 출고 규칙

`verified`와 제조 출고 허용은 G0–G9가 모두 `passed`일 때만 가능하다. STEP 파일 생성 성공, 화면 렌더 성공, 메시 검사 성공은 각각 단독으로 제조 검증을 의미하지 않는다.

지원 피처 범위에서 공정·재료까지 명시하면 Studio의 analytic STEP export가 G0–G8 결과와 artifact SHA-256을 받는다. 그러나 Studio에는 공장 견적 요청이나 제조 출고 연결이 없으므로 G9는 `not_run`으로 남는다. 사용자가 내려받은 결과물을 외부에서 활용하거나 NexyFab에 별도로 문의하는 흐름과 Studio의 검증 상태는 분리한다.
