# Cold Email — 한국 가공업체 (CNC / 판금 / 사출)

목적: NexyFab 파트너 등록 + Founding Partner 인센티브 안내.
모집 인원: 첫 20개 업체 → 평생 무료 + "Founding Partner" 배지.
근거: memory `nexyfab-gtm` "양면 시장의 short side(공급) 부족이 cold-start 병목 — short side에 보조금".

발신: nexyfab@nexysys.com
응답 처리: 24시간 내 1:1 미팅 제안 (zoom / 방문).

---

## 템플릿 A — CNC 가공업체 (정밀 부품)

**제목**: 자동 견적 요청을 받는 NexyFab Founding Partner 모집 — {{회사명}}

> 안녕하세요, {{회사명}} 대표님.
>
> 저희는 **NexyFab**(nexyfab.com) — 브라우저에서 3D 설계 후 한국 가공업체에 즉시 발주할 수 있는 SaaS 플랫폼입니다. 설계 단계부터 사용자가 가공이 가능한 형상만 그리도록 DFM 자동 검사가 들어가서, 받으시는 RFQ는 이미 한 번 걸러진 상태입니다.
>
> 지금 첫 20개 업체를 **Founding Partner**로 모시고 있습니다:
>
> - 평생 무료 (수수료 0%, NexyFab은 별도 SaaS 구독 매출)
> - "Founding Partner" 배지 + 검색 우선 노출
> - 응답 시간 / 품질 / 납기 별도 표시 (memory: `feedback-metric-design`)
> - 다차원 평가라 신규 파트너도 빠르게 인지도 확보 가능
>
> 보유 장비 / 가능 공정 / 주력 재질만 알려주시면 5분 안에 프로파일 등록해드립니다.
>
> 통화 / 방문 가능한 시간 알려주시면 맞춰 찾아뵙겠습니다.
>
> 감사합니다.
> **NexySys**
> nexyfab@nexysys.com
> nexyfab.com

---

## 템플릿 B — 판금 가공업체

**제목**: 판금 RFQ 자동 라우팅 — {{회사명}} Founding Partner 안내

> 안녕하세요. NexyFab입니다.
>
> 저희 플랫폼이 시트메탈 설계 (bend / flange / hem / jog) + flat pattern 자동 출력 + DXF 다운로드를 갖춘 다음, 사용자가 한 번 클릭으로 가공업체에 견적을 요청합니다.
>
> 시트메탈 RFQ는 일반적으로 도면이 부실하거나 K-factor가 빠져서 견적 자체가 오래 걸리는데, NexyFab은:
>
> - **재질·두께·K-factor** 입력 → BA/BD 자동 계산
> - **bend table** 자동 생성 (위치/각도/방향/순서)
> - **DXF flat pattern** 즉시 출력 (LASER 절단 직접 사용 가능)
> - **DFM 자동 검사** (min bend radius, hem feasibility per material)
>
> 시제품 단계의 RFQ가 빠짐없이 들어옵니다.
>
> Founding Partner 슬롯 한정 — 관심 있으시면 회신 부탁드립니다.
>
> 감사합니다.
> nexyfab@nexysys.com

---

## 템플릿 C — 사출 / 다이캐스팅 / 정밀 주조

**제목**: 시제품→양산 풀 워크플로우 발주 — {{회사명}}

> 안녕하세요.
>
> NexyFab에서 사출 / 주조 가공업체 Founding Partner를 모집하고 있습니다.
>
> 일반 발주 플랫폼과 차별점:
>
> - 사용자가 설계 단계에서 이미 **draft / wall thickness / undercut** DFM 검사를 통과
> - **AI 보조 설계**에 발주 단계에서 "AI 초안 — 사용자 검증 필수" 워터마크 + 책임 면책 약관 (memory: `nexyfab-gtm` AI 책임 경계)
> - 들어오는 RFQ가 발주자의 "확정된 설계" — 모호한 의도서 X
>
> 보유 장비 (톤수 / cavity 수 / 재질) 알려주시면 등록 진행하겠습니다.
>
> nexyfab@nexysys.com

---

## 응답 처리 스크립트

**Yes / 관심 있음**:
1. 같은 날 1시간 zoom 미팅 (또는 방문) 일정 제안
2. 미팅 전 사전 자료 보낼 1-pager: "NexyFab 파트너 흐름 30초" (별도 PDF)
3. 미팅 안건: ① 장비/공정/재질 확정 ② 가격대 (저/중/고) 등록 ③ 응답 SLA 합의
4. 미팅 종료 시 platform 가입 + 첫 RFQ 알림 채널 (이메일/카톡) 확정

**Maybe / 정보 더**:
1. 1-pager 발송 + 동일 산업 다른 파트너 사례 1건 (익명화)
2. 1주 후 fail-over 메시지: "지난 주 RFQ {N}건 들어왔는데, 적합한 파트너로 가는 중입니다. 마지막 자리 어떠신가요?"

**No / 거절**:
1. 사유 1줄 질문 ("어떤 부분이 맞지 않으셨나요?")
2. 응답에서 차별점 학습 → next batch에 반영
3. 6개월 후 재접근 가능 메모

---

## 발신 quota

- 1일 max 30건 (스팸 신호 차단)
- 1주 max 150건
- 응답률 KPI: ≥ 15% (안 되면 템플릿 재작성)
- 미팅→가입 전환: ≥ 30% (안 되면 1-pager 재작성)

목표 (memory `nexyfab-gtm` 게이트):
- **첫 30일**: 100곳 cold → 15곳 미팅 → 5곳 가입 (= Founding Partner 25% 채움)
- **첫 90일**: 20곳 가입 완료, 첫 실 거래 1건

---

## 도메인 리스트 소스

- KOSME (중소벤처기업진흥공단) 협력 가공업체 디렉터리
- 산단공 한국산업단지공단 입주기업 검색
- 알리바바 / 트레이드코리아 한국 셀러 셀러 필터
- 한국기계산업진흥회 회원사
- 페이스북 "한국 CNC / 판금 / 가공" 그룹 운영자 DM
