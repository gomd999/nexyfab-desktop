# M-C4 인증 수치 1호 — 실행 킷 (토목 파일럿, 260808)

목표: **독립 검증 정확도 수치 1호**. 이 킷으로 👤가 공급해야 하는 것은 두 가지뿐이다 —
**소스 파일**과 **리뷰어 2인의 서명**. 나머지 전 구간은 도구가 준비돼 있고
잠금해제 경로는 테스트로 증명돼 있다(`certificationUnlockPath.test.ts` — 권리 완비
외부 후보+콘솔 2인 승인 → scoreEligible=true → evidence 수용 실왕복).

## 1. 홀드아웃 소스 조달 (👤 — 최장 리드타임, 지금 시작)

**1순위 후보: 국토교통부 도로옹벽 표준도(2008)** — 중력식·반중력식·역T형·L형 +
부대도면, **구조계산서 동반**(ground truth 로 최상급). 배포처:
- 건설사업정보시스템 CALSPIA: https://www.calspia.go.kr/cpermit/cap/datroom/data601l.jsp
- 건설기술정보시스템 CODIL: https://www.codil.or.kr/viewDtlMoctRoadGuide.do?scCode=MT1&pageIndex=1&sType=RefTypeAll&pMetaCode=CIKCLS123003
- 국가기록원(설계기준·구조계산서 원본): https://www.archives.go.kr/next/newsearch/showDetailPopup.do?rc_code=1310377&rc_rfile_no=200902496188

같은 계열로 **도로암거 표준도**(box_culvert 대응)도 조달하면 토목 20케이스 구성이
표준도만으로 가능하다(옹벽 계열 + 암거 계열 + 파라미터 변형).

**👤 확인 필수(조달 시)**: 각 문서의 이용 조건 — 공공누리 유형/벤치마킹(성능 평가
목적 이용) 허용 여부를 배포 페이지에서 확인하고, `sourceRights.reference`에
**정확한 출처·조항 문구**를 기입한다. 불명확하면 발행처에 서면 문의(모호한 권리로
인증 진행 금지 — 파이프라인이 rights 없이는 잠기도록 되어 있음).

## 2. 케이스 저작 (🤖 도구 준비 완료 — 소스 도착 즉시)

```
node node_modules/tsx/dist/cli.mjs scripts/author-holdout-candidate.mjs \
  --spec specs/civil-rw-std-001.json --out candidates/civil-rw-std-001.json --generate
```
- spec 에는 소스 파일 경로(해시 자동)·권리·자연어 사양(sourceSpec — 표준도의 설계
  조건을 문장화)·축별 공차정책을 기입. `--generate`가 실 AI 생성을 돌려 산출물을
  만들고, 게이트·적격성(scoreReadyForReview)까지 실검증한다.
- 20케이스: 표준도 유형(중력식/역T/L형/암거) × 규격 변형으로 구성. 재캠페인
  대비 40+ 권장(G7 — 같은 케이스 재사용 금지).

## 3. 리뷰어 온보딩 (👤 섭외 + 🤖 콘솔 준비 완료)

**요건**: 도메인당 2인, 상호 독립(같은 팀/이해관계 금지), 저작자와 독립.
토목 파일럿=토목구조 실무자. 보수·NDA는 👤 협의.

**절차(리뷰어 1인당 ~2시간/20케이스 예상)**:
1. 검토 패킷 수령(`build-domain-accuracy-review-packets` 출력 JSON)
2. 검수 콘솔 접속: `/{lang}/nexyfab/review` — 패킷 업로드 → 케이스별로
   소스 문서(표준도 원본)와 산출물 요약·근거 축·공차정책 대조 → 체크리스트
   전 항목 확인 → 승인/거부(+메모)
3. 승인 JSON 내보내기 → 수합(리뷰어별 세션 파일 2개가 이중 승인을 구성)

체크리스트(콘솔에 내장 표시): 소스 신원·상업 벤치마크 권리 / 홀드아웃의
프롬프트·튜닝 미사용 / 산출물-소스 정합 / 전 필수 축 ground truth / 공차의
도메인 적정성(결과 짜맞춤 금지) / 리뷰어 독립성.

## 4. 캠페인·리포트 (🤖 — 승인 도착 즉시, 러너북 §G4→G6)

```
tsx scripts/promote-domain-accuracy-candidates.ts --candidates ... --approvals ...   # exit 0 + approvedCases 방출 확인
tsx scripts/run-domain-accuracy-campaign.ts --domain civil --cases approved.json \
  --state state.json --runs runs.json --executor node \
  --executor-arg scripts/domain-accuracy-validator.mjs --executor-arg --corpus --executor-arg candidates.json \
  --executor-arg --subject --executor-arg ai --executor-arg --roundtrip --executor-arg --repair
tsx scripts/report-domain-accuracy.ts --domain civil --cases approved.json --runs runs.json
```
- AI 주체 캠페인은 케이스당 AI 실호출(20×15=300콜 — Gemini 비용·시간 산정 후 실행).
- 결과 수치는 **측정치 그대로 표기**한다 — 95% 미달이어도 그 수치가 곧 자산이며,
  실패 축은 §G7 규정대로 백로그 환류 후 **새 홀드아웃**으로 재캠페인.

## 5. 상태 요약

| 구간 | 상태 |
|---|---|
| 잠금해제 경로 | ✅ 코드 증명(unlock 테스트 3/3 — 권리 없음/1인은 폐쇄 유지) |
| 케이스 저작 도구 | ✅ author-holdout-candidate(해시·생성·게이트·적격성 원스톱) |
| 검수 콘솔 | ✅ /nexyfab/review (2인 세션→이중승인 실왕복 검증) |
| 캠페인·검증기·리포트 | ✅ measured 8축, 드릴 14/14 |
| **소스 파일** | 👤 — 위 1순위 후보 조달+권리 확인 |
| **리뷰어 2인** | 👤 — 섭외(절차·도구는 위와 같이 준비 완료) |
