import { redirect } from 'next/navigation';

// /privacy → /kr/privacy-policy/ (한국어 기본)
export default function PrivacyRedirectPage() {
  redirect('/kr/privacy-policy/');
}
