'use client';

import { createContext, useContext, useMemo } from 'react';
import type { AdminCopy, AdminLocale } from '@/lib/i18n/adminTranslations';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

type AdminI18nValue = { locale: AdminLocale; copy: AdminCopy };
const AdminI18nContext = createContext<AdminI18nValue | null>(null);

export default function AdminI18nProvider({ locale, copy, children }: AdminI18nValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, copy }), [locale, copy]);
  return <AdminI18nContext.Provider value={value}>{children}</AdminI18nContext.Provider>;
}

export function useAdminI18n(): AdminI18nValue {
  const value = useContext(AdminI18nContext);
  if (!value) throw new Error('useAdminI18n must be used inside AdminI18nProvider');
  return value;
}

/** Localized inline copy for admin screens that is not part of the navigation catalog. */
export function AdminText({ ko, en }: { ko: string; en: string }) {
  const { locale } = useAdminI18n();
  return <>{createCommercialLocalizer(locale)(ko, en)}</>;
}
