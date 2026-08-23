# NexyFab 프로젝트 전체 점검 보고서

- 점검일: 2026-08-23
- 기준 커밋: `ad1c6a66` (`integration/nexyfab`)
- 범위: Git 객체/백업, worktree, 구조·소유권, 타입·린트·보안, 3개 scope

## 결론

손상된 Git 객체나 worktree 파일 손실은 확인되지 않았다. 통합 worktree와 3개 scope worktree가 모두 동일 커밋이며 clean 상태다. `git fsck`에는 과거 작업에서 남은 dangling commit/blob/tree가 다수 표시되지만 fatal 오류가 아니며, 전체 refs bundle과 보존 패키지에 보호되어 있으므로 지금 prune하지 않는다.

## 검증 결과

| 항목 | 결과 |
|---|---|
| `git fsck --full --no-progress` | PASS, fatal corruption 없음 (dangling objects는 보존) |
| 전체 refs bundle verify | PASS, complete history |
| worktree integration status | PASS, 3 scopes dirty=0/behind=0 |
| workspace audit | PASS, tracked 9,636 / shared 105 / collisions 0 / descriptor issues 0 |
| architecture check | PASS, services 11 / datastores 5 / API groups 69 / cron groups 26 |
| `npm run typecheck` | PASS |
| `npm run lint:ci` | PASS (대형 ShapeGenerator 파일 Babel deopt 안내만 있음) |
| secret scan | findings 0; 단, 기존 evidence가 stale하여 종료코드 1 |
| AI common accuracy | PASS (Vitest 60 tests + Node 7 tests, 최근 실행 기록) |

## 보존 및 정리 상태

- 사전 백업: `nexyfab-pre-scope-backup-20260823-001`
- 정리 보존 패키지: `nexyfab-cleanup-20260823-001`
- 최종 bundle: `git/nexyfab-all-refs-final.bundle`
- 이전 dirty Claude worktree의 1개 파일은 checkpoint와 원본 보존본으로 유지
- runtime `data` 175개 파일과 `.next` 캐시는 삭제하지 않고 보존 패키지로 이동
- 정리 기준은 [CLEANUP_POLICY.md](./CLEANUP_POLICY.md)에 고정

## 남은 위험과 다음 조치

1. 보안 스캔 evidence를 현재 커밋 기준으로 재생성하고 CI에서 stale 상태를 실패 처리할지 결정한다.
2. Precision CAD의 외부 release evidence(`mechanical:contracts:check`, `mechanical:scope:check`)를 갱신하기 전에는 release readiness를 BLOCKED로 유지한다.
3. `apps/*`와 `capabilities/*`는 호환성 경계/메타데이터 단계다. 각 scope에서 대표 기능 한 조각을 새 경계로 이동하고 계약·회귀 테스트를 추가한다.
4. 실제 배포·외부 서비스·E2E는 이번 로컬 점검에 포함하지 않았으므로 production-ready로 간주하지 않는다.

## 재현 명령

```powershell
npm run workspace:integration-status
npm run workspace:audit
npm run platform:architecture:check
npm run typecheck
npm run lint:ci
npm run security:secrets:check
```
