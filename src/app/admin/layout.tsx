import ToastProvider from '@/components/ToastProvider';
import AdminNav from './AdminNav';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body suppressHydrationWarning style={{ margin: 0 }}>
        <ToastProvider>
          <div className="min-h-screen bg-gray-50">
            <AdminNav />
            <main className="p-6">{children}</main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
