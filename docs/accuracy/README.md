# Domain accuracy working area (NOT certification evidence)

`candidates/` — 도메인별 40건, `accuracy:domain-candidates`로 생성한 내부 템플릿 파라미터 스윕.
`review-packets/` — 위 후보의 검토 패킷 (`accuracy:domain-review-packets`).

## ⚠️ 이 후보들은 95% 인증 홀드아웃이 될 수 없다 (설계상)

리뷰 패킷 게이트가 `sourceKind: internal-template`를 **의도적으로 거부**한다
(`independent_holdout_source_required`) — 자기 템플릿 생성기로 만든 형상을
자기 시스템의 정확도 증거로 쓰는 순환을 막는 fail-closed 무결성 장치다.
또한 ground truth assertion은 아티팩트에서 자동 유도하지 않는다
(`tolerances_are_domain-appropriate_and_not_result-fitted` 체크리스트 위반).

이 디렉터리의 용도:
1. **파이프라인 드라이런** — candidates→packets→(가상 승인)→campaign→report 도구 체인 검증
2. **리뷰어 캘리브레이션** — 실제 독립 홀드아웃 검토 전 연습 자료
3. 템플릿 회귀 감시 — 후보 40/40 clean 생성 자체가 어셈블리 엔진 스모크

## 인증 가능한 홀드아웃의 조건 (owner 조달 필요 — 👤)

- 독립 소스(우리 템플릿/프롬프트와 무관한 실무 도면·모델)
- `sourceRights.benchmarkingAllowed` — 벤치마크 사용 권리 확보
- 도메인 필수 축 전부에 대해 **리뷰어가 저작한** ground truth assertion
- 독립 리뷰어 2인 승인(`nexyfab.domain-accuracy-approval.v1`)

정본 계획: `docs/strategy/domain-accuracy-95-plan-260808.md`
