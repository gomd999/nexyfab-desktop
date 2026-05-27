# NexyFab — 다음 개선 백로그

우선순위는 임의이며, 제품 방향에 맞게 조정하면 됩니다.

## P1 — 연동·알림

1. **CAD 업로드 / 새 버전 시 알림**  
   `quick-quote/upload`(`src/app/api/quick-quote/upload/route.ts`), RFQ CAD 관련 경로에서 담당 파트너·RFQ 소유 고객에게 `nf_notifications` (+ 선택 이메일).  
   _현재 상태_: 업로드는 되지만 알림 미발송. 첨부 파일이 새 버전(`replaces_file_id` set)이면 RFQ 소유 고객/배정 파트너에게 알림 필요.

2. **신규 RFQ 브로드캐스트 범위** (제품 결정 필요)  
   현재 `src/app/api/nexyfab/rfq/route.ts:312-353`은 `preferredFactoryId`가 있으면 단일 공장에만, 없으면 `process LIKE %"keyword"%`인 모든 active factory에 이메일+`createNotification` 발송 — 경매 다이내믹 의도.  
   대안: **관리자 배정 후**에만 알림 → 노이즈 감소 vs 응답 속도 트레이드오프. 어느 쪽이 제품 방향인지 결정 후 코드 변경.

## P2 — 파트너 경험

4. **파트너 인앱 알림 실시간화**  
   고객처럼 SSE 또는 5~15초 폴링 + `/api/partner/...` 알림 엔드포인트(또는 기존 데이터에 unread 카운트).

5. **딥링크 정리**  
   `createNotification` 등에서 파트너는 `/partner/quotes`, 고객은 `/{lang}/nexyfab/rfq`로 일관되게.

## P3 — UX·기술부채

6. **`NexyfabNotificationBell` i18n**  
   패널 문구·`timeAgo`를 Header와 동일 언어 체계로 확장.

7. **헤더 로그아웃과 세션**  
   `localStorage`만 비우는 경우 `nf_access_token` 쿠키 정리 여부 점검(완전 로그아웃).

8. **RFQ 스레드형 메시지**  
   견적 외 중간 소통을 노트/채팅으로 모으고 알림과 연결할지 검토.

---

_마지막 갱신: 제품 백로그 스냅샷용._
