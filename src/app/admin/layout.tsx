import { cookies } from 'next/headers';
import ToastProvider from '@/components/ToastProvider';
import AdminNav from './AdminNav';
import AdminLoginForm from './AdminLoginForm';
import AdminI18nProvider from './AdminI18nProvider';
import { verifyAdminTokenLive } from '@/lib/admin-auth';
import { adminCopy, resolveAdminLocale } from '@/lib/i18n/adminTranslations';
import { langDir } from '@/lib/i18n/normalize';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // SERVER-SIDE gate: verify the admin session cookie before rendering children.
  // A client-only gate still server-renders the protected pages into the HTML
  // (visible via view-source/curl). Here, unauthenticated requests render ONLY
  // the login form — children are never sent.
  const token = (await cookies()).get('nf_admin_token')?.value;
  const cookieStore = await cookies();
  const authed = await verifyAdminTokenLive(token);
  const locale = resolveAdminLocale(cookieStore.get('nf_admin_locale')?.value);
  const copy = adminCopy(locale);

  return (
    <html lang={locale} dir={langDir(locale)}>
      <body suppressHydrationWarning style={{ margin: 0 }}>
        <ToastProvider>
          {authed ? (
            <AdminI18nProvider locale={locale} copy={copy}>
              <div className="min-h-screen bg-gray-50">
                <AdminNav />
                <main className="p-6">{children}</main>
              </div>
            </AdminI18nProvider>
          ) : (
            <AdminI18nProvider locale={locale} copy={copy}>
              <AdminLoginForm />
            </AdminI18nProvider>
          )}
        </ToastProvider>
      </body>
    </html>
  );
}
