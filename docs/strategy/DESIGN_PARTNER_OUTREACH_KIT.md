# Design Partner Outreach Kit — NexyFab AI-CAD Beta

**Status:** Path A.5 (parallel with B.lite sketch editor build).
**Goal:** 5 active design partners using NexyFab for ≥ 2 weeks, generating real-world feedback to inform the next coding cycle.
**Timeline:** 6-8 weeks total (outreach → onboard → use → synthesis).
**Owner:** Founder (gomd9). Coding work continues in parallel via the B.lite track.

This kit exists because the codebase passes 45 editing/ tests, ships 10-layer AI verify chain, has 6-phase commercial CAD direct-edit, image-to-intent, reverse engineering, and quoting — but **zero real users**. Per the project's `feedback_landing_no_mock` rule, that's a launch blocker. This kit closes it.

---

## Positioning (lock first, outreach after)

**One-liner (KR):**
> AI가 만들고, 사용자가 검증하고, 가공 견적까지 한 번에 — 메이커/소형 제조사용 차세대 CAD.

**One-liner (EN):**
> The AI-first CAD for makers and small shops: describe your part in plain English, get verified geometry + a shop-ready drawing + an instant quote in one flow.

**Anti-positioning (NEVER claim):**
- "SolidWorks 대체" / "Fusion 360 replacement" → 즉시 신뢰 잃음 (sketch editor + parametric depth 부족).
- "프로 엔지니어 풀 워크플로" → partner 첫 사용 30분 안에 차이 체감.
- "Best CAD for everything" → category-vague가 가장 큰 적.

**True position:**
- "Verified-AI CAD" — 10-layer self-check chain은 어느 CAD AI도 미달성. 이게 진짜 차별점.
- "Maker → Quote in one tab" — image / NL / mesh → intent → 검증 → 도면 → 견적.
- "Honest about its scope" — sketch editor 없음을 인정. 단순 부품 + 어셈블리에 강함.

---

## Target Persona (5 prospects 찾기)

가장 ROI 높은 segment 순:

### Tier 1 — 기존 SCAD 사용자 (가장 자연스러운 fit)
- **메이커/취미인** OpenSCAD 사용자. Reddit r/openscad, 한국 메이커 페이스북 그룹, 3D printing forums.
- **이유**: 우리 도구가 OpenSCAD 위에 만들어졌고, 그들은 이미 NL→CAD를 갈망함.
- **목표:** 2명.

### Tier 2 — 소형 가공 shop (실제 견적 흐름 가치)
- 한국 1-5인 가공 shop, 시제품 위주.
- **이유:** Cost panel + BOM + quote adapter가 직접 매출에 도움.
- **채널:** 카카오 비즈니스 메이커 그룹, 분당/구로 가공단지 직접 방문.
- **목표:** 2명.

### Tier 3 — Mechanical engineer in startup
- 5-30인 하드웨어 스타트업 (드론, 가전, 의료기기 등).
- **이유:** AI verify가 design review 시간 단축. Image-to-intent로 sketch 빠르게 시작.
- **채널:** 스타트업 슬랙 그룹, 디스코드 (Inflearn / 디스콰이엇), LinkedIn 1:1.
- **목표:** 1명.

**Total: 5명. Tier 비중은 가변 — 1주차 outreach 응답률 보고 조정.**

---

## Outreach Email Templates

### Template A — Cold (Maker / OpenSCAD user, KR)

> **제목:** OpenSCAD 기반 AI CAD 베타 테스터 5명 모집 (무료 Pro 계정)
>
> 안녕하세요,
>
> NexyFab 만든 [Name]입니다. OpenSCAD 위에 만들어진 AI CAD 도구의 베타 테스터 5명을 찾고 있어요.
>
> 무엇을 만들었나요:
> - 자연어로 부품 묘사 → AI가 OpenSCAD 코드 + 3D 모델 생성
> - 10단계 자동 검증 (치수/구멍 개수/벽 두께 등 — 어떤 CAD AI도 안 함)
> - 도면 자동 생성 + 견적 자동 계산
> - 사진/스케치 업로드 → CAD intent 추출
>
> 베타 테스터에게 드리는 것:
> - 무료 Pro 계정 (정식 출시 후 6개월)
> - 1:1 슬랙 채널로 즉답
> - 만드신 기능 우선순위 반영
>
> 부탁드리는 것:
> - 2주간 실제 부품 1-2개 분석 (시간은 자유롭게)
> - 30분 데모 통화 1회 + 짧은 피드백 (서면 OK)
>
> 관심 있으시면 회신 부탁드립니다. 데모 영상 보고 결정하셔도 좋아요.
>
> [데모 영상 링크]
> [Calendly 또는 카카오톡 ID]
>
> 감사합니다,
> [Name]
> NexyFab (nexyfab@nexysys.com)

### Template B — Cold (Small shop, KR)

> **제목:** [Shop 이름]님께 — AI CAD 베타 (시제품 견적 자동화 도구)
>
> 안녕하세요 [성함] 사장님,
>
> 소형 가공 shop을 위한 AI CAD 도구 NexyFab을 만들고 있어요. 베타 테스터 5명 중 한 분으로 모시고 싶어 연락드립니다.
>
> 사장님께 직접 도움될 만한 것:
> - 고객 RFQ → CAD intent → 견적 자동 산출 (재료비 + 가공비 + 셋업)
> - 도면 자동 생성 (3-view + 치수 + GD&T 자동 제안)
> - 10단계 검증 (벽 두께가 가공 가능한지, 공차가 합리적인지 등)
>
> 부탁:
> - 실제 RFQ 1-2건을 도구로 견적 돌려보기 (시간 자유)
> - 30분 통화 한 번 + 짧은 피드백
>
> 드리는 것:
> - 정식 출시 후 6개월 무료 Pro 계정
> - 도구 개발 방향에 우선 반영
>
> 부담 없이 답장 부탁드립니다.
>
> [Name]
> nexyfab@nexysys.com

### Template C — Warm intro / referral (EN)

> **Subject:** Quick favor — looking for 5 design partners for AI CAD beta
>
> Hi [Name],
>
> [Mutual contact] mentioned you might know someone who'd be a fit for an AI-CAD beta I'm running.
>
> Quick context: I've built a verified-AI CAD tool (10-layer auto-check, image-to-intent, instant quote) on top of OpenSCAD. Code is solid (45 regression tests, 6-phase direct-edit shipped). What's missing is real-user feedback.
>
> Looking for 5 design partners:
> - Maker or small shop using OpenSCAD / Fusion / SolidWorks today
> - Willing to analyze 1-2 real parts over 2 weeks
> - 30-min demo call + written feedback (no formal interview)
>
> In return: free Pro plan for 6 months, direct Slack channel, priority on feature requests.
>
> If you know anyone, even a quick intro would help. Happy to send a demo video first.
>
> Thanks!
> [Name]
> nexyfab@nexysys.com

### Template D — Follow-up (3-day silence)

> **제목 (또는 RE:):** Re: [원래 제목]
>
> [성함]님,
>
> 며칠 전 보낸 메일 위로 짧게 다시 보냅니다.
>
> 시간 없으셔도 1줄 답장 (관심/시간 없음/다른 사람 추천) 주시면 정리에 도움됩니다.
>
> [Name]

---

## Demo Script (30 min target)

| 시간 | 내용 |
|---|---|
| 0-3 min | 인사 + persona 확인 ("어떤 CAD 주로 쓰세요? 가장 시간 많이 쓰는 작업?") |
| 3-8 min | **NL → intent → 검증** 라이브 데모 (간단한 box + 4 hole) |
| 8-13 min | **Image-to-intent** 라이브 데모 (스케치 1장 업로드 → 결과) |
| 13-18 min | **Cost + BOM + quote** 흐름 데모 |
| 18-22 min | **Reverse engineering** (STL 업로드 → candidate) — 시간 남으면 |
| 22-30 min | 질문 / 그들의 실제 use case 듣기 / 다음 step 합의 |

**중요:**
- 라이브 데모, 녹화 영상 X (대화 우선)
- 실패해도 OK — "이게 진짜 베타 상태입니다" 정직히
- 30분 안 넘기기 — 그들의 시간 존중

---

## Onboarding Checklist (Week 2-3)

각 partner에게 보내는 1-page:

```
[ ] Pro 계정 활성화됨 (6개월 무료 코드)
[ ] 슬랙/카카오톡 1:1 채널 생성
[ ] 첫 작업 후보 1-2개 합의 (실제 본인 일에서)
[ ] 주 1회 30분 체크인 시간 합의
[ ] 피드백 양식 링크 (간단 5문항)
[ ] 긴급 연락처 (저녁/주말도 OK 명시)
```

---

## Feedback Form Spec (Week 2-4 사용)

간단 5문항 (Google Form 또는 인앱):

1. **이번 주 도구로 시도한 작업?** (자유 텍스트)
2. **어떤 부분이 가장 좋았나요?** (자유)
3. **어디서 막혔나요? / 가장 큰 frustration?** (자유)
4. **이걸 동료에게 추천하시겠어요? 1-10점.** (NPS)
5. **다음 주에 추가되면 가장 좋을 기능 1개?** (자유)

추가 (선택):
6. 이걸 매월 $X 내고 쓰시겠어요? 적절한 가격은?

---

## Synthesis Template (Week 6-7)

5명 피드백 종합 → 다음 코딩 사이클 우선순위 결정:

```markdown
# Beta Synthesis — [Date]

## Partner activity summary
| Partner | Tier | Days active | Parts analyzed | NPS |
|---|---|---|---|---|
| P1 | maker | 12 | 3 | 8 |
| ... |

## Top 3 strengths (≥3명 공통 언급)
1. ...
2. ...
3. ...

## Top 3 frustrations (≥3명 공통)
1. ...
2. ...
3. ...

## Feature requests (count by partner)
| Feature | Requests | Effort estimate |
|---|---|---|
| sketch editor | 4 | 6-12 weeks |
| section view edit | 2 | 1 week |
| ... |

## Decision: Path B coding priority
[명확하게 결정 — sketch editor가 #1? 아니면 다른 X?]
```

---

## Tracking Sheet (간단 markdown table — 별도 Notion 가능)

```
| Partner | Tier | Contact | Status | First demo | Last activity | Notes |
|---|---|---|---|---|---|---|
| 1 | maker | jane@... | onboarded | 06-05 | 06-08 | works on 3D printed brackets |
| 2 | shop | ... | demo done, deciding | 06-06 | - | needs to talk to partner |
| 3 | ... | ... | outreach sent | - | - | - |
| 4 | ... | ... | not started | - | - | - |
| 5 | ... | ... | not started | - | - | - |
```

---

## Landing Page 변경 제안 (작은 카피 수정)

현재 landing page에 "Pro plan beta tester 모집" 작은 배너 추가:
- 위치: 상단 헤더 우측 (작게)
- 카피: "🔬 베타 테스터 5명 모집 — 무료 Pro 6개월 (자세히 보기)"
- 링크: 신청 폼 (간단 4문항: 이름/연락/사용 CAD/관심 사용 사례)

**미구현 기능 광고 금지 원칙** 지키기:
- "AI CAD" ✅ — 실제로 작동
- "검증 자동화" ✅ — 10-layer chain 실제 작동
- "Sketch editor" ❌ — B.lite는 좁은 scope, 광고 X
- "SolidWorks 대체" ❌ — 절대 금지

---

## 진척 추적

이 문서 자체가 progress tracker. Week마다 위 sections 업데이트:
- Outreach 보낸 수 / 응답률
- Demo 진행 수 / no-show 수
- Active partners (자정 기준 마지막 활동 ≤ 7일)
- NPS 평균 (3명+ 응답 시)

**6-8주 후 synthesis → Path B 풀스코프 우선순위 확정 → 코딩 재개.**
