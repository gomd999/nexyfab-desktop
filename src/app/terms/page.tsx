import { redirect } from 'next/navigation';

// /terms → /kr/terms-of-use/ (한국어 기본)
export default function TermsRedirectPage() {
  redirect('/kr/terms-of-use/');
}
