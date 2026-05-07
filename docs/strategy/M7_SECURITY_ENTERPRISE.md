# M7 — 보안·엔터프라이즈 체크리스트 (롤링)

**상위:** [M7_ASSEMBLY_SCALE.md](./M7_ASSEMBLY_SCALE.md), [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) §M7.

엔터프라이즈 출시 전 **담당자 서명**으로 완료를 표시한다. 항목은 제품·배포 환경에 맞게 추가한다.

## 인증·세션

- [ ] 비밀번호 정책·계정 잠금·2FA(TOTP) 요구사항 문서화.  
- [ ] `nf_access_token` httpOnly·SameSite·경로 정책 검토.  
- [ ] 데모/개발 전용 `ALLOW_DEMO_AUTH` 프로덕션 비활성.

## 권한·데이터

- [ ] 프로젝트 **소유자·멤버** ACL (`nf_project_members`) — 소유자만 삭제·보관·멤버 관리.  
- [ ] 감사 로그(`nf_audit_log`) 보존 기간·접근 권한.  
- [ ] 계정 삭제 시 PII·프로젝트 연쇄 삭제 정책 ([delete-account route 등]).

## 전송·저장

- [ ] 전 구간 HTTPS, HSTS(리버스 프록시).  
- [ ] DB·객체 스토리지 암호화 at-rest (클라우드 제공사 기능).  
- [ ] 백업 암호화·복구 테스트 주기.

## 규정·거버넌스

- [ ] 데이터 레지던시(지역별 DB/버킷).  
- [ ] DPA / GDPR·CCPA 요청 프로세스.  
- [ ] SSO(SAML/OIDC) 로드맵과 우선순위.

## 자동 스모크 (저비용)

- `npm run security:smoke` — `NODE_ENV=production` 이면서 `ALLOW_DEMO_AUTH=true`인 잘못된 조합을 검출하면 **exit 1**.

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | 초안 |
| 2026-04-30 | `security:smoke` 스크립트 추가 |
