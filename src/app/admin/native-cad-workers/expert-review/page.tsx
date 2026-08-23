'use client';
import { useAdminI18n } from '../../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { formatDate } from '@/lib/i18n/format';

import { useEffect, useMemo, useState } from 'react';
import { buildNativeCadUnsignedSignoff, parseNativeCadSignatureResponse, serializeNativeCadUnsignedSignoff, type NativeCadClientReviewDecision, type NativeCadClientReviewRole, type NativeCadUnsignedSignoff } from '@/lib/reference/nativeCadReviewClient';

interface ReviewPacket {
  schema: 'nexyfab.native-cad-expert-review-packet.v1';
  target: { sourceHash: string; artifactHashes: string[]; jointDefinitionHash: string; verificationInputHash: string; revision: number };
  targetHash: string;
}
interface SignoffDraft { reviewerId: string; decision: NativeCadClientReviewDecision; unsigned?: NativeCadUnsignedSignoff; signature: string }
interface Validation { schema: string; generatedAt: string; targetHash: string | null; trustedReviewerKeyCount: number; approved: boolean; errors: string[] }
interface RegistryReadiness { reviewerKeyCount: number; domainEligibleCount: number; independentEligibleCount: number; distinctPairAvailable: boolean }

const ROLES: NativeCadClientReviewRole[] = ['domain-reviewer', 'independent-reviewer'];
const SHA256 = /^[a-f0-9]{64}$/;
const initialDraft = (): SignoffDraft => ({ reviewerId: '', decision: 'approved', signature: '' });
const download = (name: string, text: string) => { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); };

export default function NativeCadExpertReviewPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const roleLabel = (role: NativeCadClientReviewRole) => role === 'domain-reviewer'
    ? L('도메인 검토자', 'Domain reviewer')
    : L('독립 검토자', 'Independent reviewer');
  const [packet, setPacket] = useState<ReviewPacket | null>(null);
  const [drafts, setDrafts] = useState<Record<NativeCadClientReviewRole, SignoffDraft>>({ 'domain-reviewer': initialDraft(), 'independent-reviewer': initialDraft() });
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState<Validation | null>(null);
  const [registry, setRegistry] = useState<RegistryReadiness | null>(null);
  useEffect(() => { let active = true; void fetch('/api/admin/native-cad-workers/expert-review', { credentials: 'include', cache: 'no-store' }).then(response => response.ok ? response.json() : null).then((value: { registry?: RegistryReadiness } | null) => { if (active && value?.registry) setRegistry(value.registry); }).catch(() => undefined); return () => { active = false; }; }, []);
  const setDraft = (role: NativeCadClientReviewRole, patch: Partial<SignoffDraft>, resetUnsigned = false) => setDrafts(current => ({ ...current, [role]: { ...current[role], ...patch, ...(resetUnsigned ? { unsigned: undefined, signature: '' } : {}) } }));
  const review = useMemo(() => packet && ROLES.every(role => drafts[role].unsigned && drafts[role].signature.trim()) ? { schema: 'nexyfab.native-cad-expert-review.v1' as const, target: packet.target, signoffs: ROLES.map(role => ({ ...drafts[role].unsigned!, signature: drafts[role].signature.trim() })) } : null, [packet, drafts]);

  async function loadPacket(file?: File) {
    setValidation(null); setMessage(''); setPacket(null); setDrafts({ 'domain-reviewer': initialDraft(), 'independent-reviewer': initialDraft() });
    if (!file) return;
    if (file.size > 512 * 1024) { setMessage(L('패킷은 512 KiB 이하여야 합니다.', 'The packet must be no larger than 512 KiB.')); return; }
    try { const parsed = JSON.parse(await file.text()) as ReviewPacket; if (parsed.schema !== 'nexyfab.native-cad-expert-review-packet.v1' || !SHA256.test(parsed.targetHash) || !parsed.target || !SHA256.test(parsed.target.sourceHash) || !SHA256.test(parsed.target.jointDefinitionHash) || !SHA256.test(parsed.target.verificationInputHash) || !Array.isArray(parsed.target.artifactHashes) || !parsed.target.artifactHashes.length || parsed.target.artifactHashes.some(hash => !SHA256.test(hash)) || !Number.isInteger(parsed.target.revision) || parsed.target.revision < 1) throw new Error(); setPacket(parsed); }
    catch { setMessage(L('올바른 Native CAD 전문가 검토 패킷이 아닙니다.', 'This is not a valid Native CAD expert-review packet.')); }
  }
  function exportPayload(role: NativeCadClientReviewRole) {
    if (!packet || !drafts[role].reviewerId.trim()) return;
    const unsigned = buildNativeCadUnsignedSignoff({ role, reviewerId: drafts[role].reviewerId, decision: drafts[role].decision, reviewedAt: new Date().toISOString(), targetHash: packet.targetHash });
    setDraft(role, { unsigned, signature: '' });
    download(`${packet.targetHash}.${role}.signing-payload.json`, serializeNativeCadUnsignedSignoff(unsigned));
  }
  async function loadSignatureResponse(role: NativeCadClientReviewRole, file?: File) {
    setValidation(null); setMessage('');
    if (!packet || !file) return;
    if (file.size > 64 * 1024) { setMessage(L(`${roleLabel(role)} 응답 파일이 너무 큽니다.`, `The ${roleLabel(role)} response file is too large.`)); return; }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const checked = parseNativeCadSignatureResponse(parsed, { role, targetHash: packet.targetHash, unsigned: drafts[role].unsigned });
      if (!checked.ok) { setMessage(L(`${roleLabel(role)} 응답 거부: ${checked.error}`, `${roleLabel(role)} response rejected: ${checked.error}`)); return; }
      const { signature, ...unsigned } = checked.response.signoff;
      setDrafts(current => ({ ...current, [role]: { reviewerId: unsigned.reviewerId, decision: unsigned.decision, unsigned, signature } }));
    } catch { setMessage(L(`${roleLabel(role)} 서명 응답 JSON을 읽을 수 없습니다.`, `Unable to read the ${roleLabel(role)} signature-response JSON.`)); }
  }
  async function validate() {
    if (!packet || !review) return;
    setMessage(L('서버 공개키로 검증 중…', 'Validating with server public keys…')); setValidation(null);
    const response = await fetch('/api/admin/native-cad-workers/expert-review', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packet, review }) });
    const result = await response.json().catch(() => null) as { validation?: Validation; error?: string } | null;
    if (!response.ok || !result?.validation) { setMessage(result?.error ?? L(`검증 실패 (${response.status})`, `Validation failed (${response.status})`)); return; }
    setValidation(result.validation); setMessage('');
  }

  return <main className="mx-auto max-w-5xl px-5 py-8">
    <h1 className="text-2xl font-bold text-gray-950">{L('Native CAD 전문가 서명', 'Native CAD expert sign-off')}</h1>
    <p className="mt-2 text-sm text-gray-600">{L('개인키는 이 화면에 입력하지 않습니다. 정확한 서명 대상 파일을 내려받아 승인된 오프라인 Ed25519 도구로 서명한 뒤 Base64 서명만 회수합니다.', 'Never enter private keys on this screen. Download the exact signing payload, sign it with an approved offline Ed25519 tool, then return only the Base64 signature.')}</p>
    <div className={`mt-4 rounded-xl border p-4 text-sm ${registry?.distinctPairAvailable ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{registry ? <>{registry.distinctPairAvailable ? L('역할 분리 검토자 등록부 준비 완료', 'Segregated-role reviewer registry is ready') : L('역할 분리 검토자 등록부 미완료', 'Segregated-role reviewer registry is not ready')} <span className="ml-2 text-xs opacity-75">{L(`등록 키 ${registry.reviewerKeyCount} · 도메인 가능 ${registry.domainEligibleCount} · 독립 가능 ${registry.independentEligibleCount}`, `Registered keys ${registry.reviewerKeyCount} · domain eligible ${registry.domainEligibleCount} · independent eligible ${registry.independentEligibleCount}`)}</span></> : L('검토자 공개키 등록부 상태 확인 중…', 'Checking reviewer public-key registry…')}</div>
    <section className="mt-6 rounded-xl border bg-white p-5">
      <label className="block text-sm font-semibold">{L('1. 불변 검토 패킷', '1. Immutable review packet')}</label>
      <input className="mt-3 block w-full text-sm" type="file" accept="application/json,.json" onChange={event => void loadPacket(event.target.files?.[0])} />
      {packet && <div className="mt-3 rounded-lg bg-gray-50 p-3 font-mono text-xs break-all"><div>target {packet.targetHash}</div><div>source {packet.target.sourceHash}</div><div>revision {packet.target.revision} · artifacts {packet.target.artifactHashes.length}</div></div>}
      {message && <p className="mt-3 text-sm text-amber-700">{message}</p>}
    </section>
    {packet && <section className="mt-5 grid gap-4 md:grid-cols-2">{ROLES.map(role => { const draft = drafts[role]; return <div key={role} className="rounded-xl border bg-white p-5">
      <h2 className="font-bold">2. {roleLabel(role)}</h2>
      <label className="mt-4 block text-xs font-semibold text-gray-600">{L('등록된 검토자 ID', 'Registered reviewer ID')}</label>
      <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={draft.reviewerId} onChange={event => setDraft(role, { reviewerId: event.target.value }, true)} />
      <label className="mt-3 block text-xs font-semibold text-gray-600">{L('결정', 'Decision')}</label>
      <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={draft.decision} onChange={event => setDraft(role, { decision: event.target.value as NativeCadClientReviewDecision }, true)}><option value="approved">{L('승인', 'Approved')}</option><option value="changes_requested">{L('수정 요청', 'Changes requested')}</option><option value="rejected">{L('거절', 'Rejected')}</option></select>
      <button className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300" disabled={!draft.reviewerId.trim()} onClick={() => exportPayload(role)}>{L('서명 대상 JSON 다운로드', 'Download signing-payload JSON')}</button>
      {draft.unsigned && <div className="mt-3 rounded bg-blue-50 p-2 text-xs text-blue-800">{L('요청 시각', 'Requested at')} {formatDate(draft.unsigned.reviewedAt, locale, { dateStyle: 'medium', timeStyle: 'short' }) ?? draft.unsigned.reviewedAt}<br/>{L('이후 ID·결정을 바꾸면 서명 대상을 다시 내려받아야 합니다.', 'If the ID or decision changes, download a new signing payload.')}</div>}
      <label className="mt-3 block text-xs font-semibold text-gray-600">{L('서명 응답 JSON 가져오기 (권장)', 'Import signature-response JSON (recommended)')}</label>
      <input className="mt-1 block w-full text-xs" type="file" accept="application/json,.json" onChange={event => void loadSignatureResponse(role, event.target.files?.[0])} />
      <label className="mt-3 block text-xs font-semibold text-gray-600">{L('또는 Ed25519 서명 직접 입력(Base64)', 'Or enter the Ed25519 signature directly (Base64)')}</label><textarea className="mt-1 h-20 w-full rounded-lg border px-3 py-2 font-mono text-xs" disabled={!draft.unsigned} placeholder={draft.unsigned ? L('Base64 서명', 'Base64 signature') : L('먼저 서명 대상을 내려받으세요', 'Download the signing payload first')} value={draft.signature} onChange={event => setDraft(role, { signature: event.target.value })} />
      {draft.signature && <p className="mt-2 text-xs font-semibold text-emerald-700">{L('서명 응답 준비됨 · 최종 유효성은 서버에서 확인', 'Signature response ready · final validity is checked by the server')}</p>}
    </div>; })}</section>}
    {review && <section className="mt-5 rounded-xl border bg-white p-5"><h2 className="font-bold">{L('3. 조립 및 서버 검증', '3. Assemble and validate on the server')}</h2><div className="mt-3 flex flex-wrap gap-2"><button className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => download(`${packet!.targetHash}.expert-review.json`, `${JSON.stringify(review, null, 2)}\n`)}>{L('서명 결합 JSON 다운로드', 'Download combined-signature JSON')}</button><button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => void validate()}>{L('서버 공개키로 검증', 'Validate with server public keys')}</button></div></section>}
    {validation && <section className={`mt-5 rounded-xl border p-5 ${validation.approved ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}><h2 className="font-bold">{validation.approved ? L('서명 검증 통과', 'Signature validation passed') : L('서명 검증 실패', 'Signature validation failed')}</h2><p className="mt-2 text-sm">{L(`등록 키 ${validation.trustedReviewerKeyCount}개`, `${validation.trustedReviewerKeyCount} registered keys`)} · {formatDate(validation.generatedAt, locale, { dateStyle: 'medium', timeStyle: 'short' }) ?? validation.generatedAt}</p>{validation.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{validation.errors.map(error => <li key={error}>{error}</li>)}</ul>}<button className="mt-3 rounded-lg border bg-white px-4 py-2 text-sm font-semibold" onClick={() => download(`${validation.targetHash ?? 'invalid'}.validation.json`, `${JSON.stringify(validation, null, 2)}\n`)}>{L('검증 증거 다운로드', 'Download validation evidence')}</button></section>}
    <p className="mt-5 text-xs text-gray-500">{L('이 도구는 검증 결과를 DB에 기록하거나 제조 출시를 실행하지 않습니다. CAD 형상·동작·조인트·리비전이 바뀌면 새 패킷과 새 서명이 필요합니다.', 'This tool does not write validation results to the database or trigger a manufacturing release. Changes to CAD geometry, behavior, joints, or revision require a new packet and new signatures.')}</p>
  </main>;
}
