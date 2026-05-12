# Email Deliverability — SPF / DKIM / DMARC for nexyfab@nexysys.com

NexyFab 의 모든 트랜잭셔널 발신은 `nexyfab@nexysys.com` 을 사용한다.
광고로 가입자가 들어오기 전에 SPF/DKIM/DMARC 3-요소가 모두 정렬돼야
스팸함으로 빠지지 않는다. 이 문서는 운영자(SRE/DevOps)가 *재현 가능하게*
인증을 점검·수정하는 절차다.

---

## 0. 발송 경로 요약

```
NexyFab 앱 (Railway) ──► SMTP relay (현재: <provider 미정 — 채워넣을 것>)
                                     │
                                     ├── SPF: relay 의 발송 IP/range 가 nexysys.com SPF 에 포함돼야 함
                                     ├── DKIM: relay 가 nexysys.com 도메인 키로 메시지 서명
                                     └── DMARC: nexysys.com 의 DMARC 레코드가 위 둘 정렬을 강제
```

발송 provider 후보: SendGrid / Mailgun / Postmark / AWS SES / Naver SES.
DKIM key는 provider 측 콘솔에서 생성 → 우리 DNS 에 CNAME (또는 TXT) 로 등록.

---

## 1. DNS 레코드 — 정답 형태

(하나의 발송 도메인 = `nexysys.com` 가정. 서브도메인 발송이면 `mail.nexysys.com`
같이 SPF/DKIM/DMARC 모두 그 서브도메인에 동일하게 설정.)

### SPF (TXT @)

```
nexysys.com.   IN TXT  "v=spf1 include:<provider-spf-domain> ~all"
```

- `include:` 는 *우리 메일을 보낼 권한이 있는* IP 셋을 선언한다.
- `~all` (soft fail) 로 시작하고, 한 달 이상 정착이 확인되면 `-all` (hard fail)로 강화.
- SPF TXT 는 **하나만** 존재해야 한다. 여러 개면 모두 무효.
- include 횟수는 10회 한도 — provider 의 nested include 가 깊으면 flatten 필요.

### DKIM (CNAME 또는 TXT)

provider 가 발급한 selector 를 그대로 사용. 예 (SendGrid 형태):

```
s1._domainkey.nexysys.com.    IN CNAME  s1.domainkey.u<account>.wl.sendgrid.net.
s2._domainkey.nexysys.com.    IN CNAME  s2.domainkey.u<account>.wl.sendgrid.net.
```

또는 직접 키:

```
default._domainkey.nexysys.com.   IN TXT   "v=DKIM1; k=rsa; p=<base64-public-key>"
```

- selector(`s1`/`s2`/`default`) 는 provider 가 지정.
- 키는 *2048-bit 이상*. 1024 는 신규 등록 금지.

### DMARC (TXT _dmarc)

```
_dmarc.nexysys.com.   IN TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@nexysys.com; ruf=mailto:dmarc-forensic@nexysys.com; fo=1; adkim=s; aspf=s; pct=100"
```

- 시작은 `p=none` (모니터 only) → 한 달간 rua 리포트 모니터링
- 정렬 실패가 0% 가까워지면 `p=quarantine` (스팸함 격리)
- 마지막에 `p=reject` (거부) — 이 시점이면 phish 시도가 자동 차단됨
- `adkim=s`, `aspf=s` strict 정렬 — From: 도메인이 SPF/DKIM 도메인과 정확히 일치해야 통과
- `rua` 메일박스는 `dmarc-reports@nexysys.com` 으로 새로 만들고, 자동 파싱 가능한 곳(Postmark DMARC 무료 등)으로 forwarding 권장

---

## 2. 검증 명령

운영 서버 어디서든 `dig` 로 즉시 확인:

```bash
# SPF — 정확히 1개 TXT 결과 + provider include 포함 여부
dig +short TXT nexysys.com | grep spf1

# DKIM — selector 별 결과 (provider 가 알려준 selector 사용)
dig +short TXT s1._domainkey.nexysys.com
dig +short CNAME s1._domainkey.nexysys.com

# DMARC
dig +short TXT _dmarc.nexysys.com
```

수신 측 정합성 검증:

```bash
# Gmail 에 메일 한 통 보낸 뒤, 받은 메일 → 원본 보기 → Authentication-Results 헤더 확인
# 다음 세 줄이 모두 pass 여야 함:
#   spf=pass    smtp.mailfrom=...
#   dkim=pass   header.d=nexysys.com
#   dmarc=pass  header.from=nexysys.com

# 또는 자동화: mail-tester.com 에 1회용 주소로 발송 → 10/10 점수 확인
```

---

## 3. 발송 실패 디버깅 체크리스트

수신자가 메일을 못 받는다는 보고가 들어왔을 때:

1. **Bounce 인지**
   - provider 콘솔(Sent → Bounced) 확인. Hard bounce(invalid mailbox) 와
     soft bounce(temporary) 구분.
2. **Spam folder 확인**
   - 수신자에게 스팸함/프로모션 탭/사회 탭 확인 요청. Gmail 은 한 번 스팸으로
     찍히면 학습되어 동일 발신처는 계속 스팸 처리.
3. **Authentication 헤더**
   - 동일 수신자에게 테스트 메일 1통 발송 → 원본 헤더에서 `Authentication-Results` 확인
   - 어떤 단계가 fail 인지 식별 (spf? dkim? dmarc alignment?)
4. **DNS 전파**
   - 최근 DNS 변경이 있었으면 `dig +trace` 로 권한 서버까지의 경로 확인
   - TTL 만료 시간 대기 (보통 300s — 1h)
5. **Reputation 조회**
   - <https://www.senderscore.org/> 또는 provider 의 reputation dashboard
   - Gmail Postmaster Tools 등록(`google.com/postmaster`)으로 도메인 reputation 추적
6. **Content trigger**
   - 첨부파일 .exe/.zip, 짧은 단축 URL, 광고성 키워드 과다 → 스팸 필터 점수 상승
   - HTML 만 있고 plain text 부재 → 점수 상승
7. **Volume warmup**
   - 신규 도메인은 발송량을 점진 증가(첫날 50통, 셋째날 200통, 일주일 1000통…)
   - 광고 직후 1만통 일시 발송은 reputation 망가뜨림

---

## 4. 모니터링 자동화 (운영 적용 권장)

- **DMARC 리포트 파싱** — `rua=` 로 들어오는 일별 XML 리포트를 자동 집계.
  무료 옵션: dmarcian.com / Postmark DMARC monitoring.
- **/api/cron/email-health** (TODO) — 주 1회 다음 항목을 검사, 실패 시
  ops 알림(Slack):
  - `dig` SPF/DKIM/DMARC 응답이 예상값과 일치
  - 직전 7일 bounce ratio < 5%
  - 직전 7일 complaint ratio < 0.1%
- **mail-tester.com 스코어** — 새 템플릿 머지 PR 의 CI 단계로 점수 10/10 확인.

---

## 5. 로컬 dev 발송 (인증 무시 가능)

dev 환경은 `MAIL_DRY_RUN=1` 으로 콘솔 출력만. SMTP 도달 검증이 필요하면
[`mailpit`](https://github.com/axllent/mailpit) 같은 로컬 가짜 SMTP 띄우고
앱 환경변수에 `SMTP_HOST=localhost SMTP_PORT=1025` 만 지정.

---

## 변경 로그

- 2026-05-07 — 초안 작성. provider 미선정 (TODO 표시).
