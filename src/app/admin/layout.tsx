import { cookies } from 'next/headers';
import ToastProvider from '@/components/ToastProvider';
import AdminNav from './AdminNav';
import AdminLoginForm from './AdminLoginForm';
import { verifyAdminToken } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // SERVER-SIDE gate: verify the admin session cookie before rendering children.
  // A client-only gate still server-renders the protected pages into the HTML
  // (visible via view-source/curl). Here, unauthenticated requests render ONLY
  // the login form — children are never sent.
  const token = (await cookies()).get('nf_admin_token')?.value;
  const authed = verifyAdminToken(token);

  return (
    <html lang="ko">
      <body suppressHydrationWarning style={{ margin: 0 }}>
        <ToastProvider>
          {authed ? (
            <div className="min-h-screen bg-gray-50">
              <AdminNav />
              <main className="p-6">{children}</main>
            </div>
          ) : (
            <AdminLoginForm />
          )}
        </ToastProvider>
      </body>
    </html>
  );
}
