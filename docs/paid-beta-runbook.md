# NexyFab 유료 베타 런북

> **목적:** 유료 베타 출시 전에 팀이 직접 채워야 할 설정·운영 항목과, 법무에서 확정해야 할 문서를 한곳에 모은다.  
> **주의:** 법적 문구는 반드시 **변호사 검토** 후 반영한다. 본 문서는 체크리스트이며 법률 자문이 아니다.

---

## 1. 유료 베타에 대한 전제

- **범위:** “완전 GA”가 아니라, **소수 유료 고객·명확한 지원 채널·기대치 고정**을 전제로 한다.
- **코드베이스:** 견적 만료, 환불 요청·관리자 환불 큐, 에스크로, 문의 티켓(`nf_support_tickets`), 계약 PDF 권한 검증, RFQ 소유자 검증 등 **뼈대는 구현되어 있음** (`docs/current-status.md` 참고).
- **남은 갭:** **백업·복구 런북**, **부분 환불 등 엣지 정책**은 운영·법무에서 보완. 유료 베타 카피는 `NEXT_PUBLIC_PAID_BETA=1` 시 배너·문의·약관 샘플·메일에 반영됨(법무 확정 전 샘플 포함).

---

## 2. 직접 넣어야 하는 것 (운영·설정)

### 2.1 환경 변수·비밀값 (배포 콘솔)

실제 값은 각 서비스 대시보드에서 발급한다. 아래는 코드에서 자주 쓰이는 항목이다.

| 변수(예) | 용도 |
|-----------|------|
| `DATABASE_URL` | Postgres 연결 |
| Stripe / Toss / Airwallex 관련 키 | 결제·웹훅·환불 |
| `TOSS_WEBHOOK_SECRET`, `AIRWALLEX_ENV`(`prod` / `demo`) | 웹훅 검증·모드 |
| `RESEND_API_KEY` **또는** `SMTP_*`, `SMTP_FROM` | 트랜잭션 메일 |
| `ADMIN_EMAIL`, `NEXYFAB_ADMIN_EMAIL`, `SEND_MAIL_RECIPIENTS` | 관리자 알림·발송 대상 |
| `ADMIN_SECRET` / `ADMIN_SESSION_SECRET` | 관리자 세션 |
| `NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL` 등 | 이메일·링크 base URL 정합 |
| `SLACK_WEBHOOK_URL` (선택) | `opsAlert` 등 운영 알림 |
| `NEXYFAB_ADMIN_EMAIL_LOCALE` (선택) | 관리자 RFQ 메일 본문 언어 |
| `NEXYFAB_SUPPORT_EMAIL`, `NEXYFAB_SLA_STATUS_URL` (선택) | 엔터프라이즈 상태 API 등 |
| **`NEXT_PUBLIC_PAID_BETA`** | **`1`**이면 유료 베타 UI·카피·메일 변형·이용약관 제10조(샘플) 노출 (`src/components/PaidBetaBanner.tsx`, `contact`·`terms-of-use`·`payment`·`refund-request` 등) |

**직접 할 일:** 프로덕션에 위 값을 채우고, **Stripe·Toss·Airwallex 웹훅 URL**을 배포된 API 경로로 등록한다. 베타 기간에는 **`NEXT_PUBLIC_PAID_BETA=1`** 을 빌드에 포함한다.

### 2.2 제3자 콘솔 (코드 밖)

- 결제: 웹훅, 라이브 키, 허용 도메인  
- 메일: 발신 도메인 **SPF / DKIM**  
- 스토리지(R2 등): 버킷·CORS·액세스 키 (`current-status.md` 인프라 절 참고)

### 2.3 UI·문구 (레포 내 수정)

| 위치 | 내용 |
|------|------|
| `src/components/PaidBetaBanner.tsx` + `src/app/[lang]/layout.tsx` | `NEXT_PUBLIC_PAID_BETA=1`일 때 상단 이중 배너(베타 안내·대량주문/지원 티켓) |
| `src/app/[lang]/contact/page.tsx` | 동일 플래그 시 KST 지원 시간·SLA 예외·약관 링크 |
| `src/app/[lang]/refund-policy/page.tsx` | 제조 환불 원칙·RFQ 견적 7일 유효(개별 견적서 우선) |
| `src/app/[lang]/terms-of-use/page.tsx` | 플래그 시 **제10조 유료 베타 샘플**(법무 검토 전) |
| `src/app/api/nexyfab/orders/[id]/payment/route.ts` | 플래그 시 결제 완료 메일 제목·본문 베타 문구 |
| `src/app/api/nexyfab/orders/[id]/refund-request/route.ts` | 고객 확인 메일 + `placed`/`production` 단계에서 환불 **요청** 접수 |
| `src/app/[lang]/nexyfab/orders/page.tsx` | 환불 요청 버튼: `placed` 또는 `production`에서 표시 |

### 2.4 백업·복구 (문서 + 실제)

- 레포만으로는 **DB 백업·복원 절차**가 정의되어 있지 않을 수 있음.  
- **직접 할 일:** 호스팅(Railway Postgres 등)의 자동 백업·보존 기간을 확인하고, **분기 1회 복원 리허설** 일정을 잡는다.

---

## 3. 법적으로 채워야 하는 것 (문서·정합)

### 3.1 반드시 검토·갱신할 페이지 (이미 라우트 존재)

| 문서 | 경로(요약) | 채울 내용의 예 |
|------|------------|----------------|
| 이용약관 | `src/app/[lang]/terms-of-use/page.tsx` | 서비스 성격, 수수료·취소·환불, 책임 제한, **준거법·관할**, 유료 베타 조항 |
| 개인정보 처리방침 | `src/app/[lang]/privacy-policy/page.tsx` | 수집 항목·목적·보관, 제3자 제공, **국외 이전**, 위탁사 목록(Stripe 등), 권리·문의 |
| 환불 정책 | `src/app/[lang]/refund-policy/page.tsx` | 환불 가능 조건, 생산 착수 전후, PG 처리 기간, 관리자 승인 큐와의 관계 |

조항은 **언어별 `dict`**에 들어 있으므로, 법무 확정 후 **ko / en / ja …** 모두 같은 정책으로 맞출지 정한다.

### 3.2 실제 제품과의 정합 (분쟁 예방)

- 약관의 **수수료·위약금·“회사 역할”** 서술과, 실제 **결제·에스크로·주문 상태**가 다르면 위험하다.  
- `POST /api/nexyfab/orders/[id]/refund-request` 등 **구현된 규칙**(예: `placed` 이후 환불 불가)과 약관 문구를 **한 표로 맞출 것**.

### 3.3 유료 베타 전용으로 약관에 넣을 만한 조항(목차 수준)

변호사 검토 후 본문 작성. 아래는 **부칙 또는 별 장**으로 쓰기 좋은 목차 예시다.

1. **베타 프로그램의 정의** — 기간, 대상, 초대제 여부  
2. **서비스 범위 및 제한** — 미구현 기능, 실험 기능, 플래그로 꺼진 기능  
3. **가용성·SLA** — 베타 기간 중 중단·변경 가능, 별도 보상 한도  
4. **요금·청구** — 베타 가격, 종료 후 정식 요금 전환·통지 방법  
5. **데이터** — 보관·삭제·이전, 베타 종료 시 처리  
6. **환불·해지** — `refund-policy`와 교차 참조  
7. **피드백·측정** — 사용 로그·품질 개선 목적 (개인정보처리방침과 연계)  
8. **준거법·관할** — 기존 조항과 충돌 없이 정리  

### 3.4 파트너(공급사)·B2B

- 파트너 온보딩·정산·NDA는 **별도 계약 또는 파트너 약관**이 있는지 확인한다.  
- 청구서·세금계산서에 필요한 **사업자 정보**는 세무사와 정리 후 템플릿·DB에 반영한다.

### 3.5 해외 사용자·규제

- EU 등: GDPR, **DPA**, 국외 이전, 쿠키 동의 UI 필요 여부를 법무에 확인한다.

---

## 4. 코드·기능 점검 참고 (스모크)

유료 베타 전에 **수동으로 한 번씩** 확인하면 좋은 흐름이다.

| 영역 | 참고 |
|------|------|
| 견적 만료 | `GET /api/quotes` 시 `pending` + `valid_until` 경과 → `expired` |
| 고객 환불 요청 | `POST /api/nexyfab/orders/[id]/refund-request` (본인 주문·조건) |
| 관리자 환불 큐 | `/api/nexyfab/admin/refund-queue`, `/admin/refund-queue` |
| 에스크로 | `POST /api/nexyfab/escrow/[orderId]` (`refund` 등) |
| 문의 | `POST /api/contact` → `nf_support_tickets` |
| 계약 PDF | `GET /api/contracts/[id]/pdf` — 고객/파트너 이메일 또는 관리자 |

---

## 5. 관련 문서

- `docs/current-status.md` — Phase·기능·인프라 요약  
- `docs/3d-tools.md` — 3D/배포 점검(해당 시)

---

## 6. 개정 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-12 | `NEXT_PUBLIC_PAID_BETA` 연동 UI·환불 요청·런북 반영 |
