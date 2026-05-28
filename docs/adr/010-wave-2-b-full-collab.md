# 010 — Wave 2 = B-Full + collab via Claude max parallel solo

**Status:** accepted
**Date:** 2026-05-28
**Author:** dev
**Risk tier:** P0

## Context

Wave 1 (ADR-001 A안, W1-W17) 32 PR로 OCCT 커널 인프라 100% 완료, 자체 inspection 결과 기존 자산이 sketch constraint solver / multi-body / assembly mates / drawing까지 70-85% 수준임을 발견. 이전 "Wave 2-4 12-18개월" 추정이 잘못됐고, "B-Full 9-12개월" 도달 가능 영역으로 재평가.

User 결정 — **Onshape parity + collab 목표로 B-Full로 직진**. B-Parallel staged 접근 거부. 인력 채용 없이 Claude max parallel + user solo로 진행.

## Decision

Wave 2 (2026-06 ~ 2027-05, 12개월) = **상용 CAD + 실시간 collab**. 모든 결정 본 ADR로 공식화.

### Scope MUST

**Commercial CAD pillars** (Onshape parity):
- Wave 1 ship 마무리 (32 PR 머지 + Tier 0)
- Sheet metal (flange / bend / unfold / DXF flat pattern)
- Hole wizard (drilled / counterbore / countersink / tap, ISO+UTS)
- Threads (cosmetic + geometric basic, ISO M / UTS / Pipe)
- Reference geometry (construction plane / axis / origin)
- Configurations (parametric variants — 데이터 모델 이미 있음, UI 연결)
- Direct edit (push-pull face/edge)
- CAM 2.5D (pocket / contour / drill + Fanuc/Mazak/Haas post-processor)
- FEA UI 정식 (load/BC → mesh → result viz — useFEAWorker 활용)
- Drawing 인터랙티브 마무리 (GD&T picker, hidden line 토글, projection selector)
- Multi-body part (이미 100% 구현, verify)
- Assembly + mates (이미 100% 구현, verify)

**Collaboration pillars** (Onshape 차별점):
- CRDT real-time multi-user editing (Yjs + sketch + feature + assembly 다)
- Multi-cursor + presence avatars
- Document branching + merge ("git for CAD")
- Comments + annotations on geometry
- Workspace permissions (owner / editor / viewer)
- Activity feed
- Version history with restore

**Differentiator** (한국 시장):
- 한국어 first-class (이미 좋음)
- AI 코파일럿 (chat with RAG + auto-constraint inference UI + text-to-sketch basic)

### Scope OUT (Wave 2 명시 제외)

- Mobile / tablet UX → Year 2
- NURBS surface modeling → Year 2+
- FEA nonlinear / dynamics → Year 2
- CAM 3+ axis → Year 2
- Full text-to-3D AI → Year 2+ (hallucination risk)
- Plugin SDK → Year 2
- Native CAD format import (SLDPRT, IPT) — 라이선스 issue
- Standard parts library (베어링/볼트 카탈로그) — partner 검토

### Architecture decisions

**State 모델 — CRDT-first**:
- Sketch entities / constraints / dimensions → Yjs Map per sketch
- Feature tree → Yjs Array
- Body registry → Yjs Map
- Assembly tree → Yjs nested Map
- 모든 mutation = Yjs transaction
- Transport: Cloudflare Workers + Durable Objects (y-websocket)
- Persistence: y-indexeddb (offline) + Postgres metadata + R2 blob

이유: collab이 비-옵션이면 retrofit 비용 (4-6개월) > 초기 설계 비용 (1-2개월).

**Document 모델 — Cloud-first**:
- 모든 file → cloud (R2 + Postgres)
- 로컬 .nfab은 cache only
- 기존 local file model → cloud document 전환 (1-2개월)

**AI 모델 — 3 종류, 깊이 다름**:
1. Chat assistant (RAG, NexyFlow AI stack 활용) — 1개월
2. Auto-constraint inference (existing autoConstraintInference.ts) — UI 1주
3. Text-to-sketch basic ("50mm 원" 명령) — 2-3개월
4. Full text-to-3D — OUT

### Resource plan

- User: 풀타임 dedicated (다른 프로젝트 NexyFlow / 게임 / NexyWise 등 freeze)
- Claude: max parallel agent fan-out (4-6 agents 동시 spawn 패턴)
- 인력 채용: **0명**
- External advisor: CAD domain consultant 1명 (월 1-2회 미팅, $5-15K/년)
- 자금: $53-122K (12개월)

## Consequences

### Positive

- 인력 채용 + 온보딩 절차 (3-6개월) 생략 → 즉시 시작
- 자금 70% 절감 vs 1-hire path ($150-310K → $53-122K)
- User가 모든 결정 owner → vision 일관성
- Pivot 유연성 (no hire commitment)
- Wave 1에서 확립한 Claude-parallel 패턴 (32 PR / 10일) 검증됨

### Negative

- User 풀타임 12개월 dedicated 부담 — burn-out risk **매우 높음**
- 매일 4-6시간 review/integration time 필요
- CAD domain expertise 약함 (sheet metal bend math, GD&T 정확성, CAM 도메인)
- UX iteration 약함 (Claude 시각 결과 못 봄)
- CRDT 디버깅 painful 예상 (multi-tab race condition)
- Production debugging 100% user 부담
- Quality risk 높음 (review burden)

### Neutral

- 12개월 후 결과:
  - Green (MAU 100+, NPS > 30) → AI/Mobile B-Full 2 진입 + hire
  - Yellow (MAU 20-100) → vertical 좁힘 (laser cut / sheet metal vertical)
  - Red (MAU < 20) → pivot 또는 종료

## Alternatives considered

- **B-Parallel (1 contractor, 9-11개월, $60-130K)** — 채용 burden + contractor 누수 risk 부담. User가 자금 commit minimize 선호.
- **B-Full Aggressive (2-3 hire, 6-8개월, $250-450K)** — 자금 + 채용 채널 풀 작음. 한국 senior CAD dev 2-4개월 채용 buffer.
- **B-Parallel → B-Full staged** — 18-24개월 total. 시장 first-mover 늦음. User가 한 번에 가겠다고 결정.

## Rollout

매 Phase 끝에 review + 결정 포인트.

### Phase 1 — Foundation + CRDT spike (Month 1)
- [ ] Wave 1 32 PR 머지 + Railway worker provision + 외부 검증 시작
- [ ] CRDT architecture spike (sketch entities → Yjs Map prototype)
- [ ] Cloud document model migration 설계
- [ ] CAD domain advisor 섭외
- [ ] ADR-011 작성 (CRDT 구체 architecture)
- **Decision review** — CRDT 가능성 확정, Phase 2 진입

### Phase 2 — Multi-feature 병렬 폭주 (Month 2-3)
- [ ] Sheet metal, Hole wizard, Threads (cosmetic), Reference geometry — agent fan-out
- [ ] Drawing 인터랙티브 마무리
- [ ] Configurations 실 연결
- [ ] STEP healing 외부 fixture 30+ 실측
- **Deliverable**: Internal beta — invitation-only

### Phase 3 — CRDT collab + Direct edit (Month 4-6)
- [ ] CRDT 전체 적용 (sketch + feature + body + assembly)
- [ ] Multi-cursor + presence
- [ ] Document branching + merge
- [ ] Permission system
- [ ] Direct edit (push-pull)
- [ ] Topology naming smoke 100+ 시나리오
- **Decision review** — collab UX 검증, Phase 4 진입

### Phase 4 — Pro features + AI (Month 7-9)
- [ ] CAM 2.5D
- [ ] FEA UI 정식
- [ ] Comments + annotations
- [ ] Activity feed
- [ ] Threads (geometric)
- [ ] AI 코파일럿 (chat + auto-constraint UI + text-to-sketch basic)
- **Deliverable**: External beta open (50-100 users)

### Phase 5 — Polish + launch (Month 10-12)
- [ ] Bug bash from external beta
- [ ] Performance hardening (Onshape 대비 benchmark)
- [ ] Documentation + marketing site
- [ ] Pricing model
- [ ] Public launch
- **Decision review** — go/no-go for Year 2 (Mobile + advanced AI + NURBS)

## Reversal

Phase 1-3 fail 시 (각 review에서 결정):

- **Phase 1 fail**: CRDT 통합 6주 → 4개월 over → retrofit pivot. 출시 일정 2-3개월 추가.
- **Phase 2 fail**: Multi-feature quality drop → scope cut (Threads / CAM 보류). Phase 3-5 가속.
- **Phase 3 fail**: CRDT 디버깅 painful → contractor 1명 영입 (자금 +$60-130K).

**최악 시 reversal**: Year 1 끝에 ship 못 하면 vertical pivot — 한국 가공 marketplace 특화 CAD (sheet metal + laser cut only). 6개월 추가로 그 vertical에서 ship.

## References

- Code: 모든 wave-2/* branches 이 ADR을 base로 함
- Docs: [Wave 1 architecture](../wave-1-architecture.md), [ADR-001 marketplace freeze](./001-marketplace-freeze.md), [ADR-007 OCCT worker](./007-occt-worker-on-railway.md), [ADR-009 Wave 1 GA gate](./009-wave-1-ga-gate.md)
- Memory: [Wave 1 코드 완성](../../memory/project_nexyfab_wave1_complete.md)
- 이 결정의 대화 turn: 2026-05-28
