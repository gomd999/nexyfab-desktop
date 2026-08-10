# NexyFab 기술 출시 구현·검증 리뷰 (260809)

## 1. 결론

결제와 법무를 제외한 기술 구현은 이번 작업 범위에서 완료했다. 목표 구조는 다음과 같다.

- 일반 사용자: AI가 복잡 제품을 부품 분해, 형상 생성, 조립, 동작, 제조 검증까지 진행한다.
- 전문가: AI 결과를 그대로 검토하거나 필요할 때만 내장 정밀 CAD 편집으로 진입한다.
- 수동 설계: AI 설계 중에도 선택 부품과 영향 범위를 직접 수정할 수 있다.
- 외부 CAD: SOLIDWORKS 등 별도 CAD 설치나 라이선스를 필수 조건으로 두지 않는다.
- 제조 승인: 실제 커널 결과와 추적 가능한 증거가 없으면 통과시키지 않는다.

프로덕션 빌드와 정적 검증은 통과했지만, 현재 상태를 곧바로 공개 상용 출시 승인으로 해석하면 안 된다. 독립 홀드아웃 캠페인, 운영 Redis, 실환경 카나리 및 복구 훈련 증거가 아직 입력되지 않았기 때문에 기술 출시 게이트는 의도대로 `BLOCKED` 상태다. 현재 허용 가능한 최고 단계는 증거를 수집하는 제한적 기술 파일럿이다.

결제와 법무 검토·구현은 사용자 결정에 따라 이번 범위에서 제외했다.

## 2. 점검 → 구현 → 검증 결과

### 2.1 Closed Beta 보호

- 작업 전 스냅샷: `validation-reports/closed-beta-integrity-260809-technical-launch-pre.json`
- 작업 후 스냅샷: `validation-reports/closed-beta-integrity-260809-technical-launch-final.json`
- 읽기 전용 데이터베이스 경로 해시: 동일
- 보호 테이블: 17개 → 17개
- 보호 행: 13행 → 13행
- 보호 저작물: 15개 → 15개
- 보호 저작물 총크기: 15,429,420 bytes → 15,429,420 bytes
- 생성 시각을 제외한 전체 스냅샷 JSON: 완전 동일
- 각 테이블 내용 SHA-256, 파일 경로 SHA-256, 파일 내용 SHA-256: 모두 동일

따라서 기존 Closed Beta 계정, 비밀번호 관련 레코드, 프로젝트·주문·감사 데이터와 업로드 저작물은 훼손되지 않았다.

### 2.2 서버 소유 AI 생성 상태

- 브라우저가 생성 단계 통과 기록을 직접 쓰지 못하게 했다.
- 인증 사용자 또는 제한된 게스트 소유자를 서버가 결정한다.
- 실행 소유권, 실행 ID, revision을 검증하고 충돌 시 거부한다.
- 운영 환경은 Redis CAS와 TTL을 사용하고, 메모리 저장은 개발·테스트에만 허용한다.
- refine, advance, finalize가 서버의 권위 상태를 읽고 갱신한다.

주요 구현: `src/lib/ai/generationStateStore.ts`, `src/lib/ai/generationRequestOwner.ts`, `src/app/api/cad/v1/generation/*`

### 2.3 복잡 제품 정확도와 추적성

- 제품 요구사항, 재사용 가능한 부품 정의, 인스턴스, mate, 하위조립을 깊은 런타임 스키마로 검증한다.
- 모든 형상 숫자 파라미터는 안정된 경로, 값, 단위, 허용오차, 출처, 유도 근거와 잠금 상태를 요구한다.
- 구매품 카탈로그는 ID, revision, 아티팩트 SHA-256을 요구한다.
- FeatureTree 13종 payload를 서버 안전 검증기로 확인하며 React·브라우저 저장 모듈이 서버 번들에 들어가지 않는다.
- 숨은 가정, 미확정 제조 조건, 끊어진 occurrence, 잘못된 quaternion, 근거가 사라진 수치는 형상 승격을 막는다.

주요 구현: `src/lib/ai/productDecompositionSchema.ts`, `src/lib/cad/featureTreeValidation.ts`, `src/lib/ai/productDecompositionAccuracy.ts`

### 2.4 계층형 생성과 국소 복구

- 독립 부품을 생성하고 통과 아티팩트를 checkpoint로 잠근다.
- 실패 부품과 영향받은 하위조립만 다시 생성한다.
- 잠긴 파라미터 변경을 차단한다.
- 하위조립부터 상위조립 순서로 mate를 해결한다.
- 인터페이스 실패는 조용히 추정하지 않고 전문가 검토로 보낸다.

주요 구현: `src/lib/ai/hierarchicalProductGeneration.ts`

### 2.5 실제 복잡 제품 캠페인

- 미리 채워진 성공 결과를 받는 방식 대신 실제 `generateComplexProduct`와 `evaluateComplexAssertion` 어댑터를 요구한다.
- 생성 산출물 해시와 평가자 영수증을 승인된 소스 증거에 묶는다.
- 독립 홀드아웃과 capability별 최소 표본 수를 기술 출시 감사에서 강제한다.

주요 구현: `src/lib/ai/complexCampaignExecutor.ts`, `scripts/run-complex-ai-campaign.ts`

### 2.6 정밀 CAD, 조립, 동작 및 STEP

- 정밀 CAD는 별도 제품이 아니라 AI가 자동 진입할 수 있는 내장 엔진이며 전문가 직접 편집은 선택 사항이다.
- 동작 최종화는 서버 측 animation 검증과 joint evidence를 함께 요구한다.
- 개념 전용 로봇은 진단할 수 있지만 생산 승격은 되지 않는다.
- STEP XCAF 출력의 미정의 `main` 참조를 수정했다.
- 실제 STEP 검증에서 평면 부품 나열이 아닌 조립 트리, 30개 occurrence, 반복 부품 PRODUCT 재사용, 위치 왕복, AP242, 색상, 한글 계통명 인코딩을 확인했다.

주요 구현: `src/app/api/cad/v1/generation/finalize/route.ts`, `scripts/drawing-to-3d/to-step.mjs`

### 2.7 UI/UX

- AI 구현, 내장 정밀 CAD, 정확성 검증, 릴리스 증거를 한 흐름으로 표시한다.
- 현재 상태, 영향 부품, reason code와 국소 복구 범위를 노출한다.
- 기술 검증과 상용 출시 승인을 명확히 분리한다.
- 외부 CAD 설치가 필요 없음을 표시한다.
- 한국어, 영어, 일본어, 중국어, 스페인어, 아랍어를 모두 제공한다.

주요 구현: `src/app/[lang]/shape-generator/_shell/CadWorkflowRail.tsx`

### 2.8 카나리와 롤백

- 트래픽 단계: 1% → 10% → 50% → 100%
- 승격 조건: 단계당 연속 3개 안정 구간, 최소 100요청, 오류율 1% 이하, p95 30초 이하, p99 60초 이하, 정확도 95% 이상
- 즉시 롤백: false-verified 결과, stub 커널, 보안 위반, Closed Beta 무결성 변화

주요 구현: `src/lib/technicalCanaryPolicy.ts`, `scripts/evaluate-technical-canary.ts`

## 3. 검증 기록

- 프로덕션 빌드: 성공
  - webpack 최적화 컴파일 성공
  - TypeScript 성공
  - 정적 페이지 634개 생성 성공
  - 번들 예산 성공: shared/worst first-paint 691.9 KB, 예산 763.3 KB
- 최종 전체 TypeScript 검사: 8GB 힙에서 성공
- ESLint 전체 `src --quiet`: 성공
- AI 제품 분해 변경부: 9/9 성공
- STEP 조립 트리 + 6개 언어 회귀: 20/20 성공
- Node 전용 테스트: 최초 225/226 성공, 커널 식별 갱신 후 실패 테스트 2/2 성공
- 전체 Vitest: 최초 발견된 실패 6건을 모두 원인 수정하고 관련 20개 테스트로 재검증
- 커널 식별: 현재 package-lock, WASM 3개, 로더/정책 파일에 맞는 SHA-256으로 갱신 후 통과
- Closed Beta 작업 전/후 무결성: 완전 동일

검증 환경에서 Vitest와 Next.js가 자식 프로세스를 만들 때 Windows 샌드박스의 `spawn EPERM`이 발생했다. 권한 허용 상태에서 같은 명령을 다시 실행해 코드 실패와 환경 차단을 분리했다. 타입 검사 단독 실행은 기본 4GB Node 힙에서 메모리 한도에 도달했지만, 8GB로 재실행한 최종 전체 검사와 프로덕션 빌드의 TypeScript 단계는 모두 성공했다.

## 4. 현재 출시 판정

`npm run technical:release-gate` 결과:

```text
[technical-release] BLOCKED
- audit.missing: CAD technical release audit v3 is required
```

이는 올바른 결과다. 실제 운영 증거 없이 출시 승인을 만들어 내지 않는다.

기술 파일럿을 넘어 출시하려면 다음 실제 증거가 필요하다.

1. 운영 `REDIS_URL`을 설정해 다중 인스턴스 상태·rate limit을 지속 저장한다.
2. 독립 홀드아웃에서 capability별 최소 표본과 95% 이상 기준을 충족한 실제 캠페인 결과를 제출한다.
3. 실환경 1/10/50/100% 카나리 구간의 오류율, 지연, 정확도와 롤백 기록을 제출한다.
4. 백업 복원, 배포 롤백, 모니터링 경보, 성능 부하 시험의 실제 실행 영수증을 제출한다.
5. 그 증거로 CAD technical release audit v3를 생성한 뒤 게이트를 다시 실행한다.

결제와 법무는 위 기술 증거와 별도로 추후 진행한다.

## 5. 최종 평가

코드 구조는 “AI로 복잡 제품을 실제 구현하고, 필요한 범위만 정밀 CAD로 처리하며, 전문가는 선택적으로 깊게 편집한다”는 목표에 맞게 정리됐다. 외부 CAD 설치는 제품 사용 조건이 아니다. 다만 복잡 제품의 보편적 정확성은 코드 존재만으로 보장할 수 없으므로, 실제 독립 데이터와 운영 카나리 증거가 확보될 때까지 제조 승인과 공개 상용 출시는 차단 상태를 유지해야 한다.
