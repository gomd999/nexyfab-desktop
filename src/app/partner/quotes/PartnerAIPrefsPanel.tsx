'use client';

/**
 * PartnerAIPrefsPanel — AI 견적 기본값 설정 모달.
 * 시간당 단가, 재료 마진, 보유 공정, 인증서를 저장.
 * 서버(/api/partner/profile)와 localStorage 동시 저장.
 */

import { useEffect, useState } from 'react';

export interface AiPrefs {
  hourlyRateKrw: number;
  materialMargin: number;
  leadCapacityDays?: number;
  processes: string[];
  certifications: string[];
}

interface Props {
  session: string;
  initial?: Partial<AiPrefs>;
  onSave: (prefs: AiPrefs) => void;
  onClose: () => void;
}

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d', border: '#30363d',
  text: '#e6edf3', textDim: '#8b949e', textMuted: '#6e7681',
  accent: '#388bfd', green: '#3fb950', yellow: '#d29922', red: '#f85149',
};

const PROCESS_LIST = [
  'CNC 밀링', 'CNC 선반', '사출 성형', '판금 가공',
  '주조', '3D 프린팅', '방전 가공', '용접', '표면처리',
];

const CERT_LIST = [
  'ISO 9001', 'ISO 14001', 'IATF 16949', 'AS9100',
  'ISO 13485', 'CE', 'UL', 'RoHS',
];

export function loadLocalAiPrefs(): Partial<AiPrefs> {
  try {
    const raw = localStorage.getItem('partnerAiPrefs');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveLocalAiPrefs(prefs: AiPrefs) {
  try { localStorage.setItem('partnerAiPrefs', JSON.stringify(prefs)); } catch { /* ignore */ }
}

export default function PartnerAIPrefsPanel({ session, initial, onSave, onClose }: Props) {
  const [hourlyRate, setHourlyRate] = useState(initial?.hourlyRateKrw ?? 80000);
  const [materialMargin, setMaterialMargin] = useState(initial?.materialMargin ?? 0.35);
  const [leadCapacityDays, setLeadCapacityDays] = useState<number | ''>(initial?.leadCapacityDays ?? '');
  const [processes, setProcesses] = useState<string[]>(initial?.processes ?? []);
  const [certifications, setCertifications] = useState<string[]>(initial?.certifications ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggleProcess = (p: string) =>
    setProcesses(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const toggleCert = (c: string) =>
    setCertifications(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  async function handleSave() {
    const prefs: AiPrefs = {
      hourlyRateKrw: hourlyRate,
      materialMargin,
      leadCapacityDays: leadCapacityDays === '' ? undefined : leadCapacityDays,
      processes,
      certifications,
    };
    setSaving(true);
    saveLocalAiPrefs(prefs);
    try {
      await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ aiPrefs: prefs }),
      });
    } catch { /* 네트워크 실패 시 localStorage만 저장 */ }
    setSaving(false);
    setSaved(true);
    onSave(prefs);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9400, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚙️</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>AI 견적 기본값 설정</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>저장하면 RFQ 회신 초안에 자동으로 적용됩니다.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 원가 설정 */}
          <div>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: C.textDim }}>원가 기준</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 5 }}>시간당 단가 (KRW/hr)</label>
                <input
                  type="number"
                  value={hourlyRate}
                  onChange={e => setHourlyRate(Number(e.target.value))}
                  min={0}
                  step={1000}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 13, background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 5 }}>재료 마진 (0 ~ 1)</label>
                <input
                  type="number"
                  value={materialMargin}
                  onChange={e => setMaterialMargin(Number(e.target.value))}
                  min={0} max={1} step={0.05}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 13, background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 5 }}>현재 가용 납기 (일, 선택)</label>
                <input
                  type="number"
                  value={leadCapacityDays}
                  onChange={e => setLeadCapacityDays(e.target.value ? Number(e.target.value) : '')}
                  min={1}
                  placeholder="비워두면 무제한"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 13, background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>

          {/* 공정 선택 */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.textDim }}>보유 공정</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PROCESS_LIST.map(p => {
                const active = processes.includes(p);
                return (
                  <button key={p} onClick={() => toggleProcess(p)} style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${active ? C.accent : C.border}`,
                    background: active ? `${C.accent}20` : 'transparent',
                    color: active ? C.accent : C.textMuted,
                  }}>{p}</button>
                );
              })}
            </div>
          </div>

          {/* 인증서 선택 */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.textDim }}>보유 인증</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CERT_LIST.map(c => {
                const active = certifications.includes(c);
                return (
                  <button key={c} onClick={() => toggleCert(c)} style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${active ? C.green : C.border}`,
                    background: active ? `${C.green}20` : 'transparent',
                    color: active ? C.green : C.textMuted,
                  }}>{c}</button>
                );
              })}
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 10, color: C.textMuted }}>
            💡 이 설정은 서버와 기기에 모두 저장됩니다. RFQ 회신 패널에서 자동으로 불러옵니다.
          </p>
        </div>

        {/* 푸터 */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', gap: 8 }}>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              flex: 1, padding: 10, borderRadius: 8, border: 'none',
              background: saved ? C.green : saving ? `${C.accent}66` : C.accent,
              color: '#fff', fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saved ? '✓ 저장됨' : saving ? '저장 중...' : '💾 저장'}
          </button>
          <button
            onClick={onClose}
            style={{ padding: '10px 18px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 13, cursor: 'pointer' }}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
