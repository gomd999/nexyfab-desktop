# M7 — 대형 어셈블리·스케일 정책 (요약)

**상위 로드맵:** [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) §M7.

**연관 문서:** [M7_PERFORMANCE_BUDGETS.md](./M7_PERFORMANCE_BUDGETS.md) (프레임·간섭 목표 초안), [M7_SECURITY_ENTERPRISE.md](./M7_SECURITY_ENTERPRISE.md) (보안 체크리스트).

M7은 **느리지만 쓸 수 있는** 대규모 어셈블리를 목표로, 뷰포트·간섭·LOD에 대한 **수치 정책을 한 모듈**에 모아 UI와 워커가 같은 기준을 쓰게 한다.

## 자동 게이트

- `npm run m7` — `scripts/m7-assembly-scale.mjs`: 타입체크 + `src/test/m7/*.test.ts`.  
- `npm run verify`에 M5 다음 단계로 포함(`verify-milestones.mjs`).

## 정책 모듈

`src/lib/assemblyLoadPolicy.ts`

| 구분 | 내용 |
|------|------|
| **뷰포트 부하(파트 수 n)** | `ASSEMBLY_VIEW_THRESHOLDS` — light 12 / warn 24 / heavy 48 / extreme 96. `assemblyViewportLoadBand` 5단계, 호환용 `assemblyViewportLoadTier` 3단계. |
| **간섭 쌍 수** | `assemblyPairwiseComparisonCount`, `ASSEMBLY_INTERFERENCE_THRESHOLDS`, `interferenceWorkloadBand`. |
| **Broad-phase 전환** | `INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT` (=18) — `InterferenceDetection`과 동일 기준(테스트에서 고정). |
| **가이드 문구** | `getAssemblyLoadGuidance`, `recommendedMaxTriPairsForPartCount` 등 UI·토스트용. |

## UI 연동 (현재)

- 뷰포트/스튜디오: `ShapePreview` 등에서 배지·LOD 힌트.  
- 어셈블리: `AssemblyPanel` 간섭 실행 전 안내 토스트.  
- 구현 세부는 컴포넌트 주석·`assemblyLoadPolicy` 호출부를 따른다.

## 수동 완료 정의 (로드맵)

- 목표 **부품 수·삼각형 수**에 대한 성능 예산(프레임 타임, 간섭 타임아웃)은 제품별 수치로 정의 후 벤치마크.  
- 보안 체크리스트(SSO·레지던시 등)는 엔터프라이즈 트랙 별도 문서.
