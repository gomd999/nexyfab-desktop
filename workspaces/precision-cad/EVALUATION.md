# Precision CAD scope 평가

## 현재 상태

- 평가: **구조 정리 완료 / 제품화 증거 부족**
- 담당 경계: CAD API·agent·IR/OCCT·solver·mechanical domains
- 일반 검증: typecheck PASS, architecture check PASS
- capability descriptor는 `LEGACY_COMPATIBILITY`; target capability 폴더는 경계/문서 중심이고 legacy source가 아직 authoritative다.
- release gates `mechanical:contracts:check`, `mechanical:scope:check`는 외부 evidence가 stale/pending하여 BLOCKED다.
- 첫 vertical slice: single-part candidate 계약을 `capabilities/precision-cad/single-part-candidate` adapter로 분리함

## 강점

- mechanical/architecture/civil 등 domain descriptor와 CAD 관련 소유 경계가 분리되어 있다.
- 계약 패키지와 architecture validator로 cross-scope import를 통제할 수 있다.

## 개선 우선순위

1. shape-generator 또는 CAD job orchestration 중 하나를 선택해 adapter·contract·worker까지 연결한 첫 vertical slice를 만든다.
2. CAD IR/STEP/B-rep 변환의 golden fixture와 contract test를 추가한다.
3. 30-feature, STEP C4, blind review, pilot 등 release evidence를 현재 커밋 기준으로 재생성한다.
4. 대형 legacy route를 기능 단위로 쪼개고 scope worktree에서 변경 단위를 작게 유지한다.
