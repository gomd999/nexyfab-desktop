'use client';

import { useEffect, useState, useCallback } from 'react';

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
  { value: 'cnc_milling',       label: 'CNC 밀링' },
  { value: 'cnc_turning',       label: 'CNC 선삭' },
  { value: 'injection_molding', label: '사출 성형' },
  { value: 'sheet_metal',       label: '판금' },
  { value: 'casting',           label: '주조' },
  { value: '3d_printing',       label: '3D 프린팅' },
  { value: 'welding',           label: '용접' },
  { value: 'surface_treatment', label: '표면처리' },
];

const REGION_OPTIONS = [
  { value: 'KR', label: '🇰🇷 한국' },
  { value: 'US', label: '🇺🇸 미국' },
  { value: 'DE', label: '🇩🇪 독일' },
  { value: 'JP', label: '🇯🇵 일본' },
  { value: 'CN', label: '🇨🇳 중국' },
  { value: 'TW', label: '🇹🇼 대만' },
  { value: 'VN', label: '🇻🇳 베트남' },
];

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
    if (!form.name.trim()) { showToast('제조사명을 입력하세요.'); return; }
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
        showToast(d.error || '저장 실패');
        return;
      }
      showToast(editTarget ? '수정됐습니다.' : '등록됐습니다.');
      setShowForm(false);
      fetchFactories();
    } catch { showToast('오류가 발생했습니다.'); } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}"을(를) 삭제하시겠습니까?`)) return;
    try {
      await fetch(`/api/admin/factories/${id}`, { method: 'DELETE' });
      showToast('삭제됐습니다.');
      fetchFactories();
    } catch { showToast('삭제 실패'); }
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
      showToast(data.message || `${data.seeded}개 제조사를 불러왔습니다.`);
      fetchFactories();
    } catch { showToast('씨딩 실패'); } finally {
      setSeeding(false);
    }
  };

  const priceLevelLabel: Record<string, string> = { low: '저가', medium: '중가', high: '고가' };

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
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🏭 제조사 관리</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>
            {factories.length}개 제조사
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
            {seeding ? '불러오는 중...' : '기본 데이터 씨딩'}
          </button>
          <button
            onClick={openCreate}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: C.accent, color: '#fff', cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
            }}
          >
            + 제조사 등록
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="이름, 이메일 검색..."
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
          <option value="all">전체 지역</option>
          {REGION_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13 }}
        >
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.dim }}>불러오는 중...</div>
      ) : factories.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.dim }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>등록된 제조사가 없습니다.</p>
          <button onClick={handleSeed} style={{ padding: '8px 16px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}>
            기본 데이터 씨딩
          </button>
        </div>
      ) : (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['제조사명', '지역', '공정', '납기(일)', '평점', '가격대', '연락처', '상태', '액션'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: C.dim, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
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
                    {REGION_OPTIONS.find(r => r.value === f.region)?.label ?? f.region}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {f.processes.slice(0, 3).map(p => (
                        <span key={p} style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: '#1f3a5f', color: '#79c0ff', fontWeight: 600,
                        }}>
                          {PROCESS_OPTIONS.find(o => o.value === p)?.label ?? p}
                        </span>
                      ))}
                      {f.processes.length > 3 && <span style={{ fontSize: 10, color: C.dim }}>+{f.processes.length - 3}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', color: C.dim }}>{f.min_lead_time}~{f.max_lead_time}일</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: C.yellow, fontWeight: 700 }}>★ {f.rating.toFixed(1)}</span>
                    <span style={{ color: C.dim, fontSize: 11 }}> ({f.review_count})</span>
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
                      {f.status === 'active' ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(f)} style={{
                        padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
                        background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 12,
                      }}>편집</button>
                      <button onClick={() => handleDelete(f.id, f.name)} style={{
                        padding: '4px 10px', borderRadius: 6, border: `1px solid #3d1f1f`,
                        background: 'transparent', color: C.red, cursor: 'pointer', fontSize: 12,
                      }}>삭제</button>
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
              {editTarget ? '제조사 수정' : '제조사 등록'}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="제조사명 *">
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  style={inputStyle} placeholder="KoreaPrecision Co." />
              </Field>
              <Field label="한국어 이름">
                <input value={form.name_ko} onChange={e => setForm(p => ({ ...p, name_ko: e.target.value }))}
                  style={inputStyle} placeholder="코리아프리시전" />
              </Field>
              <Field label="지역">
                <select value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} style={inputStyle}>
                  {REGION_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="가격대">
                <select value={form.price_level} onChange={e => setForm(p => ({ ...p, price_level: e.target.value }))} style={inputStyle}>
                  <option value="low">저가</option>
                  <option value="medium">중가</option>
                  <option value="high">고가</option>
                </select>
              </Field>
              <Field label="최소 납기 (일)">
                <input type="number" value={form.min_lead_time} onChange={e => setForm(p => ({ ...p, min_lead_time: +e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="최대 납기 (일)">
                <input type="number" value={form.max_lead_time} onChange={e => setForm(p => ({ ...p, max_lead_time: +e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="평점 (0~5)">
                <input type="number" step="0.1" min="0" max="5" value={form.rating} onChange={e => setForm(p => ({ ...p, rating: +e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="상태">
                <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
                  <option value="active">활성</option>
                  <option value="inactive">비활성</option>
                </select>
              </Field>
              <Field label="연락처 이메일" span>
                <input value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))}
                  style={inputStyle} placeholder="contact@factory.com" />
              </Field>
              <Field label="전화번호">
                <input value={form.contact_phone} onChange={e => setForm(p => ({ ...p, contact_phone: e.target.value }))}
                  style={inputStyle} placeholder="02-1234-5678" />
              </Field>
              <Field label="웹사이트">
                <input value={form.website} onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                  style={inputStyle} placeholder="https://factory.com" />
              </Field>
              <Field label="인증 (콤마 구분)" span>
                <input value={form.certifications} onChange={e => setForm(p => ({ ...p, certifications: e.target.value }))}
                  style={inputStyle} placeholder="ISO9001, IATF16949" />
              </Field>
              <Field label="설명 (영문)" span>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
              <Field label="설명 (한국어)" span>
                <textarea value={form.description_ko} onChange={e => setForm(p => ({ ...p, description_ko: e.target.value }))}
                  rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
            </div>

            {/* Processes */}
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, color: C.dim, fontWeight: 600, display: 'block', marginBottom: 8 }}>가공 공정</label>
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
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
              <button onClick={() => setShowForm(false)} style={{
                padding: '8px 18px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 13,
              }}>취소</button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              }}>
                {saving ? '저장 중...' : (editTarget ? '수정' : '등록')}
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
