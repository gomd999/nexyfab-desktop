'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { formatDate } from '@/lib/formatDate';
import { AdminText, useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

interface ReleaseRow {
  id: string;
  version: string;
  pub_date: string;
  notes: string;
  download_win_x64: string | null;
  download_mac_aarch64: string | null;
  download_mac_x64: string | null;
  download_linux_x64: string | null;
  sig_win_x64: string | null;
  sig_mac_aarch64: string | null;
  sig_mac_x64: string | null;
  sig_linux_x64: string | null;
  dl_win_x64: number;
  dl_mac_aarch64: number;
  dl_mac_x64: number;
  dl_linux_x64: number;
  is_latest: number;
  created_at: number;
}

type FormData = Omit<ReleaseRow, 'id' | 'is_latest' | 'created_at' | 'dl_win_x64' | 'dl_mac_aarch64' | 'dl_mac_x64' | 'dl_linux_x64'>;

const EMPTY_FORM: FormData = {
  version: '',
  pub_date: new Date().toISOString().slice(0, 10),
  notes: '',
  download_win_x64: '',
  download_mac_aarch64: '',
  download_mac_x64: '',
  download_linux_x64: '',
  sig_win_x64: '',
  sig_mac_aarch64: '',
  sig_mac_x64: '',
  sig_linux_x64: '',
};

export default function AdminReleasesPage() {
  const { copy, locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingLatest, setSettingLatest] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>({ ...EMPTY_FORM });
  const [editVersion, setEditVersion] = useState<string | null>(null);

  const flash = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/releases');
      if (!r.ok) throw new Error('load failed');
      setReleases(await r.json());
    } catch {
      flash(L('릴리즈 목록을 불러오지 못했습니다.', 'Could not load releases.'), false);
    } finally {
      setLoading(false);
    }
  }, [L]);

  useEffect(() => { load(); }, [load]);

  const handleEdit = (rel: ReleaseRow) => {
    setForm({
      version: rel.version,
      pub_date: rel.pub_date.slice(0, 10),
      notes: rel.notes,
      download_win_x64: rel.download_win_x64 ?? '',
      download_mac_aarch64: rel.download_mac_aarch64 ?? '',
      download_mac_x64: rel.download_mac_x64 ?? '',
      download_linux_x64: rel.download_linux_x64 ?? '',
      sig_win_x64: rel.sig_win_x64 ?? '',
      sig_mac_aarch64: rel.sig_mac_aarch64 ?? '',
      sig_mac_x64: rel.sig_mac_x64 ?? '',
      sig_linux_x64: rel.sig_linux_x64 ?? '',
    });
    setEditVersion(rel.version);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNew = () => {
    setForm({ ...EMPTY_FORM });
    setEditVersion(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.version.trim()) { flash(L('버전을 입력하세요.', 'Enter a version.'), false); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        pub_date: new Date(form.pub_date).toISOString(),
        download_win_x64: form.download_win_x64 || null,
        download_mac_aarch64: form.download_mac_aarch64 || null,
        download_mac_x64: form.download_mac_x64 || null,
        download_linux_x64: form.download_linux_x64 || null,
        sig_win_x64: form.sig_win_x64 || null,
        sig_mac_aarch64: form.sig_mac_aarch64 || null,
        sig_mac_x64: form.sig_mac_x64 || null,
        sig_linux_x64: form.sig_linux_x64 || null,
      };
      const r = await fetch('/api/admin/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('save failed');
      flash(editVersion ? `${L('v', 'v')}${form.version} ${L('업데이트 완료', 'updated')}` : `${L('v', 'v')}${form.version} ${L('등록 완료', 'registered')}`, true);
      setShowForm(false);
      setEditVersion(null);
      await load();
    } catch {
      flash(L('릴리즈를 저장하지 못했습니다.', 'Could not save the release.'), false);
    } finally {
      setSaving(false);
    }
  };

  const setLatest = async (id: string, version: string) => {
    if (!confirm(`${L('v', 'v')}${version} ${L('을 최신 릴리즈로 설정하시겠습니까?', 'Set as the latest release?')}`)) return;
    setSettingLatest(id);
    try {
      const r = await fetch('/api/admin/releases', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error('latest update failed');
      flash(`${L('v', 'v')}${version} → ${L('최신 릴리즈로 설정됨', 'set as the latest release')}`, true);
      await load();
    } catch {
      flash(L('최신 릴리즈 설정에 실패했습니다.', 'Could not set the latest release.'), false);
    } finally {
      setSettingLatest(null);
    }
  };

  const inputCls = 'w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{copy.pageTitles.releases}</h1>
          <p className="text-sm text-gray-500 mt-1">
            <AdminText ko="데스크톱 앱 버전 정보 및 다운로드 URL 관리 · " en="Manage desktop app versions and download URLs · " />
            <a href="/kr/download" target="_blank" className="text-blue-600 hover:underline"><AdminText ko="다운로드 페이지 미리보기" en="Preview download page" /></a>
          </p>
        </div>
        <button
          onClick={handleNew}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          <AdminText ko="+ 새 릴리즈" en="+ New release" />
        </button>
      </div>

      {/* Toast */}
      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${msg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{editVersion ? <>v{editVersion} <AdminText ko="수정" en="Edit" /></> : <AdminText ko="새 릴리즈 등록" en="Register new release" />}</h2>
            <button onClick={() => { setShowForm(false); setEditVersion(null); }} className="text-gray-400 hover:text-gray-600 text-sm"><AdminText ko="닫기" en="Close" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}><AdminText ko="버전 *" en="Version *" /></label>
                <input
                  className={inputCls} placeholder="0.1.0" value={form.version}
                  onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  disabled={!!editVersion}
                />
              </div>
              <div>
                <label className={labelCls}><AdminText ko="출시일" en="Release date" /></label>
                <input
                  type="date" className={inputCls} value={form.pub_date}
                  onChange={e => setForm(f => ({ ...f, pub_date: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}><AdminText ko="릴리즈 노트 (마크다운)" en="Release notes (Markdown)" /></label>
              <textarea
                className={`${inputCls} font-mono`} rows={5}
                placeholder={`## NexyFab 0.1.0\n\n- ${L('초기 릴리즈', 'Initial release')}\n- ${L('네이티브 파일 저장', 'Native file storage')}`}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3"><AdminText ko="다운로드 URL" en="Download URL" /></p>
              <div className="grid grid-cols-1 gap-3">
                {[
                  { key: 'download_win_x64', label: 'Windows x64 (.msi)', ph: 'https://nexyfab.com/releases/0.1.0/NexyFab_0.1.0_x64_en-US.msi' },
                  { key: 'download_mac_aarch64', label: 'macOS Apple Silicon (.dmg)', ph: 'https://nexyfab.com/releases/0.1.0/NexyFab_0.1.0_aarch64.dmg' },
                  { key: 'download_mac_x64', label: 'macOS Intel (.dmg)', ph: 'https://nexyfab.com/releases/0.1.0/NexyFab_0.1.0_x64.dmg' },
                  { key: 'download_linux_x64', label: 'Linux x64 (.AppImage)', ph: 'https://nexyfab.com/releases/0.1.0/nexyfab_0.1.0_amd64.AppImage' },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label className={labelCls}>{label}</label>
                    <input
                      className={inputCls} placeholder={ph}
                      value={(form as unknown as Record<string, string>)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                <AdminText ko="서명 (.sig 파일 내용) — 자동 업데이트 보안 필수" en="Signature (.sig file content) — required for secure auto-updates" />
              </p>
              <div className="grid grid-cols-1 gap-3">
                {[
                  { key: 'sig_win_x64', label: L('Windows x64 서명', 'Windows x64 signature') },
                  { key: 'sig_mac_aarch64', label: L('macOS Apple Silicon 서명', 'macOS Apple Silicon signature') },
                  { key: 'sig_mac_x64', label: L('macOS Intel 서명', 'macOS Intel signature') },
                  { key: 'sig_linux_x64', label: L('Linux x64 서명', 'Linux x64 signature') },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className={labelCls}>{label}</label>
                    <textarea
                      className={`${inputCls} font-mono text-xs`} rows={2}
                      placeholder="dW50cnVzdGVkIGNvbW1lbnQ6..."
                      value={(form as unknown as Record<string, string>)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? <AdminText ko="저장 중..." en="Saving..." /> : editVersion ? <AdminText ko="업데이트" en="Update" /> : <AdminText ko="등록" en="Register" />}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditVersion(null); }}
                className="px-5 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors"
              >
                <AdminText ko="취소" en="Cancel" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Release List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400"><AdminText ko="로딩 중..." en="Loading…" /></div>
      ) : releases.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 mb-3"><AdminText ko="등록된 릴리즈가 없습니다." en="No releases registered." /></p>
          <button onClick={handleNew} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold"><AdminText ko="첫 릴리즈 등록" en="Register first release" /></button>
        </div>
      ) : (
        <div className="space-y-3">
          {releases.map(rel => (
            <div
              key={rel.id}
              className={`bg-white border rounded-xl p-5 flex items-start gap-4 ${rel.is_latest ? 'border-blue-200 shadow-sm' : 'border-gray-200'}`}
            >
              {/* Version Badge */}
              <div className="flex-shrink-0 text-center min-w-[72px]">
                <div className={`text-lg font-bold font-mono ${rel.is_latest ? 'text-blue-600' : 'text-gray-700'}`}>
                  v{rel.version}
                </div>
                {rel.is_latest ? (
                  <span className="inline-block text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-semibold mt-1"><AdminText ko="최신" en="Latest" /></span>
                ) : (
                  <span className="inline-block text-xs text-gray-400 mt-1">{formatDate(rel.pub_date, locale)}</span>
                )}
                {/* 총 다운로드 */}
                {(() => {
                  const total = (rel.dl_win_x64 ?? 0) + (rel.dl_mac_aarch64 ?? 0) + (rel.dl_mac_x64 ?? 0) + (rel.dl_linux_x64 ?? 0);
                  return total > 0 ? (
                    <div className="mt-1.5 text-xs font-semibold text-gray-500">
                      {total.toLocaleString(locale)}<span className="font-normal text-gray-400"> DL</span>
                    </div>
                  ) : null;
                })()}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-2 mb-2">
                  {[
                    { url: rel.download_win_x64, label: 'Win', count: rel.dl_win_x64 ?? 0 },
                    { url: rel.download_mac_aarch64, label: 'Mac ARM', count: rel.dl_mac_aarch64 ?? 0 },
                    { url: rel.download_mac_x64, label: 'Mac Intel', count: rel.dl_mac_x64 ?? 0 },
                    { url: rel.download_linux_x64, label: 'Linux', count: rel.dl_linux_x64 ?? 0 },
                  ].map(({ url, label, count }) => (
                    <span
                      key={label}
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${url ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}
                    >
                      {label} {url ? (count > 0 ? count.toLocaleString(locale) : '✓') : '—'}
                    </span>
                  ))}
                  {[rel.sig_win_x64, rel.sig_mac_aarch64, rel.sig_mac_x64, rel.sig_linux_x64].some(Boolean) && (
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200 font-medium"><AdminText ko="서명 있음" en="Signature present" /></span>
                  )}
                </div>
                {rel.notes && (
                  <p className="text-xs text-gray-500 truncate">{rel.notes.replace(/^##\s+/, '').slice(0, 120)}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-shrink-0">
                {!rel.is_latest && (
                  <button
                    onClick={() => setLatest(rel.id, rel.version)}
                    disabled={settingLatest === rel.id}
                    className="px-3 py-1.5 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-lg font-medium hover:bg-blue-100 disabled:opacity-50 transition-colors"
                  >
                    {settingLatest === rel.id ? '...' : <AdminText ko="최신으로 설정" en="Set as latest" />}
                  </button>
                )}
                <button
                  onClick={() => handleEdit(rel)}
                  className="px-3 py-1.5 text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded-lg font-medium hover:bg-gray-100 transition-colors"
                >
                  <AdminText ko="수정" en="Edit" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help */}
      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500 space-y-1">
        <p className="font-semibold text-gray-600 mb-2"><AdminText ko="사용 방법" en="How to use" /></p>
        <p>1. <code className="bg-gray-100 px-1 rounded">npm run tauri:release</code> <AdminText ko="로 빌드 →" en="to build →" /> <code className="bg-gray-100 px-1 rounded">npm run tauri:env</code> <AdminText ko="로 서명 확인" en="to verify the signature" /></p>
        <p><AdminText ko="2. 인스톨러 파일을" en="2. Upload the installer to" /> <code className="bg-gray-100 px-1 rounded">nexyfab.com/releases/{'<version>'}/</code></p>
        <p><AdminText ko="3. 위 폼에 URL + 서명 입력 후 저장 → &quot;최신으로 설정&quot; 클릭" en="3. Enter the URL and signature above, save, then click &quot;Set as latest&quot;" /></p>
        <p><AdminText ko="4. 앱이 자동으로" en="4. The app polls" /> <code className="bg-gray-100 px-1 rounded">/api/desktop-update</code> <AdminText ko="를 폴링해 업데이트 감지" en="to detect updates automatically" /></p>
      </div>
    </div>
  );
}
