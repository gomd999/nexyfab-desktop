# NexyFab 다분야 AI·정밀 CAD 구현 및 검증 리뷰 (260809)

## 1. 결론

이번 단계의 구조 결정은 **하나의 공통 CAD/AI 코어 위에 기계·건축·토목·조경·인테리어 5개 분야 계약을 분리**하는 것이다. 화면만 바꾸고 같은 기계 규칙을 재사용하는 구조가 아니다.

- 기계·제품: B-rep, 피처, 부품/발생체, 조립, 조인트, 공차, 제조, STEP 중심
- 건축: 대지 좌표, 층/그리드, 공간, 호스트/개구부, 피난, 접근성, 외피, MEP, IFC 중심
- 토목: CRS/기준면, 측량, TIN, 선형/종단/횡단, 코리더, 배수, 토공/시공단계 중심
- 조경: 토목 지형 리비전, 식재 생육, 토양 체적, 포장, 관수, 표면배수, 유지관리 중심
- 인테리어: 현장 실측, 건축 호스트 리비전, 동선/문 스윙, 가구, 마감, 밀워크, 천장·MEP·조명·음향 중심

공통으로 남긴 것은 요구사항, 좌표·단위, 의미 객체, 기하, 관계, 출처, 리비전, 출력 정합성뿐이다. STEP, 부품 발생체, 조인트, 제조 규칙은 더 이상 비기계 분야의 공통 정확도 기준이 아니다.

## 2. 구현 범위

### 2.1 분야 계약과 정확도 축

- `src/lib/ai/domainProfile.ts`
  - 5개 분야 ID, 3개 제품군, 공통/분야별 증거 축, 필수 입력, 일반/전문가 도구 계약 정의
- `src/lib/ai/domainProfileRegistry.ts`
  - 분야별 schema, 용어, 필수 권위 입력, 도구, 검증기, 산출물, 입출력 형식 등록
- `src/lib/ai/domainAccuracyProgram.ts`
  - 공통 기계형 정확도 축을 제거하고 분야 프로필에서 정확도 프로그램을 투영
- `src/lib/ai/domainAccuracyEvidence.ts`, `domainValidatorAssertions.ts`
  - 비기계 결과가 기계 복잡 제품 증거로 자동 인증되지 않도록 `not_run`과 분야별 축을 명시

### 2.2 참고 규칙 분리

`referenceGuidedRefinement.ts`의 규칙을 다음처럼 분리했다.

- 공통: 요구사항, 권위 출처, 좌표/단위, 감사 추적
- 기계 전용: 피처 트리, 조립, assembly STEP, 형상 치유, 연결부
- 건축 전용: BIM/공간/호스트/개구부
- 토목 전용: 측량/선형/배수/시공단계
- 조경 전용: 지형/식재/관수/유지관리
- 인테리어 전용: 현장 실측/공간/천장/가구/마감

따라서 일반 요청이나 건축 요청에 기계 STEP 규칙이 자동 주입되지 않는다.

### 2.3 건축·인테리어 canonical 문서

기존 `nexyfab.architecture.v1`, `nexyfab.interior.v1`를 파괴하지 않고 선택 필드를 추가했다.

- 건축: 대지 좌표계, 진북, 그리드, 지붕, 계단, 소방/점유/열/보안 구역
- 인테리어: 현장 실측 증거, 밀워크, 천장 시스템, 음향 구역
- 검증: 전역 ID, 공간/호스트 참조, 층 연결, 구역 소속, 실측 출처·시각·허용오차
- 편집: 기존 공간 경계→벽/슬래브/천장/개구부 재생성과 천장→조명 종속 갱신 유지

### 2.4 CivilDocument

`src/lib/ai/civilDocument.ts`에 `nexyfab.civil.v1` 의미 모델과 검증기를 구현했다.

- EPSG, 수평/수직 datum, metre 단위
- 권위 출처, 측량 기준점, 점, existing/proposed TIN, breakline
- line/arc/spiral 선형과 1 mm 위치 연속성
- 종단, 횡단, 코리더, 타깃 표면
- 배수 노드/관, 유역, 구조물, 시공단계와 단계 순환 검출
- 출시 준비 게이트: CRS, 측량 기준, existing surface, 선형/종단, 배수, 출처

### 2.5 LandscapeDocument

`src/lib/ai/landscapeDocument.ts`에 `nexyfab.landscape.v1` 의미 모델과 검증기를 구현했다.

- 토목 문서/표면/리비전으로 고정된 지형 참조
- 식재 종, 설치 크기, 성숙 수관, 근권, 간격, 출처
- 식재 구역, 토양 체적/깊이/배수 등급, 포장 경사
- 관수 수원/밸브/점적/관/구역과 유량 용량
- 배수 경로, 최소 경사, 유지관리 접근 구역

### 2.6 FederatedProject

분야 문서는 하나로 합치지 않고 `UnifiedDesignProject`에서 연계한다.

- 관계 추가: `FOLLOWS_TERRAIN`, `DRAINS_TO`, `OCCUPIES_SPACE`, `REFERENCES_MODEL`, `PROVIDES_OPENING`
- 문서에 `profileId`, `profileVersion` 추가
- 좌표계 parent 순환 검출
- 중복 의미 관계 검출
- follow/notify/locked 양방향 변경 영향 유지
- `validateFederatedDomainProject`에서 조경–토목 좌표계, 지형 표면, 리비전, 명시 링크를 검증

조경이 토목 지형을 참조할 때 토목 표면을 조경 payload에 복사하지 않는다. 토목 지형 리비전이 달라지면 stale로 실패하며, `FOLLOWS_TERRAIN` 링크가 없으면 암묵적 결합으로 실패한다.

### 2.7 분야 AI 오케스트레이터

`domainDesignOrchestrator.ts`는 다음 순서로 동작한다.

1. 한국어/영어 요청을 5개 분야로 점수화
2. 명확한 단일 분야만 자동 선택
3. 복합 또는 불명확 요청은 분야 확인 요구
4. concept/exact/release 단계별 필수 입력 계산
5. 값, `authoritative=true`, `sourceRef`가 모두 없으면 입력 누락 처리
6. 누락 시 정밀/출시 단계 진입 거부
7. 분야별 schema, 검증기, 산출물, 일반/전문가 도구와 연계 링크 제안 반환

AI가 분야를 잘못 골랐거나 설계 기준이 없는 상태에서 정밀 결과로 승격시키는 경로를 닫았다.

### 2.8 UI/UX

실제 Modeler Shell 상단에 `DomainWorkspaceBar`를 연결했다.

- 기계·제품 / 건축 / 토목 / 조경 / 인테리어 전환
- 일반(Guided) / 전문가(Expert) 도구 수준 전환
- 선택 분야의 도구와 canonical schema 표시
- 세션 저장 및 `nexyfab:domain-workspace-change` 이벤트 발행
- 읽기 전용 상태에서는 분야/수준 변경 불가

일반 모드는 전문가 기능을 삭제하지 않고 노출 밀도를 낮춘다. 전문가 모드는 같은 문서 진실원에서 분야별 정밀 도구를 노출한다.

## 3. 검증 결과

### 3.1 정적 검증

- 전체 TypeScript: PASS (`node --max-old-space-size=8192 ... tsc --noEmit`)
- 변경 파일 ESLint: PASS, 오류 0
- Node 기본 4GB 타입 검사는 코드 오류가 아니라 heap OOM으로 중단되어 8GB로 재실행했다.

### 3.2 정확도·회귀

| 묶음 | 결과 |
|---|---:|
| 공통 정확도 + candidate CLI | 62 PASS |
| 기계 | 38 PASS |
| 건축 | 62 PASS |
| 토목 | 70 PASS |
| 조경 | 57 PASS |
| 인테리어 | 61 PASS |
| 합계 | **350 PASS** |

추가로 신규 Civil/Landscape/Federation/Orchestrator/UI 집중 회귀 14개가 통과했다. 분야 프로필·증거·참고 규칙 회귀도 별도로 통과했다.

### 3.3 배포 산출물

- 이번 실행 시각의 `.next/BUILD_ID`, `routes-manifest.json`, `build-manifest.json` 생성 확인
- `npm run build` 래퍼는 10분 제한 직전에 산출물을 만들었으나 셸 종료 코드를 반환하기 전에 timeout 됨
- `npm run postbuild` 별도 실행: PASS
- 공유 chunk 691.9 KB / 예산 763.3 KB
- 최악 initial JS 691.9 KB / 예산 763.3 KB

따라서 타입·Next 산출물·postbuild 예산은 통과했지만, 기록상 `npm run build` 단일 명령의 정상 종료 코드까지 받았다고 표현하지 않는다.

### 3.4 Closed Beta 무결성

- 사전: `validation-reports/closed-beta-integrity-260809-domain-platform-pre.json`
- 사후: `validation-reports/closed-beta-integrity-260809-domain-platform-final.json`
- read-only: true
- 보호 테이블: 17 → 17
- 보호 행: 13 → 13
- 보호 파일: 15 → 15
- 파일 바이트: 15,429,420 → 15,429,420
- DB 경로 지문, DB 바이트, 모든 테이블 내용 SHA-256, 파일 경로/내용 SHA-256: 동일
- 생성 시각만 제외한 전체 JSON: 동일

기존 Closed Beta ID, 비밀번호 해시, 계정, 감사 기록, 업로드 저작물은 변경하지 않았다.

## 4. 현재 상용화 판정

### 코드 플랫폼

- 5개 분야를 같은 기계형 모델로 처리하던 구조 위험: 해소
- 외부 CAD 설치 없이 사용할 내부 canonical 문서와 검증 코어: 구현
- 일반 사용자→AI 설계→필요 시 전문가 정밀 도구 진입 구조: UI와 계약 구현
- Closed Beta/Pilot에서 분야 기능을 제한적으로 노출할 기반: 가능

### 전체 상용 출시

현재 기술 출시 게이트는 **BLOCKED**다.

```text
[technical-release] BLOCKED
- audit.missing: CAD technical release audit v3 is required
```

이는 코드 컴파일 실패가 아니다. 실제 승인된 audit v3와 분야별 운영 증거가 아직 없으므로 시스템이 출시 가능하다고 거짓 판정하지 않은 것이다.

또한 다음을 실제 운영 증거 없이 완료로 주장하면 안 된다.

- 모든 복잡 제품·모든 건축/토목/조경/인테리어 유형의 무검토 자동 생성
- 비기계 분야의 모든 편집 도구가 현재 viewport에서 완전 작동한다는 주장
- IFC/LandXML/DWG 전 범위 round-trip 및 법정 제출 적합성
- 구조·토목·피난·접근성 결과의 전문가 최종 검토 대체

## 5. 다음 실행 게이트

결제·법무는 사용자 요청에 따라 뒤로 둔다. 기술 측 다음 순서는 다음과 같다.

1. 분야별 승인 benchmark/holdout과 권위 ground truth 확보
2. 분야별 AI 생성 adapter가 canonical 문서를 직접 생성하도록 API 연결
3. 건축 IFC, 토목 LandXML/IFC, 조경/인테리어 schedule·drawing round-trip 실증
4. UI의 표시용 분야 도구를 실제 command handler/viewport 편집기로 순차 연결
5. 5개 분야 campaign 실행과 exact/release gate 증거 생성
6. CAD technical release audit v3 생성·서명·검증
7. canary에서 false-verified 0, 보안 위반 0, Closed Beta diff 0 확인

출시 범위는 이 증거를 통과한 분야·기능만 허용한다. 현재 구현은 그 검증을 가능하게 하는 구조적 기반이며, 증거가 없는 기능을 출시 가능으로 승격시키지 않는다.

## 6. 상용화 구현 체크포인트 2 (260809 23:08 KST)

이번 체크포인트는 계획 문서만 추가한 것이 아니라 실제 사용자 경로를 연결하고, 각 단계 뒤에 회귀와 Closed Beta 무결성 비교를 수행한 결과다.

### 6.1 Closed Beta 보호 경계

- `closed-beta-integrity-snapshot.mjs`가 계정·비밀번호 해시뿐 아니라 문서 권한/잠금, 작업공간/멤버십, `data/private-storage` 저작물까지 포함한다.
- 기준선: `validation-reports/closed-beta-integrity-260809-commercial-v1-baseline.json`
- 현 체크포인트: `validation-reports/closed-beta-integrity-260809-commercial-v1-wp4.json`
- 비교 결과: 보호 테이블 17, 행 13, 파일 15, 15,429,420 bytes, 차이 0.

### 6.2 분야 선택에서 AI 생성까지의 실제 연결

- 분야/일반·전문가 상태를 공유 store로 통합해 Modeler Shell, AI context, 작업공간 링크가 같은 선택값을 본다.
- `/api/nexyfab/drawing/assemble`는 요청 분야를 명시적으로 받고 카탈로그를 해당 분야로 제한한다. 토목만 교량 템플릿을 함께 허용한다.
- AI 생성 및 교정 프롬프트에도 분야 제약을 유지하며, 다른 분야 템플릿이나 civil alignment로 조용히 바뀌면 결과를 거부한다.
- 승인된 assembly를 `UnifiedDesignProject`로 변환하고 안정적인 ID와 객체 ID를 부여한다. 객체 ID 누락/중복 시 fail-closed한다.

### 6.3 AI에서 수동 정밀 CAD로의 실제 연결

- 건축·토목·조경·인테리어 생성 결과가 SCAD 미리보기에서 끝나지 않고 의미 assembly, 부품 AABB, canonical project와 함께 수동 설계 작업공간으로 전달된다.
- 전달 데이터는 30분 만료, 1회 소비, 분야 일치 조건을 가진다.
- `designOk=true`, 게이트 0, 간섭 0, 부유 0, 누락 부품 0, canonical issue 0, 요구 불일치 0인 결과만 전달한다.
- 수동 작업공간은 간섭/부유 값을 임의로 0으로 만들지 않고 전달된 검증 증거와 intent-match 결과를 그대로 표시한다.
- 이후 pick/edit-part, 치수 변경, face push-pull, 이동/복제/삭제/fillet, 재검증, 패키지 생성 경로를 사용할 수 있다.

### 6.4 실제 형상 판정 조정

- `wall_with_openings`, `slab_with_openings`의 boolean 개구를 AABB 간섭기가 인식한다. 회전된 호스트도 로컬 좌표로 환산하고, 관통체 단면이 개구 안에 완전히 포함된 경우만 정상 관통으로 분류한다.
- 송전탑과 테이퍼 거더 교량은 역할/근접성으로 뭉뚱그려 면제하지 않고, 템플릿이 생성한 `connectedWith` 이름 쌍만 접합으로 분류한다.
- `connectedWith`는 `deterministic-template-v1` 출처가 붙은 접합 그래프에서만 효력이 있다. 자유형 AI/사용자 입력이 같은 필드를 써 넣어 충돌을 숨기는 경로는 차단한다.
- 송전탑은 패널 수·높이가 달라져도 같은 패널-기둥 거셋을 공유하는 부재만 명시적으로 연결한다.
- 선언을 지운 동일 형상은 다시 확정 간섭 및 `designOk=false`가 되어 fail-closed 동작을 유지한다.
- 기계 플랜지 피팅 회전 방향과 plant room 냉수 배관 길이도 실제 외향/면접촉 배치로 수정했다.

### 6.5 검증 증거

| 검증 | 결과 |
|---|---:|
| 분야별 결정론 템플릿 자체 검사 | **59/59 PASS** |
| 개구·접합·송전탑 집중 회귀 | **9/9 PASS** |
| AI 분야 요청·canonical·handoff·UI store | **18/18 PASS** |
| 관련 기계/건축 형상 회귀 | **120/120 PASS** |
| 신뢰 접합 그래프 보안 회귀 | **48/48 PASS** |
| API route 보안 | **16/16 PASS** |
| 실제 OCCT STEP 왕복 | **2/2 PASS** |
| CAD API 인증·권한·rate-limit·metering | **57/57 handlers, issue 0** |
| 전체 TypeScript (`--max-old-space-size=8192`) | **PASS** |
| 변경 파일 ESLint | **오류 0, 기존 경고 5** |
| 기존 AI·CAD 기준 감사 | **379/379 PASS** |
| Closed Beta 기준선 비교 | **차이 0** |

### 6.6 이 체크포인트의 정직한 상용화 판정

일반 사용자 AI 생성 → 검증된 분야 모델 → 필요 시 수동/전문가 정밀 CAD 진입의 코드 경로는 이제 실제로 연결됐다. 59개 제공 템플릿은 현재 기본 파라미터 자기검사에서 모두 조립 성립 판정을 받는다.

그러나 **전체 상용 출시 완료**는 아니다. 남은 핵심은 다음과 같다.

1. 외부 권리 확보·전문가 승인된 분야별 독립 holdout은 아직 0건이다. 내부 템플릿 통과를 외부 정확도 인증으로 세지 않는다.
2. 복잡 제품은 실제 권위 원본과의 부품/피처/조인트/공차/STEP 왕복 campaign이 필요하다.
3. 건축 IFC, 토목 LandXML/IFC, 조경·인테리어 schedule/drawing의 외부 도구 왕복과 의미 보존 증거가 필요하다.
4. 브라우저 장시간 작업, 대용량 모델, 저장 복구, 동시성, 장애 주입, 보안 운영 증거가 필요하다.
5. `CAD technical release audit v3`는 법정 문서가 아니라 내부 기술 출시 증거로 유지한다. 전문가 최종 검토를 대체하지 않으며, 승인되지 않은 기능을 출시 가능으로 표시하지 않는 역할이다.

따라서 현 상태는 **제한된 템플릿 기반 기술 파일럿에 가까워졌지만, 공개 상용 GA는 증거 부족으로 계속 BLOCKED**다.
