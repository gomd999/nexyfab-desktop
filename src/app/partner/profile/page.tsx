'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/useToast';
import {
  DEFAULT_PRICEBOOK, DEFAULT_CAPABILITY,
  type PriceBook, type ProcessCapability,
} from '@/lib/partner-pricebook';
import PriceBookEditor from './PriceBookEditor';
import CapabilityEditor from './CapabilityEditor';
import { usePartnerLang } from '../_lib/partnerLang';
import { profileDict, type ProfileDict } from '../_lib/dicts/profile';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
}

interface Profile {
  partnerId: string;
  email: string;
  company: string;
  name: string;
  phone: string;
  homepage: string;
  bio: string;
  processes: string[];
  certifications: string[];
  tech_exp: string;
  match_field: string;
  amount: string;
  partner_type: string;
  status: string;
  avatarUrl?: string;
  priceBook?: PriceBook;
  processCapability?: ProcessCapability;
}

type TabKey = 'profile' | 'pricebook' | 'capability';

interface ReviewSummary {
  avgRating: number;
  avgDeadline: number;
  avgQuality: number;
  avgCommunication: number;
  count: number;
}

const ISO_OPTIONS = ['ISO9001', 'ISO14001', 'IATF16949', 'AS9100'];

// PRESET_PROCESSES uses Korean canonical labels. Localising the catalog
// itself is a separate decision (partner-ops + factory data). For now we
// pass through as-is so saved records remain comparable across locales.
const PRESET_PROCESSES = ['CNC가공', '판금', '도금', '사출성형', '3D프린팅', '레이저커팅', '용접', '열처리', '표면처리', '주조'];

function StarDisplay({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} aria-hidden="true" className={`text-base leading-none ${i < Math.round(value) ? 'text-yellow-400' : 'text-gray-200'}`}>★</span>
      ))}
    </span>
  );
}

function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-700 w-6 shrink-0">{value.toFixed(1)}</span>
    </div>
  );
}

function ProfileView({ profile, avatarUrl, onEdit, t }: {
  profile: Profile; avatarUrl: string | null; onEdit: () => void; t: ProfileDict;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-bold text-gray-900">{t.cardTitle}</h2>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
          title={t.cardEditTitle}
        >
          <PencilIcon />
          {t.cardEdit}
        </button>
      </div>

      <div className="px-6 py-5 flex items-start gap-5 border-b border-gray-100">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 flex items-center justify-center">
          {avatarUrl
            ? <Image src={avatarUrl} alt="logo" fill className="object-cover" sizes="64px" unoptimized />
            : <span aria-hidden="true" className="text-2xl text-gray-400">🏭</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-black text-gray-900 truncate">{profile.company || '—'}</h3>
          {profile.name && <p className="text-sm text-gray-500 mt-0.5">{t.contactPersonPrefix} {profile.name}</p>}
          {profile.email && <p className="text-xs text-gray-400 mt-0.5">{profile.email}</p>}
          {profile.phone && <p className="text-xs text-gray-400">{profile.phone}</p>}
          {profile.homepage && (
            <a href={profile.homepage} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline">{profile.homepage}</a>
          )}
        </div>
      </div>

      {profile.processes && profile.processes.length > 0 && (
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">{t.sectionProcesses}</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.processes.map(p => (
              <span key={p} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {profile.certifications && profile.certifications.length > 0 && (
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">{t.sectionCerts}</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.certifications.map(c => (
              <span key={c} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                ✓ {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {profile.bio && (
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">{t.sectionBio}</p>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{profile.bio}</p>
        </div>
      )}
    </div>
  );
}

interface FormState {
  company: string;
  name: string;
  phone: string;
  homepage: string;
  bio: string;
  processes: string[];
  certifications: string[];
  tech_exp: string;
  match_field: string;
  amount: string;
  partner_type: string;
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 1.5L12.5 4.5L5 12H2V9L9.5 1.5Z" />
    </svg>
  );
}

function ProfileEditForm({
  form, email, avatarUrl,
  setForm, onSave, onCancel, saving, onAvatarClick, avatarInputRef, t,
}: {
  form: FormState;
  email: string;
  avatarUrl: string | null;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  onAvatarClick: () => void;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  t: ProfileDict;
}) {
  const [processInput, setProcessInput] = useState('');

  function addProcess(tag: string) {
    const tt = tag.trim();
    if (!tt || form.processes.includes(tt)) return;
    setForm(f => ({ ...f, processes: [...f.processes, tt] }));
    setProcessInput('');
  }

  function removeProcess(tag: string) {
    setForm(f => ({ ...f, processes: f.processes.filter(p => p !== tag) }));
  }

  function toggleCert(cert: string) {
    setForm(f => ({
      ...f,
      certifications: f.certifications.includes(cert)
        ? f.certifications.filter(c => c !== cert)
        : [...f.certifications, cert],
    }));
  }

  return (
    <form onSubmit={onSave} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-bold text-gray-900">{t.editTitle}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
        >
          {t.cardCancel}
        </button>
      </div>

      <div className="px-6 py-6 space-y-6">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onAvatarClick}
            className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-gray-100 flex items-center justify-center transition-colors hover:border-blue-400"
            title={t.logoAreaTitle}
          >
            {avatarUrl
              ? <Image src={avatarUrl} alt="logo" fill className="object-cover" sizes="64px" unoptimized />
              : <span aria-hidden="true" className="text-2xl text-gray-400">🏭</span>
            }
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-xs font-bold">{t.logoChangeLabel}</span>
            </div>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
          />
          <div>
            <p className="text-sm font-semibold text-gray-700">{t.logoAreaTitle}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t.logoAreaHint}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.fieldCompany}</label>
            <input
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              placeholder={t.fieldCompanyPlaceholder}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.fieldContact}</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t.fieldContactPlaceholder}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.fieldEmail}</label>
            <input
              value={email}
              readOnly
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.fieldPhone}</label>
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder={t.fieldPhonePlaceholder}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.fieldHomepage}</label>
            <input
              value={form.homepage}
              onChange={e => setForm(f => ({ ...f, homepage: e.target.value }))}
              placeholder="https://example.com"
              type="url"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.fieldBio}</label>
            <textarea
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              rows={4}
              placeholder={t.fieldBioPlaceholder}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition resize-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">{t.sectionProcesses}</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_PROCESSES.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => addProcess(p)}
                disabled={form.processes.includes(p)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors
                  ${form.processes.includes(p)
                    ? 'bg-blue-50 text-blue-700 border-blue-200 cursor-default'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'
                  }`}
              >
                {form.processes.includes(p) ? `✓ ${p}` : `+ ${p}`}
              </button>
            ))}
          </div>
          {form.processes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.processes.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white">
                  {p}
                  <button
                    type="button"
                    onClick={() => removeProcess(p)}
                    aria-label="remove"
                    className="ml-0.5 opacity-70 hover:opacity-100 leading-none text-sm"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={processInput}
              onChange={e => setProcessInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProcess(processInput); } }}
              placeholder={t.inputAddPlaceholder}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button
              type="button"
              onClick={() => addProcess(processInput)}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl transition"
            >
              {t.btnAdd}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">{t.sectionCerts}</label>
          <div className="flex flex-wrap gap-3">
            {ISO_OPTIONS.map(cert => (
              <label key={cert} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.certifications.includes(cert)}
                  onChange={() => toggleCert(cert)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className={`text-sm font-semibold transition-colors
                  ${form.certifications.includes(cert) ? 'text-emerald-700' : 'text-gray-600 group-hover:text-gray-900'}`}>
                  {cert}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition"
          >
            {t.btnCancel}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
          >
            {saving ? t.btnSaving : t.btnSave}
          </button>
        </div>
      </div>
    </form>
  );
}

export default function PartnerProfilePage() {
  const router = useRouter();
  const lang = usePartnerLang();
  const t = profileDict(lang);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<FormState>({
    company: '', name: '', phone: '', homepage: '', bio: '',
    processes: [], certifications: [],
    tech_exp: '', match_field: '', amount: '', partner_type: '',
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>('profile');
  const [priceBook, setPriceBook] = useState<PriceBook>(DEFAULT_PRICEBOOK);
  const [capability, setCapability] = useState<ProcessCapability>(DEFAULT_CAPABILITY);
  const toast = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const getSession = () => localStorage.getItem('partnerSession') || '';

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace(`/partner/login?lang=${lang}`); return; }

    if (session === 'demo') {
      const demoProfile: Profile = {
        partnerId: 'demo-partner-001',
        email: 'demo-partner@nexyfab.com',
        company: 'Demo 제조사',
        name: '김철수',
        phone: '02-0000-0000',
        homepage: 'https://example.com',
        bio: '정밀 CNC 가공 전문 업체입니다. 다양한 금속 소재 가공 경험 보유.',
        processes: ['CNC가공', '판금', '도금'],
        certifications: ['ISO9001'],
        tech_exp: 'CNC가공, 판금',
        match_field: '정밀가공',
        amount: '10000000',
        partner_type: '제조사',
        status: 'active',
      };
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setProfile(demoProfile);
      setForm({
        company: demoProfile.company,
        name: demoProfile.name,
        phone: demoProfile.phone,
        homepage: demoProfile.homepage,
        bio: demoProfile.bio,
        processes: demoProfile.processes,
        certifications: demoProfile.certifications,
        tech_exp: demoProfile.tech_exp,
        match_field: demoProfile.match_field,
        amount: demoProfile.amount,
        partner_type: demoProfile.partner_type,
      });
      setLoading(false);
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(async d => {
        if (!d.valid) { router.replace(`/partner/login?lang=${lang}`); return; }
        setPartner(d.partner);

        const profileRes = await fetch('/api/partner/profile', {
          headers: { Authorization: `Bearer ${session}` },
        });
        const profileData = await profileRes.json();
        if (profileData?.profile) {
          const p: Profile = profileData.profile;
          setProfile(p);
          setAvatarUrl(p.avatarUrl ?? null);
          if (p.priceBook) setPriceBook(p.priceBook);
          if (p.processCapability) setCapability(p.processCapability);
          setForm({
            company: p.company || '',
            name: p.name || '',
            phone: p.phone || '',
            homepage: p.homepage || '',
            bio: p.bio || '',
            processes: Array.isArray(p.processes) ? p.processes : [],
            certifications: Array.isArray(p.certifications) ? p.certifications : [],
            tech_exp: p.tech_exp || '',
            match_field: p.match_field || '',
            amount: p.amount || '',
            partner_type: p.partner_type || '',
          });

          if (d.partner?.email) {
            const reviewRes = await fetch(`/api/reviews?summary=1&partnerEmail=${encodeURIComponent(d.partner.email)}`).catch(() => null);
            if (reviewRes?.ok) setReviewSummary(await reviewRes.json());
          }
        }
      })
      .catch(() => router.replace(`/partner/login?lang=${lang}`))
      .finally(() => setLoading(false));
  }, [router, lang]);

  useEffect(() => {
    const el = avatarInputRef.current;
    if (!el) return;
    const handler = async () => {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast.error(t.toastImageTooBig);
        return;
      }
      const url = URL.createObjectURL(file);
      setAvatarUrl(url);

      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/partner/profile/avatar', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getSession()}` },
          body: fd,
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.url) setAvatarUrl(data.url);
          toast.success(t.toastLogoSaved);
        } else {
          toast.error(t.toastLogoFailed);
        }
      } catch {
        toast.error(t.toastLogoError);
      }
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, [toast, t]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setProfile(prev => prev ? { ...prev, ...form } : null);
      setEditMode(false);
      toast.success(t.toastProfileSaved);
    } catch {
      toast.error(t.toastProfileFailed);
    } finally {
      setSaving(false);
    }
  }

  async function savePriceBook() {
    if (getSession() === 'demo') {
      toast.success(t.toastDemoPricebook);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify({ priceBook }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as
          { error?: string; issues?: Array<{ path: string; message: string }> };
        const detail = data.issues?.length
          ? data.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join(' · ')
          : '';
        toast.error(detail
          ? `${t.toastPricebookValidationPrefix} — ${detail}`
          : (data.error || t.toastPricebookFailed));
        return;
      }
      toast.success(t.toastPricebookSaved);
    } catch {
      toast.error(t.toastPricebookFailed);
    } finally {
      setSaving(false);
    }
  }

  async function saveCapability() {
    if (getSession() === 'demo') {
      toast.success(t.toastDemoCapability);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify({ processCapability: capability }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as
          { error?: string; issues?: Array<{ path: string; message: string }> };
        const detail = data.issues?.length
          ? data.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join(' · ')
          : '';
        toast.error(detail
          ? `${t.toastCapabilityValidationPrefix} — ${detail}`
          : (data.error || t.toastCapabilityFailed));
        return;
      }
      toast.success(t.toastCapabilitySaved);
    } catch {
      toast.error(t.toastCapabilityFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">{t.loading}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">{t.pageTitle}</h1>
            <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
          </div>

          <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl">
            {([
              { key: 'profile',    label: t.tabProfile },
              { key: 'pricebook',  label: t.tabPriceBook },
              { key: 'capability', label: t.tabCapability },
            ] as { key: TabKey; label: string }[]).map(tt => (
              <button
                key={tt.key}
                onClick={() => setTab(tt.key)}
                className={`flex-1 px-3 py-2 text-sm font-bold rounded-lg transition-colors
                  ${tab === tt.key
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'}`}
              >
                {tt.label}
              </button>
            ))}
          </div>

          {tab === 'profile' && <>
          {reviewSummary && reviewSummary.count > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-900">{t.reviewTitle}</h2>
                <span className="text-xs text-gray-400">{t.reviewCountSuffix(reviewSummary.count)}</span>
              </div>
              <div className="flex items-center gap-4 mb-4">
                <div className="text-center">
                  <div className="text-4xl font-black text-gray-900">{reviewSummary.avgRating.toFixed(1)}</div>
                  <StarDisplay value={reviewSummary.avgRating} />
                  <p className="text-xs text-gray-400 mt-1">{t.reviewAvgLabel}</p>
                </div>
                <div className="flex-1 space-y-2">
                  <RatingBar label={t.reviewLabelDeadline} value={reviewSummary.avgDeadline} />
                  <RatingBar label={t.reviewLabelQuality} value={reviewSummary.avgQuality} />
                  <RatingBar label={t.reviewLabelCommunication} value={reviewSummary.avgCommunication} />
                </div>
              </div>
            </div>
          )}

          {reviewSummary && reviewSummary.count === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 mb-4">
              <p className="text-sm text-gray-400">{t.reviewEmpty}</p>
            </div>
          )}

          {editMode ? (
            <ProfileEditForm
              form={form}
              email={partner?.email ?? profile?.email ?? ''}
              avatarUrl={avatarUrl}
              setForm={setForm}
              onSave={handleSave}
              onCancel={() => setEditMode(false)}
              saving={saving}
              onAvatarClick={() => avatarInputRef.current?.click()}
              avatarInputRef={avatarInputRef}
              t={t}
            />
          ) : profile ? (
            <ProfileView
              profile={{ ...profile, ...form }}
              avatarUrl={avatarUrl}
              onEdit={() => setEditMode(true)}
              t={t}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-8 text-center">
              <p className="text-gray-400 text-sm mb-4">{t.emptyProfileTitle}</p>
              <button
                onClick={() => setEditMode(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition"
              >
                {t.emptyProfileCta}
              </button>
            </div>
          )}
          </>}

          {tab === 'pricebook' && (
            <PriceBookEditor
              value={priceBook}
              onChange={setPriceBook}
              onSave={savePriceBook}
              saving={saving}
            />
          )}

          {tab === 'capability' && (
            <CapabilityEditor
              value={capability}
              onChange={setCapability}
              onSave={saveCapability}
              saving={saving}
            />
          )}
        </div>
      </main>
    </div>
  );
}
