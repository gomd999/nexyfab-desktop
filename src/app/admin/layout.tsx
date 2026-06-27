import ToastProvider from '@/components/ToastProvider';
import AdminNav from './AdminNav';
import AdminAuthGate from './AdminAuthGate';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body suppressHydrationWarning style={{ margin: 0 }}>
        <ToastProvider>
          {/* Gate every /admin/* page — nav + content only render once authed. */}
          <AdminAuthGate>
            <div className="min-h-screen bg-gray-50">
              <AdminNav />
              <main className="p-6">{children}</main>
            </div>
          </AdminAuthGate>
        </ToastProvider>
      </body>
    </html>
  );
}
