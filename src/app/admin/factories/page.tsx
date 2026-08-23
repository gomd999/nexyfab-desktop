'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Factory {
  id: string;
  name: string;
  name_ko: string | null;
  region: string;
  processes: string[];
  min_lead_time: number;
  max_lead_time: number;
  rating: number;
  review_count: number;
  price_level: string;
  certifications: string[];
  description: string | null;
  description_ko: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  status: string;
  created_at: number;
}
const PROCESS_OPTIONS = [
  { value: 'cnc_milling',       ko: 'CNC 밀링', en: 'CNC milling' },
  { value: 'cnc_turning',       ko: 'CNC 선삭', en: 'CNC turning' },
  { value: 'injection_molding', ko: '사출 성형', en: 'Injection molding' },
  { value: 'sheet_metal',       ko: '판금', en: 'Sheet metal' },
  { value: 'casting',           ko: '주조', en: 'Casting' },
  { value: '3d_printing',       ko: '3D 프린팅', en: '3D printing' },
  { value: 'welding',           ko: '용접', en: 'Welding' },
  { value: 'surface_treatment', ko: '표면처리', en: 'Surface treatment' },
];

const REGION_OPTIONS = [
  { value: 'KR', ko: '🇰🇷 한국', en: '🇰🇷 South Korea' },
  { value: 'US', ko: '🇺🇸 미국', en: '🇺🇸 United States' },
  { value: 'DE', ko: '🇩🇪 독일', en: '🇩🇪 Germany' },
  { value: 'JP', ko: '🇯🇵 일본', en: '🇯🇵 Japan' },
  { value: 'CN', ko: '🇨🇳 중국', en: '🇨🇳 China' },
  { value: 'TW', ko: '🇹🇼 대만', en: '🇹🇼 Taiwan' },
  { value: 'VN', ko: '🇻🇳 베트남', en: '🇻🇳 Vietnam' },
];

type Localize = (ko: string, en: string) => string;
const optionLabel = (option: { ko: string; en: string }, L: Localize) => L(option.ko, option.en);
const formatNumber = (value: number, locale: string, maximumFractionDigits = 0) => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale, { maximumFractionDigits }).format(value);

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d',
  border: '#30363d', text: '#e6edf3', dim: '#8b949e',
  accent: '#388bfd', green: '#3fb950', red: '#f85149', yellow: '#d29922',
};

const emptyForm = {
  name: '', name_ko: '', region: 'KR', processes: [] as string[],
  min_lead_time: 7, max_lead_time: 30, rating: 4.0, price_level: 'medium',
  certifications: '', description: '', description_ko: '',
  contact_email: '', contact_phone: '', website: '', status: 'active',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminFactoriesPage() {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRegion, setFilterRegion] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Factory | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchFactories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterRegion !== 'all') params.set('region', filterRegion);
      if (search) params.set('q', search);
      const res = await fetch(`/api/admin/factories?${params}`);
      const data = await res.json() as { factories: Factory[] };
      setFactories(data.factories ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [filterStatus, filterRegion, search]);

  useEffect(() => { fetchFactories(); }, [fetchFactories]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (f: Factory) => {
    setEditTarget(f);
    setForm({
      name: f.name,
      name_ko: f.name_ko || '',
      region: f.region,
      processes: f.processes,
      min_lead_time: f.min_lead_time,
      max_lead_time: f.max_lead_time,
      rating: f.rating,
      price_level: f.price_level,
      certifications: f.certifications.join(', '),
      description: f.description || '',
      description_ko: f.description_ko || '',
      contact_email: f.contact_email || '',
      contact_phone: f.contact_phone || '',
      website: f.website || '',
      status: f.status,
    });
    setShowForm(true);
  };

  const toggleProcess = (p: string) => {
    setForm(prev => ({
      ...prev,
      processes: prev.processes.includes(p)
        ? prev.processes.filter(x => x !== p)
        : [...prev.processes, p],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast(L('제조사명을 입력하세요.', 'Enter the manufacturer name.')); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        certifications: form.certifications.split(',').map(s => s.trim()).filter(Boolean),
      };
      const url = editTarget ? `/api/admin/factories/${editTarget.id}` : '/api/admin/factories';
      const method = editTarget ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        showToast(d.error || L('저장 실패', 'Save failed'));
        return;
      }
      showToast(editTarget ? L('수정됐습니다.', 'Updated.') : L('등록됐습니다.', 'Registered.'));
      setShowForm(false);
      fetchFactories();
    } catch { showToast(L('오류가 발생했습니다.', 'An error occurred.')); } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(L(`"${name}"을(를) 삭제하시겠습니까?`, `Delete "${name}"?`))) return;
    try {
      await fetch(`/api/admin/factories/${id}`, { method: 'DELETE' });
      showToast(L('삭제됐습니다.', 'Deleted.'));
      fetchFactories();
    } catch { showToast(L('삭제 실패', 'Delete failed')); }
  };

  const handleToggleStatus = async (f: Factory) => {
    const newStatus = f.status === 'active' ? 'inactive' : 'active';
    await fetch(`/api/admin/factories/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchFactories();
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/admin/factories/seed', { method: 'POST' });
      const data = await res.json() as { seeded: number; message?: string };
      showToast(data.message || L(`${formatNumber(data.seeded, locale)}개 제조사를 불러왔습니다.`, `Loaded ${formatNumber(data.seeded, locale)} manufacturers.`));
      fetchFactories();
    } catch { showToast(L('씨딩 실패', 'Seeding failed')); } finally {
      setSeeding(false);
    }
  };

  const priceLevelLabel: Record<string, string> = { low: L('저가', 'Low'), medium: L('중가', 'Medium'), high: L('고가', 'High') };

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'system-ui, sans-serif', color: C.text }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: '#1f6feb', color: '#fff', borderRadius: 8,
          padding: '10px 18px', fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{L('🏭 제조사 관리', '🏭 Manufacturer management')}</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>
            {L(`${formatNumber(factories.length, locale)}개 제조사`, `${formatNumber(factories.length, locale)} manufacturers`)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSeed}
            disabled={seeding}
            style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.card, color: C.dim, cursor: 'pointer', fontSize: 13,
            }}
          >
            {seeding ? L('불러오는 중...', 'Loading...') : L('기본 데이터 씨딩', 'Seed default data')}
          </button>
          <button
            onClick={openCreate}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: C.accent, color: '#fff', cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
            }}
          >
            {L('+ 제조사 등록', '+ Add manufacturer')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={L('이름, 이메일 검색...', 'Search name or email...')}
          style={{
            flex: 1, minWidth: 200, padding: '7px 12px', borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13,
          }}
        />
        <select
          value={filterRegion}
          onChange={e => setFilterRegion(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13 }}
        >
          <option value="all">{L('전체 지역', 'All regions')}</option>
          {REGION_OPTIONS.map(r => <option key={r.value} value={r.value}>{optionLabel(r, L)}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13 }}
        >
          <option value="all">{L('전체 상태', 'All statuses')}</option>
          <option value="active">{L('활성', 'Active')}</option>
          <option value="inactive">{L('비활성', 'Inactive')}</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.dim }}>{L('불러오는 중...', 'Loading...')}</div>
      ) : factories.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.dim }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>{L('등록된 제조사가 없습니다.', 'No manufacturers found.')}</p>
          <button onClick={handleSeed} style={{ padding: '8px 16px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}>
            {L('기본 데이터 씨딩', 'Seed default data')}
          </button>
        </div>
      ) : (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['제조사명', '지역', '공정', '납기(일)', '평점', '가격대', '연락처', '상태', '액션'].map((h, index) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: C.dim, fontWeight: 600, whiteSpace: 'nowrap' }}>{L(h, ['Manufacturer', 'Region', 'Process', 'Lead time (days)', 'Rating', 'Price level', 'Contact', 'Status', 'Action'][index])}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {factories.map((f, i) => (
                <tr key={f.id} style={{ borderBottom: i < factories.length - 1 ? `1px solid ${C.border}` : 'none', background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.card)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 700, color: C.text }}>{f.name}</div>
                    {f.name_ko && <div style={{ fontSize: 11, color: C.dim }}>{f.name_ko}</div>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {(() => { const region = REGION_OPTIONS.find(r => r.value === f.region); return region ? optionLabel(region, L) : f.region; })()}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {f.processes.slice(0, 3).map(p => (
                        <span key={p} style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: '#1f3a5f', color: '#79c0ff', fontWeight: 600,
                        }}>
                          {(() => { const process = PROCESS_OPTIONS.find(o => o.value === p); return process ? optionLabel(process, L) : p; })()}
                        </span>
                      ))}
                      {f.processes.length > 3 && <span style={{ fontSize: 10, color: C.dim }}>+{f.processes.length - 3}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', color: C.dim }}>{L(`${formatNumber(f.min_lead_time, locale)}~${formatNumber(f.max_lead_time, locale)}일`, `${formatNumber(f.min_lead_time, locale)}–${formatNumber(f.max_lead_time, locale)} days`)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: C.yellow, fontWeight: 700 }}>★ {formatNumber(f.rating, locale, 1)}</span>
                    <span style={{ color: C.dim, fontSize: 11 }}> ({formatNumber(f.review_count, locale)})</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: C.dim }}>{priceLevelLabel[f.price_level] ?? f.price_level}</td>
                  <td style={{ padding: '10px 14px', color: C.dim }}>{f.contact_email || '-'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <button
                      onClick={() => handleToggleStatus(f)}
                      style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700,
                        background: f.status === 'active' ? '#1a2e1a' : '#2d1f1f',
                        color: f.status === 'active' ? C.green : C.red,
                      }}
                    >
                      {f.status === 'active' ? L('활성', 'Active') : L('비활성', 'Inactive')}
                    </button>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(f)} style={{
                        padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
                        background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 12,
                      }}>{L('편집', 'Edit')}</button>
                      <button onClick={() => handleDelete(f.id, f.name)} style={{
                        padding: '4px 10px', borderRadius: 6, border: `1px solid #3d1f1f`,
                        background: 'transparent', color: C.red, cursor: 'pointer', fontSize: 12,
                      }}>{L('삭제', 'Delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20,
        }}>
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
            padding: 28, width: '100%', maxWidth: 640, maxHeight: '90vh',
            overflowY: 'auto', color: C.text,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 20px' }}>
              {editTarget ? L('제조사 수정', 'Edit manufacturer') : L('제조사 등록', 'Add manufacturer')}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label={L('제조사명 *', 'Manufacturer name *')}>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  style={inputStyle} placeholder={L('KoreaPrecision Co.', 'KoreaPrecision Co.')} />
              </Field>
              <Field label={L('한국어 이름', 'Korean name')}>
                <input value={form.name_ko} onChange={e => setForm(p => ({ ...p, name_ko: e.target.value }))}
                  style={inputStyle} placeholder={L('코리아프리시전', 'KoreaPrecision')} />
              </Field>
              <Field label={L('지역', 'Region')}>
                <select value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} style={inputStyle}>
                  {REGION_OPTIONS.map(r => <option key={r.value} value={r.value}>{optionLabel(r, L)}</option>)}
                </select>
              </Field>
              <Field label={L('가격대', 'Price level')}>
                <select value={form.price_level} onChange={e => setForm(p => ({ ...p, price_level: e.target.value }))} style={inputStyle}>
                  <option value="low">{L('저가', 'Low')}</option>
                  <option value="medium">{L('중가', 'Medium')}</option>
                  <option value="high">{L('고가', 'High')}</option>
                </select>
              </Field>
              <Field label={L('최소 납기 (일)', 'Minimum lead time (days)')}>
                <input type="number" value={form.min_lead_time} onChange={e => setForm(p => ({ ...p, min_lead_time: +e.target.value }))} style={inputStyle} />
              </Field>
              <Field label={L('최대 납기 (일)', 'Maximum lead time (days)')}>
                <input type="number" value={form.max_lead_time} onChange={e => setForm(p => ({ ...p, max_lead_time: +e.target.value }))} style={inputStyle} />
              </Field>
              <Field label={L('평점 (0~5)', 'Rating (0–5)')}>
                <input type="number" step="0.1" min="0" max="5" value={form.rating} onChange={e => setForm(p => ({ ...p, rating: +e.target.value }))} style={inputStyle} />
              </Field>
              <Field label={L('상태', 'Status')}>
                <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
                  <option value="active">{L('활성', 'Active')}</option>
                  <option value="inactive">{L('비활성', 'Inactive')}</option>
                </select>
              </Field>
              <Field label={L('연락처 이메일', 'Contact email')} span>
                <input value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))}
                  style={inputStyle} placeholder={L('contact@factory.com', 'contact@factory.com')} />
              </Field>
              <Field label={L('전화번호', 'Phone number')}>
                <input value={form.contact_phone} onChange={e => setForm(p => ({ ...p, contact_phone: e.target.value }))}
                  style={inputStyle} placeholder={L('02-1234-5678', '02-1234-5678')} />
              </Field>
              <Field label={L('웹사이트', 'Website')}>
                <input value={form.website} onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                  style={inputStyle} placeholder={L('https://factory.com', 'https://factory.com')} />
              </Field>
              <Field label={L('인증 (콤마 구분)', 'Certifications (comma-separated)')} span>
                <input value={form.certifications} onChange={e => setForm(p => ({ ...p, certifications: e.target.value }))}
                  style={inputStyle} placeholder={L('ISO9001, IATF16949', 'ISO9001, IATF16949')} />
              </Field>
              <Field label={L('설명 (영문)', 'Description (English)')} span>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
              <Field label={L('설명 (한국어)', 'Description (Korean)')} span>
                <textarea value={form.description_ko} onChange={e => setForm(p => ({ ...p, description_ko: e.target.value }))}
                  rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
            </div>

            {/* Processes */}
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, color: C.dim, fontWeight: 600, display: 'block', marginBottom: 8 }}>{L('가공 공정', 'Manufacturing processes')}</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PROCESS_OPTIONS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => toggleProcess(p.value)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600,
                      background: form.processes.includes(p.value) ? '#1f3a5f' : C.card,
                      color: form.processes.includes(p.value) ? '#79c0ff' : C.dim,
                    }}
                  >
                    {optionLabel(p, L)}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
              <button onClick={() => setShowForm(false)} style={{
                padding: '8px 18px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 13,
              }}>{L('취소', 'Cancel')}</button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              }}>
                {saving ? L('저장 중...', 'Saving...') : (editTarget ? L('수정', 'Update') : L('등록', 'Register'))}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #30363d',
  background: '#0d1117', color: '#e6edf3', fontSize: 13, boxSizing: 'border-box',
};

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ gridColumn: span ? '1 / -1' : undefined }}>
      <label style={{ fontSize: 12, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
