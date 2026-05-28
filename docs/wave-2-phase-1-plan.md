# Wave 2 Phase 1 — Foundation + CRDT spike (Month 1)

ADR-010 §Phase 1 detailed plan. **Week-by-week deliverables**, agent
fan-out 패턴 명시, user time 추정 (40hr/주 가정).

## Week 1 (2026-05-29 ~ 06-04): Wave 1 머지 + Phase 1 kickoff

### User work (직렬, ~20시간)
- [ ] 32 PR 순차 admin override 머지 (wave-1-ga-checklist.md 순서)
- [ ] Railway worker provision 시작 (Task #31)
- [ ] NEXT_PUBLIC_OCCT_WORKER_URL set + main app 재배포 (Task #32)
- [ ] 외부 SW/Fusion 엔지니어 1명 contact 시작 (Task #28)

### Agent parallel work (Claude, ~20시간 user review time)
**Spawn 동시**:
- Agent A1: `npm run soak -- --duration=14400` 실행 가이드 + 모니터링 스크립트
- Agent A2: 20-fixture × 5-viewer 매트릭스 fixture 준비 (test 시나리오 docs)
- Agent A3: CRDT prototype scoping — sketch entities Yjs Map 구조 spec
- Agent A4: CAD domain advisor JD 작성 (월 1-2회 미팅 consultant)

### Deliverable
- Wave 1 GA gate #1 (Railway live) 통과
- CRDT prototype 설계서 (Agent A3 결과)
- Advisor 후보 1-3명 contact 시작

## Week 2 (06-05 ~ 06-11): CRDT prototype + 외부 검증 시작

### User work (직렬, ~25시간)
- [ ] CRDT prototype review (Agent 결과)
- [ ] 첫 advisor 인터뷰 1-2회
- [ ] 20-fixture 매트릭스 5/20 실측 직접 (사용자 손)
- [ ] Sentry alert rule 6개 Sentry project에 설정

### Agent parallel
**Spawn 동시**:
- Agent B1: Sketch entities Yjs Map 변환 prototype (실 코드, branch wave-2/crdt-sketch-spike)
- Agent B2: Feature tree Yjs Array prototype
- Agent B3: y-websocket transport scaffold (Cloudflare Worker + Durable Object)
- Agent B4: y-indexeddb offline persistence scaffold
- Agent B5: Document model migration plan (.nfab → cloud document)

### Deliverable
- CRDT spike branch (wave-2/crdt-sketch-spike) — 첫 prototype 실행
- Multi-tab sketch editing 동작 verify
- Sentry instrumentation 활성

## Week 3 (06-12 ~ 06-18): CRDT 확정 + Phase 2 spec

### User work (직렬, ~25시간)
- [ ] CRDT prototype 결과 평가
  - 성공 → Phase 2 spec 작성 진행
  - 실패 → ADR-011 reversal: retrofit 검토
- [ ] Advisor 1명 결정 + 첫 미팅 (CAD 도메인 깊은 이해 + AI agent 관련)
- [ ] 외부 SW/Fusion 엔지니어 2-3명 확정

### Agent parallel
**Spawn 동시 (Phase 2 spec)**:
- Agent C1: Sheet metal API spec (flange / bend / unfold worker handlers)
- Agent C2: Hole wizard ISO/UTS 라이브러리 + UI mockup
- Agent C3: Threads spec (cosmetic + geometric, helix sweep)
- Agent C4: Reference geometry API spec (plane / axis 시스템)
- Agent C5: Configurations data model verify + UI 연결 plan

### Deliverable
- ADR-011 작성 ("CRDT architecture 확정")
- Phase 2 4 feature spec docs (5개 agent 결과)
- Advisor 결정

## Week 4 (06-19 ~ 06-25): Phase 1 마무리 + Phase 2 kickoff

### User work (직렬, ~20시간)
- [ ] ADR-011 review + finalize
- [ ] Phase 2 spec docs review + scope confirm
- [ ] 20-fixture 매트릭스 15/20 실측 완료
- [ ] **Decision review** (ADR-010 §Phase 1):
  - CRDT prototype 작동? → Phase 2 진입
  - 작동 안 함 → reversal plan (1-2개월 추가)

### Agent parallel
**Spawn 동시**:
- Agent D1: Cloud document migration 시작 (백엔드 endpoint)
- Agent D2: Workspace/permission data model
- Agent D3: First Sheet metal handler — replicad `extrude(profile).shell(thickness)` based
- Agent D4: Phase 2 task tracker setup

### Deliverable
- **Phase 1 review meeting** (user + advisor)
- Phase 2 정식 시작 결정
- Sheet metal first handler 동작

## Week 4 끝 → Phase 1 review checkpoint

### Green signal (Phase 2 진입)
- ✅ Wave 1 GA gate #1, #2 통과
- ✅ CRDT prototype: multi-tab sketch editing 동작
- ✅ External engineer 1명 commit + 첫 feedback
- ✅ Advisor 1명 retain
- ✅ User burn-out signal 없음 (수면 / 스트레스 / 휴식 가능)

→ **Phase 2 시작**

### Yellow signal (scope 조정)
- ⚠️ CRDT 부분 작동 (1-2개 entity만)
- ⚠️ External validation 느림
- ⚠️ User 부담 60hr/주 hint

→ **scope cut 검토**:
- Mobile/AI 같은 후반 feature 조기 cut 선언
- 또는 Phase 2 4 feature 중 1-2 cut

### Red signal (Pivot)
- ❌ CRDT 불가능 (architecture incompatible)
- ❌ User 본인 burn-out 신호
- ❌ Wave 1 ship 자체 차단

→ **Pivot 결정**:
- ADR-010 amend or retire
- Plan B: B-Parallel 1 contractor 영입 ($60-130K)
- Plan C: vertical pivot (sheet metal only)

## User time budget (Phase 1 전체)

| Week | User time (시간) | Agent review burden |
|---|---|---|
| 1 | 20 | 매일 4-6 PR/spec review |
| 2 | 25 | 매일 6-8 PR review + CRDT spike |
| 3 | 25 | spec docs + advisor coordination |
| 4 | 20 | review meeting + decision |
| **합계** | **90시간** (~월 22시간/주) | — |

40hr/주 풀타임 기준 절반 사용. 나머지 시간은:
- 외부 검증 (advisor + engineer)
- 머지 + Railway + Sentry 인프라
- 휴식 (의도적 break)

## Burn-out 방지 rules (Phase 1 동안 준수)

1. **매주 일요일 휴식** — 코드 review / agent spawn 금지
2. **매일 22:00 cut-off** — 새벽 코딩 금지
3. **Week 4 끝에 1-2일 의도적 break**
4. **회의는 오전만** — 오후는 deep work 보존
5. **burn-out 신호 (수면 < 6시간 3일 연속, 짜증 증가, 회피 행동)** 발생 시 즉시 1주 scope freeze

## Phase 1 비용 추정

| 항목 | 비용 |
|---|---|
| Claude API (heavy use) | $200-500 |
| Railway + Cloudflare infra | $100-200 |
| Sentry pro plan (alerts) | $30 |
| Advisor 첫 미팅 (1회) | $500-1500 |
| 외부 engineer 검증 (1주) | $500-2000 |
| **합계** | **$1,330-4,230** (~$2K avg) |

## Phase 2 미리보기 (Month 2-3 spec 작성 이번 phase에서)

다음 phase 시작 시 즉시 fan-out:

```
PARALLEL (Phase 2 Month 2):
  Agent A: Sheet metal worker + wrapper + UI + tests
  Agent B: Hole wizard handlers + ISO/UTS lib + UI
  Agent C: Threads cosmetic + helix sweep
  Agent D: Reference geometry plane/axis API
  Agent E: Configurations 실 연결
  Agent F: Drawing 인터랙티브 마무리

USER (직렬):
  매일 6-8 PR review + 통합 + browser verify
  외부 beta 사용자 모집 (50명 target)
```

이 plan은 Phase 1 끝 시점에 ADR-012 ("Phase 2 detailed plan")로 정식화.

## 첫 액션 (지금 즉시)

1. **이 ADR + Phase 1 plan을 commit + PR open**
2. **다음 conversation turn에서**:
   - Wave 1 32 PR 머지 시작 (user)
   - 또는 Phase 1 Week 1 Agent fan-out 시작 (Claude)
   - 어느 쪽 먼저 할지 user 결정
