# NexyFab AI + 수동 혼합 설계 및 참고파일 재검토

- 기준일: 2026-08-09
- 참고 루트: `C:\Users\gomd9\Downloads\참고파일들`
- 보호 원칙: 참고 원본은 읽기 전용이며 이름 변경, 압축 해제, 변환 결과 덮어쓰기 또는 메타데이터 수정을 하지 않는다.
- 제품 목표: 일반 사용자는 AI로 완제품 설계를 진행하면서 필요한 치수·옵션을 직접 조정하고, 전문가는 동일 설계 원본을 정밀 CAD에서 더 깊게 편집한다.

## 1. 채택한 사용자 흐름

```text
AI 자동 설계
  → 사용자가 치수·옵션을 숫자/슬라이더로 직접 조정
  → 사용자 확정값 잠금(AI가 덮어쓰지 않음)
  → AI가 나머지 제품 구현·검증 계속
  → 필요 시 전문가가 동일 피처·치수 모델 직접 편집
```

수동 조정은 AI 설계를 버리고 별도 모델을 만드는 기능이 아니다. 동일한 구조화 피처 프로그램과 SCAD 파라미터에 반영되며, 전문가 CAD 인계 시에도 유지된다.

## 2. 이번 구현 범위

- AI Studio 파라미터 패널 명칭을 `AI + 수동 조정`으로 명시
- 슬라이더와 함께 정확한 숫자 직접 입력 지원
- 사용자가 값을 바꾸면 자동 잠금
- 사용자가 잠금을 해제하기 전까지 후속 AI 생성·자동 수정·시각 개선에서 해당 값 재적용
- 정밀 FeatureProgram의 width/depth/height, hole/boss/rib, shell, fillet/chamfer 및 pattern 값을 역갱신
- bolt-circle UI의 radius 값을 구조화 프로그램의 PCD로 정확히 환산
- 전문가 CAD 인계 시 수정 전 프로그램이 아니라 수동값이 반영된 피처 프로그램 전달
- 전문가 작업공간의 기존 push/pull, fillet/chamfer, body transform, subtract 및 history 승격 기능 유지

## 3. 참고파일 인벤토리

`rg --files` 기준 비무시 파일은 6,907개다. 숨김·결과 디렉터리를 포함한 파일시스템 실측은 7,176개, 총 40,121,691,626 bytes다.

| 형식 | 수량 | 이번 목적에서의 활용 |
|---|---:|---|
| SLDPRT / SLDASM | 1,145 / 211 | 부품 피처·대형 조립 구성·수동 변경 시 영향 범위 ground truth 후보 |
| IPT / IAM | 171 / 27 | 부품 파라미터와 조립 구속조건 후보 |
| STEP / STP | 84 / 73 | 외부 CAD 없이 가능한 exact B-Rep, 수동치수 변경 후 왕복검증 |
| IGES / IGS / X_T | 15 / 37 / 25 | 곡면·바디 구조와 중립형식 비교. mate 의미는 별도 증거 없이는 추정 금지 |
| DWG / DXF / SLDDRW | 151 / 19 / 62 | 수동 치수·공차·도면 변경과 3D 연계 검증 |
| STL / SCAD | 939 / 403 | 자유형 AI 결과와 수동 파라미터 UX 비교. 제조 exact 증거로 승격 금지 |
| IFC / RVT / SKP | 87 / 76 / 15 | 공간계층·건축 제품군. 기계 CAD와 별도 vertical로 평가 |
| JPG / PNG | 868 / 477 | 이미지 의도와 생성 형상 비교. 치수 ground truth로 간주하지 않음 |

## 4. 추가로 우선 참고할 실제 후보

### P0 — AI + 수동 변경 회귀 세트

1. `robot-5-dof-1.snapshot.2`
   - IPT/IAM 부품과 조립이 함께 있어 부품 치수 변경 → 조립 구속·간섭 영향 검증에 적합
   - 네이티브 mate를 읽지 못한 경우 파일명이나 형상만으로 구속조건을 추정하지 않는다.
2. `robotic-arm-466.snapshot.3`
   - 동일 제품의 STEP, X_T 및 렌더 이미지가 있어 형상·바디 수·시각 결과를 교차 확인하기 좋다.
3. `truck-loading-conveyor-4.snapshot.2`
   - 대형 SLDASM 계층과 반복 부품이 있어 수동 치수 변경의 affected-part 범위와 BOM 수량 회귀에 적합하다.
4. `1-cylinder-horizontal-mill-steam-engine.../ASSY-NTC-1CHMS.STEP`
   - 다부품 STEP 조립과 회전/왕복 제품의 수동 조정 후 clearance 검증 후보다.
5. `w140-mercedes-benz-coupe...`
   - STEP과 SLDPRT가 함께 있어 복잡 곡면의 직접 편집 가능/불가능 경계를 분류하는 데 유용하다.

### P1 — 도면·제조 연결

- DWG/DXF/SLDDRW가 포함된 제품은 `수동 치수 변경 → 3D 재생성 → 도면 치수 갱신 → STEP 왕복` 체인의 fixture로 사용한다.
- STEP/STP 157개 중 부품·조립·PMI·곡면을 층화하여 한 제품군에 편향되지 않은 회귀 세트를 만든다.
- 기존 `result/ir`의 STEP, X_T, IFC, IGES, DXF 추출 결과를 우선 재사용하고 원본 네이티브 파일에 외부 CAD 설치를 요구하지 않는다.

### 보조 참고

- `LLM_METHODOLOGY.md`에서 채택할 원칙은 모델에게 최종 결정을 맡기지 않고 관계·제안만 생성하게 하는 것, 반복 결과의 분산을 확인하는 것, 사용자 승인 전 자동 적용을 제한하는 것, 체크포인트를 즉시 저장하는 것이다.
- 다만 해당 문서의 모델 공급자·키·엔드포인트 운영 내용은 CAD UX 요구사항과 무관하므로 제품 코드에 가져오지 않는다.

## 5. 다음 구현 우선순위

1. AI Studio 안에서 부품 위치·회전과 간단 mate를 숫자로 조정
2. 피처별 `잠금 / 숨김 / 억제 / 순서 변경`을 일반 사용자용 문장으로 제공
3. AI 변경 전후 diff 미리보기와 `적용 / 일부 적용 / 거부`
4. 수동 변경 전용 undo/redo 체크포인트와 `.nfab` revision 기록
5. P0 참고 후보로 `AI 생성 → 수동 변경 → AI 재수정 → 전문가 인계 → STEP 왕복` 회귀 테스트 구축

이 순서는 일반 사용자에게 전체 CAD 도구를 노출하지 않으면서도 AI에 전적으로 종속되지 않게 한다. 정밀 CAD 작업공간은 계속 전문가 선택 기능으로 유지한다.

## 6. 구현 후 최종 검증

- 프로덕션 빌드: 성공 (`next build --webpack`, 정적 페이지 634개, 번들 예산 통과)
- TypeScript: 성공 (`npm run typecheck`)
- 대상 단위 테스트: 5개 파일, 13개 테스트 성공
- 복잡 제품 범위 증적: 성공 (`npm run complex:scope:check`)
- CAD 커널 스택 무결성: 성공 (`npm run kernel:identity:check`)
- CAD API 제어 증적: 57개 라우트/57개 핸들러, 이슈 0건
- 상용 OCCT 준비 검사: 경고 0건, 오류 0건
- Closed Beta 보호 데이터: 기준 스냅샷과 DB 지문·DB 크기·17개 보호 테이블/13개 행·15개 파일/15,429,420 bytes 모두 동일
- 최종 불변 스냅샷: `validation-reports/closed-beta-integrity-260809-ai-manual-hybrid-final.json` (read-only)

배포 환경의 남은 운영 항목은 `REDIS_URL` 설정이다. 미설정 상태에서도 빌드는 성공하지만, 여러 서버 인스턴스로 확장하면 인메모리 rate limit 상태가 공유되지 않으므로 상용 배포 전 Redis 기반 제한을 활성화해야 한다.

## 7. 전체 참고자료 활용 연결 결과

2026-08-09 재실측 기준 참고 루트에는 파일 7,216개, 40,122,948,825 bytes가 있다. `.git`, `node_modules`, `.gate_work`, 환경파일 및 키처럼 보안상 평가 대상에서 제외해야 하는 302개는 경로 자체를 manifest에 기록하지 않고 해시와 수량만 기록했다. 나머지 6,914개, 39,502,044,994 bytes는 모두 SHA-256을 계산하고 467개 제품 lineage와 다음 활용 lane에 빠짐없이 배정했다.

| 활용 lane | 수량 | 적용 방식 |
|---|---:|---|
| exact exchange | 157 | STEP/STP B-Rep·조립·왕복 검증 후보 |
| governed automated | 809 | STL/DXF/IFC/X_T 자동 importer 계측 |
| bounded geometry | 110 | IGES/SAT/OBJ/3MF/DAE/WRL/FBX/3DS의 명시적 제한 경로 |
| native semantics review | 2,212 | SLD*/IPT/IAM/CAT*/DWG/RVT/PRT 등의 authoritative extraction 또는 전문가 검토 |
| visual reference | 1,432 | AI 시각 의도와 외관 비교. 치수 ground truth로 사용 금지 |
| document·metadata·archive context | 541 | 요구사항·도면·lineage·압축 컨테이너 연결 |
| derived IR/result reuse | 1,517 | 기존 IR과 결과 재사용. 독립 ground truth로 승격 금지 |
| adapter backlog | 136 | 미등록 형식의 향후 adapter backlog. 임의 실행 금지 |

자동 계측 대상으로 연결된 1,076개를 전수 입구검사한 결과 1,074개가 형식 서명을 통과했다. 실패 2개는 손상 판정이 아니라 확장자 불일치로 격리했다.

- `Multi-Port Flanged Pipe Manifold.step`: 실제 헤더는 Creo 네이티브 `#UGC`
- `Modulmech_Towercrane.step`: 실제 내용은 eDrawings가 생성한 STL

대표 golden 8개 제품군의 깊은 검증에서는 4개가 전체 통과했고 4개는 측정 가능한 항목은 통과했으나 소스에 인증된 mate/joint, 중첩 조립, motion constraint 등이 없어 `not_run`으로 유지됐다. 실패를 성공으로 바꾸거나 형상만 보고 제약조건을 추정하지 않는다.

생성 증적:

- `docs/evidence/cad-independent/reference-utilization-manifest-260809.json`
- `docs/evidence/cad-independent/reference-utilization-queues-260809.json`
- `docs/evidence/cad-independent/reference-format-probe-260809.json`
- `docs/evidence/cad-independent/reference-golden-corpus-260809.json`

모든 자료는 현재 로컬 평가·회귀·전문가 검토용이다. 출처와 상업적 사용권 검토 전에는 AI 학습 데이터나 상용 점수 ground truth로 사용하지 않는다. 이 제한은 자료를 버리는 것이 아니라 상용화 시 저작권·라이선스 위험 없이 계속 활용하기 위한 승격 조건이다.

전체 활용 연결 후 Closed Beta 불변 스냅샷 `validation-reports/closed-beta-integrity-260809-reference-utilization-final.json`을 다시 생성했다. 최초 보호 기준과 DB 지문·DB 크기·17개 보호 테이블/13개 행·15개 보호 파일/15,429,420 bytes가 모두 동일했고, 검사는 읽기 전용으로 완료됐다.
