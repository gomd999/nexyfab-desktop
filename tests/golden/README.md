# Golden files (M0 baseline)

회귀·수동 검증용 **최소 NexyFab 프로젝트** 샘플입니다.

| 파일 | 용도 |
|------|------|
| `m0-minimal.nfab.json` | 단일 박스 파트, 빈 스케치 — `parseProject()` 회귀 테스트에서 사용 |

## 수동 확인

1. Shape Generator에서 **Load scene** / 파일 열기로 이 JSON을 선택 (확장자 `.nfab`로 복사해 열어도 됨).
2. 뷰포트에 박스가 보이고, 오류 토스트가 없으면 통과로 간주.
3. **Save** 후 다시 열어 동일 상태인지 확인 (M0 스모크).

## CI

`npm run m0` → 타입체크 + `vitest` 골든 파싱 테스트.

교환 + 클라우드 저장 기준은 **`npm run m1`**, [M1_EXCHANGE.md](../../docs/strategy/M1_EXCHANGE.md), [M1_RELEASE_CHECKLIST.md](../../docs/strategy/M1_RELEASE_CHECKLIST.md) 참고.
