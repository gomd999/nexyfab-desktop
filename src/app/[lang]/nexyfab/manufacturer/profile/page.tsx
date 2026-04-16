'use client';

import { use, useEffect, useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FactoryProfile {
  id: string;
  name: string;
  name_ko: string | null;
  region: string;
  processes: string[];
  min_lead_time: number;
  max_lead_time: number;
  certifications: string[];
  description: string | null;
  description_ko: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  status: string;
  partner_email: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_PROCESSES: { value: string; label: string }[] = [
  { value: 'cnc_milling',       label: 'CNC Milling' },
  { value: 'cnc_turning',       label: 'CNC Turning' },
  { value: 'fdm_3d_printing',   label: 'FDM 3D Printing' },
  { value: 'sls_3d_printing',   label: 'SLS 3D Printing' },
  { value: 'injection_molding', label: 'Injection Molding' },
  { value: 'sheet_metal',       label: 'Sheet Metal' },
  { value: 'die_casting',       label: 'Die Casting' },
  { value: 'sand_casting',      label: 'Sand Casting' },
];

const ALL_CERTIFICATIONS: { value: string; label: string }[] = [
  { value: 'ISO9001',   label: 'ISO 9001' },
  { value: 'AS9100',    label: 'AS9100 (Aerospace)' },
  { value: 'IATF16949', label: 'IATF 16949 (Automotive)' },
  { value: 'ISO13485',  label: 'ISO 13485 (Medical)' },
  { value: 'ISO14001',  label: 'ISO 14001 (Environmental)' },
  { value: 'OHSAS18001', label: 'OHSAS 18001 (Safety)' },
  { value: 'RoHS',      label: 'RoHS Compliant' },
  { value: 'REACH',     label: 'REACH Compliant' },
];

const REGIONS = [
  'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines',
  'Singapore', 'China', 'South Korea', 'Japan', 'India', 'Other',
];

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  page: {
    padding: '28px 32px',
    minHeight: '100%',
    background: '#0d1117',
    color: '#c9d1d9',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as React.CSSProperties,
  header: { marginBottom: '28px' } as React.CSSProperties,
  title: { fontSize: '20px', fontWeight: 700, color: '#e6edf3', margin: 0 } as React.CSSProperties,
  subtitle: { fontSize: '13px', color: '#8b949e', marginTop: '4px' } as React.CSSProperties,
  card: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: '10px',
    marginBottom: '24px',
    overflow: 'hidden',
  } as React.CSSProperties,
  cardHeader: {
    padding: '14px 20px',
    borderBottom: '1px solid #30363d',
    fontSize: '13px',
    fontWeight: 600,
    color: '#e6edf3',
  } as React.CSSProperties,
  cardBody: { padding: '20px 24px' } as React.CSSProperties,
  fieldGroup: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '16px',
    marginBottom: '16px',
  } as React.CSSProperties,
  field: { display: 'flex', flexDirection: 'column' as const, gap: '6px' } as React.CSSProperties,
  label: { fontSize: '12px', color: '#8b949e', fontWeight: 500 } as React.CSSProperties,
  input: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#c9d1d9',
    fontSize: '13px',
    outline: 'none',
    transition: 'border-color 0.15s',
  } as React.CSSProperties,
  inputFocus: { borderColor: '#388bfd' } as React.CSSProperties,
  textarea: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#c9d1d9',
    fontSize: '13px',
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: '80px',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  select: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#c9d1d9',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
  } as React.CSSProperties,
  checkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '8px',
  } as React.CSSProperties,
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#c9d1d9',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid transparent',
    transition: 'background 0.15s, border-color 0.15s',
  } as React.CSSProperties,
  checkLabelActive: {
    background: '#1f3a5f',
    border: '1px solid #388bfd55',
  } as React.CSSProperties,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ManufacturerProfilePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = lang === 'ko';

  const [profile, setProfile] = useState<FactoryProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [processes, setProcesses] = useState<string[]>([]);
  const [minLeadTime, setMinLeadTime] = useState('');
  const [maxLeadTime, setMaxLeadTime] = useState('');
  const [certifications, setCertifications] = useState<string[]>([]);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionKo, setDescriptionKo] = useState('');

  // Input focus state for highlight effect
  const [focused, setFocused] = useState<string | null>(null);

  const populateForm = useCallback((f: FactoryProfile) => {
    setName(f.name ?? '');
    setRegion(f.region ?? '');
    setProcesses(f.processes ?? []);
    setMinLeadTime(String(f.min_lead_time ?? ''));
    setMaxLeadTime(String(f.max_lead_time ?? ''));
    setCertifications(f.certifications ?? []);
    setContactEmail(f.contact_email ?? '');
    setContactPhone(f.contact_phone ?? '');
    setDescription(f.description ?? '');
    setDescriptionKo(f.description_ko ?? '');
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/nexyfab/manufacturers/profile');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { factory: FactoryProfile };
      setProfile(json.factory);
      populateForm(json.factory);
    } catch {
      // show empty form on error
    } finally {
      setLoading(false);
    }
  }, [populateForm]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const toggleItem = (val: string, list: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(list.includes(val) ? list.filter((v) => v !== val) : [...list, val]);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setToast({ msg: isKo ? '공장명을 입력해주세요.' : 'Factory name is required.', ok: false });
      setTimeout(() => setToast(null), 3500);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/nexyfab/manufacturers/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          region: region.trim(),
          processes,
          min_lead_time: minLeadTime ? Number(minLeadTime) : undefined,
          max_lead_time: maxLeadTime ? Number(maxLeadTime) : undefined,
          certifications,
          contact_email: contactEmail.trim(),
          contact_phone: contactPhone.trim(),
          description: description.trim(),
          description_ko: descriptionKo.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const json = await res.json() as { factory: FactoryProfile };
      setProfile(json.factory);
      populateForm(json.factory);
      setToast({ msg: isKo ? '프로필이 저장되었습니다.' : 'Profile saved successfully.', ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setToast({ msg: isKo ? `저장 실패: ${msg}` : `Save failed: ${msg}`, ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const inputStyle = (id: string): React.CSSProperties => ({
    ...S.input,
    ...(focused === id ? S.inputFocus : {}),
  });

  return (
    <div style={S.page}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={S.header}>
        <h1 style={S.title}>{isKo ? '파트너 프로필 편집' : 'Partner Profile'}</h1>
        <p style={S.subtitle}>
          {isKo
            ? '제조사 정보를 최신 상태로 유지하여 더 많은 RFQ를 받으세요.'
            : 'Keep your factory profile up to date to receive more RFQ assignments.'}
        </p>
      </div>

      {loading ? (
        <div style={{ color: '#8b949e', fontSize: '14px', padding: '40px 0', textAlign: 'center' }}>
          {isKo ? '불러오는 중…' : 'Loading profile…'}
        </div>
      ) : (
        <>
          {/* ── Basic Info ─────────────────────────────────────────────────── */}
          <div style={S.card}>
            <div style={S.cardHeader}>🏭 {isKo ? '기본 정보' : 'Basic Information'}</div>
            <div style={S.cardBody}>
              <div style={S.fieldGroup}>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '공장명 (EN) *' : 'Factory Name (EN) *'}</label>
                  <input
                    style={inputStyle('name')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={() => setFocused('name')}
                    onBlur={() => setFocused(null)}
                    placeholder={isKo ? '공장 영문명' : 'Factory name in English'}
                  />
                </div>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '지역' : 'Region'}</label>
                  <select
                    style={S.select}
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  >
                    <option value="">{isKo ? '지역 선택' : 'Select region'}</option>
                    {REGIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={S.fieldGroup}>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '최소 리드타임 (일)' : 'Min Lead Time (days)'}</label>
                  <input
                    type="number"
                    min={1}
                    style={inputStyle('min_lt')}
                    value={minLeadTime}
                    onChange={(e) => setMinLeadTime(e.target.value)}
                    onFocus={() => setFocused('min_lt')}
                    onBlur={() => setFocused(null)}
                    placeholder="e.g. 5"
                  />
                </div>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '최대 리드타임 (일)' : 'Max Lead Time (days)'}</label>
                  <input
                    type="number"
                    min={1}
                    style={inputStyle('max_lt')}
                    value={maxLeadTime}
                    onChange={(e) => setMaxLeadTime(e.target.value)}
                    onFocus={() => setFocused('max_lt')}
                    onBlur={() => setFocused(null)}
                    placeholder="e.g. 30"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Processes ──────────────────────────────────────────────────── */}
          <div style={S.card}>
            <div style={S.cardHeader}>⚙️ {isKo ? '가공 공정' : 'Manufacturing Processes'}</div>
            <div style={S.cardBody}>
              <div style={S.checkGrid}>
                {ALL_PROCESSES.map(({ value, label }) => {
                  const active = processes.includes(value);
                  return (
                    <label
                      key={value}
                      style={{ ...S.checkLabel, ...(active ? S.checkLabelActive : {}) }}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleItem(value, processes, setProcesses)}
                        style={{ accentColor: '#388bfd', width: '14px', height: '14px', flexShrink: 0 }}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Certifications ────────────────────────────────────────────── */}
          <div style={S.card}>
            <div style={S.cardHeader}>🏆 {isKo ? '인증' : 'Certifications'}</div>
            <div style={S.cardBody}>
              <div style={S.checkGrid}>
                {ALL_CERTIFICATIONS.map(({ value, label }) => {
                  const active = certifications.includes(value);
                  return (
                    <label
                      key={value}
                      style={{ ...S.checkLabel, ...(active ? S.checkLabelActive : {}) }}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleItem(value, certifications, setCertifications)}
                        style={{ accentColor: '#388bfd', width: '14px', height: '14px', flexShrink: 0 }}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Contact Info ─────────────────────────────────────────────── */}
          <div style={S.card}>
            <div style={S.cardHeader}>📞 {isKo ? '연락처' : 'Contact Information'}</div>
            <div style={S.cardBody}>
              <div style={S.fieldGroup}>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '담당자 이메일' : 'Contact Email'}</label>
                  <input
                    type="email"
                    style={inputStyle('cemail')}
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    onFocus={() => setFocused('cemail')}
                    onBlur={() => setFocused(null)}
                    placeholder="contact@factory.com"
                  />
                </div>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '전화번호' : 'Phone Number'}</label>
                  <input
                    type="tel"
                    style={inputStyle('cphone')}
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    onFocus={() => setFocused('cphone')}
                    onBlur={() => setFocused(null)}
                    placeholder="+60 12-345 6789"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Description ───────────────────────────────────────────────── */}
          <div style={S.card}>
            <div style={S.cardHeader}>📝 {isKo ? '업체 소개' : 'Description'}</div>
            <div style={S.cardBody}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '영문 소개' : 'Description (English)'}</label>
                  <textarea
                    style={{ ...S.textarea, ...(focused === 'desc' ? { borderColor: '#388bfd' } : {}) }}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onFocus={() => setFocused('desc')}
                    onBlur={() => setFocused(null)}
                    placeholder={isKo ? '영문으로 제조사를 소개해주세요.' : 'Describe your factory in English…'}
                    rows={4}
                  />
                </div>
                <div style={S.field}>
                  <label style={S.label}>{isKo ? '한국어 소개' : 'Description (Korean)'}</label>
                  <textarea
                    style={{ ...S.textarea, ...(focused === 'desc_ko' ? { borderColor: '#388bfd' } : {}) }}
                    value={descriptionKo}
                    onChange={(e) => setDescriptionKo(e.target.value)}
                    onFocus={() => setFocused('desc_ko')}
                    onBlur={() => setFocused(null)}
                    placeholder={isKo ? '한국어로 제조사를 소개해주세요.' : 'Describe your factory in Korean…'}
                    rows={4}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Save Bar ──────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '16px 24px',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '10px',
            marginBottom: '32px',
          }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: saving ? '#1a3025' : '#238636',
                border: '1px solid #2ea043',
                borderRadius: '6px',
                padding: '9px 22px',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
                transition: 'background 0.15s',
              }}
            >
              {saving ? (isKo ? '저장 중…' : 'Saving…') : (isKo ? '프로필 저장' : 'Save Profile')}
            </button>

            {profile && (
              <button
                onClick={loadProfile}
                style={{
                  background: 'transparent',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '9px 16px',
                  color: '#8b949e',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {isKo ? '변경 취소' : 'Reset'}
              </button>
            )}

            {toast && (
              <span style={{
                fontSize: '13px',
                color: toast.ok ? '#3fb950' : '#f85149',
                padding: '6px 12px',
                background: toast.ok ? '#3fb95022' : '#f8514922',
                border: `1px solid ${toast.ok ? '#3fb95044' : '#f8514944'}`,
                borderRadius: '6px',
              }}>
                {toast.ok ? '✓ ' : '✗ '}{toast.msg}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
