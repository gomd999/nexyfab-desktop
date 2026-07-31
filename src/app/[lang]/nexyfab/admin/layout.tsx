/**
 * 관리자 구역 layout — **게이트를 진입점 하나에 세운다** (260802).
 *
 * ⚠ `page.tsx` 만 감싸면 `email-logs`·`email-templates`·`quotes`·`rfq-matching` 은
 *   열린 채 남는다. 하위 경로까지 덮으려면 layout 이어야 한다 —
 *   「한 곳만 막고 나머지를 잊는」 것이 이 세션에서 반복해 잡은 형태다.
 *
 * ⚠ 이 게이트는 **보안 경계가 아니다.** 판정은 서버가 각 API 에서 한다
 *   (`requireAdmin` → 상승 없으면 428). 여기 통과해도 데이터는 오지 않는다.
 *   화면의 역할은 **무엇을 해야 하는지 알려 주는 것**이다.
 */
import AdminElevationGate from './AdminElevationGate';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminElevationGate>{children}</AdminElevationGate>;
}
