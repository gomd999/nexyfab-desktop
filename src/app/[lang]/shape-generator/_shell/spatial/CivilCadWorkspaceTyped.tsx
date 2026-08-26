'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCivilConceptDocument, civilConceptIssues, civilViewerParts, normalizeCivilSpatialParameters, type CivilSpatialParameters } from '@/lib/cad/civilSpatialModel';
import { saveSpatialDesignBriefHandoff, SPATIAL_AI_HANDOFF_REQUEST_EVENT, takeSpatialDesignBriefHandoffAny, takeSpatialDesignCandidateReturnV2 } from '@/lib/ai/spatialDesignBriefHandoff';
import { createSpatialDocumentId, saveSpatialCadDraftHandoff, spatialCadDocumentSnapshot, useSpatialCadContentHash } from '@/lib/ai/spatialDesignBriefBuilder';
import type { SpatialCadParameters } from '@/lib/cad/spatialCadCommand';
import type { SpatialAiCandidate } from '@/lib/ai/spatialAiCandidate';
import { SpatialAiCandidateBridge } from './SpatialAiCandidateBridge';
import { SpatialCadTransactionStatus, useSpatialCadTransaction } from './useSpatialCadTransaction';
import { SPATIAL_CAD_COMMAND_EVENT, type SpatialCadCommandDetail } from './spatialCadCommands';
import { CIVIL_COPY, civilLocale } from './CivilCadWorkspace';

const AssemblyViewer3D = dynamic(() => import('../../../nexyfab/design/AssemblyViewer3D'), { ssr: false });
const DEFAULTS: CivilSpatialParameters = { epsg: 0, lengthM: 120, corridorWidthM: 7, surfaceWidthM: 24, startElevationM: 10, endElevationM: 11.2, crossSlopePercent: 2, drainDiameterMm: 450, drainInletCount: 1 };
const labelKey: Record<keyof CivilSpatialParameters, string> = { epsg: 'EPSG', lengthM: 'Alignment length (m)', corridorWidthM: 'Corridor width (m)', surfaceWidthM: 'Surface width (m)', startElevationM: 'Start elevation (m)', endElevationM: 'End elevation (m)', crossSlopePercent: 'Cross slope (%)', drainDiameterMm: 'Drain diameter (mm)', drainInletCount: 'Drain inlet count' };
const legacyLabelKey: Record<keyof CivilSpatialParameters, string> = { epsg: 'epsg', lengthM: 'alignment length (m)', corridorWidthM: 'corridor width (m)', surfaceWidthM: 'surface width (m)', startElevationM: 'start elevation (m)', endElevationM: 'end elevation (m)', crossSlopePercent: 'cross slope (%)', drainDiameterMm: 'drain diameter (mm)', drainInletCount: 'drain inlet count' };
const field: React.CSSProperties = { width: '100%', height: 30, border: '1px solid var(--nx-border)', borderRadius: 5, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', padding: '0 8px', fontSize: 11 };

type VerificationState = 'NOT_RUN' | 'PREVIEW' | 'BLOCKED';
const publishVerification = (state: VerificationState) => window.dispatchEvent(new CustomEvent('nexyfab:spatial-verification-status', { detail: { state } }));

function CivilNumberInput({ id, label, value, min, max, step, optional, onCommit }: { id: string; label: string; value: number; min: number; max: number; step: number; optional?: boolean; onCommit: (value: number) => void }) {
  const shown = optional && value === 0 ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    if (!draft.trim()) { onCommit(0); return; }
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(shown);
  };
  return <input id={id} name={String(id).replace('civil-typed-', '')} aria-label={label} type="number" value={draft} min={min} max={max} step={step} placeholder={optional ? '5186' : undefined} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { setDraft(shown); event.currentTarget.blur(); } }} style={field} />;
}

export function CivilCadWorkspaceTyped({ lang, onAiDesign }: { lang: string; onAiDesign: () => void }) {
  const t = CIVIL_COPY[civilLocale(lang)];
  const [params, setParams] = useState(DEFAULTS);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [state, setState] = useState<VerificationState>('NOT_RUN');
  const [issues, setIssues] = useState<string[]>([]);
  const [selectedParameterPath, setSelectedParameterPath] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<SpatialAiCandidate | null>(null);
  const documentIdRef = useRef(createSpatialDocumentId('civil'));
  const restore = useCallback((next: CivilSpatialParameters) => { setParams(normalizeCivilSpatialParameters(next)); setState('NOT_RUN'); setIssues([]); publishVerification('NOT_RUN'); }, []);
  const transaction = useSpatialCadTransaction<CivilSpatialParameters>('civil', DEFAULTS, { onRestore: restore });
  documentIdRef.current = transaction.currentDocumentId;
  const normalized = useMemo(() => normalizeCivilSpatialParameters(params), [params]);
  const document = useMemo(() => buildCivilConceptDocument(normalized), [normalized]);
  const viewerParts = useMemo(() => civilViewerParts(normalized), [normalized]);
  const cadDocument = useMemo(() => spatialCadDocumentSnapshot('civil', transaction.state.revision, normalized as unknown as SpatialCadParameters), [normalized, transaction.state.revision]);
  const contentHash = useSpatialCadContentHash(cadDocument);
  const update = useCallback((key: keyof CivilSpatialParameters, value: number) => {
    const next = normalizeCivilSpatialParameters({ ...params, [key]: value });
    if (transaction.commit(next)) { setSelectedParameterPath(key); setParams(next); setState('NOT_RUN'); setIssues([]); publishVerification('NOT_RUN'); }
  }, [params, transaction]);
  const verify = useCallback(() => { const next = civilConceptIssues(document); const status: VerificationState = next.length ? 'BLOCKED' : 'PREVIEW'; setIssues(next); setState(status); publishVerification(status); }, [document]);

  useEffect(() => { publishVerification('NOT_RUN'); }, []);

  useEffect(() => {
    const returned = takeSpatialDesignCandidateReturnV2(window.sessionStorage, 'civil');
    const handoff = returned?.handoff ?? takeSpatialDesignBriefHandoffAny(window.sessionStorage, 'civil');
    if (!handoff) return;
    const value = (key: keyof CivilSpatialParameters, fallback: number) => {
      const candidates = [handoff.parameters[key], handoff.parameters[labelKey[key]], handoff.parameters[legacyLabelKey[key]]];
      return candidates.find((candidate): candidate is number => typeof candidate === 'number') ?? fallback;
    };
    const restored = normalizeCivilSpatialParameters({ epsg: value('epsg', DEFAULTS.epsg), lengthM: value('lengthM', DEFAULTS.lengthM), corridorWidthM: value('corridorWidthM', DEFAULTS.corridorWidthM), surfaceWidthM: value('surfaceWidthM', DEFAULTS.surfaceWidthM), startElevationM: value('startElevationM', DEFAULTS.startElevationM), endElevationM: value('endElevationM', DEFAULTS.endElevationM), crossSlopePercent: value('crossSlopePercent', DEFAULTS.crossSlopePercent), drainDiameterMm: value('drainDiameterMm', DEFAULTS.drainDiameterMm), drainInletCount: value('drainInletCount', DEFAULTS.drainInletCount) });
    transaction.seed(restored, 'baseDocumentRevision' in handoff ? handoff.baseDocumentRevision : 0, 'documentId' in handoff ? handoff.documentId : undefined);
    setParams(restored); setCandidate(returned?.candidate ?? null); setState('NOT_RUN'); setIssues([]); publishVerification('NOT_RUN');
  }, [transaction]);

  useEffect(() => {
    const save = () => {
      const parameters = Object.fromEntries((Object.keys(labelKey) as Array<keyof CivilSpatialParameters>).map(key => [key, normalized[key]])) as Record<string, string | number | boolean>;
      const missingAuthority = [...(!normalized.epsg ? ['explicit coordinate reference system'] : []), 'approved survey controls and TIN', 'vertical datum and approved profile', 'drainage hydraulic inputs and results'];
      void saveSpatialCadDraftHandoff({ domain: 'civil', unit: 'm', verification: state, parameters, missingAuthority, baseDocumentRevision: transaction.state.revision, documentId: documentIdRef.current, selectedParameterPath });
      saveSpatialDesignBriefHandoff(window.sessionStorage, { domain: 'civil', unit: 'm', verification: state, parameters: Object.fromEntries((Object.keys(labelKey) as Array<keyof CivilSpatialParameters>).map(key => [legacyLabelKey[key], normalized[key]])), missingAuthority });
    };
    window.addEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, save);
    return () => window.removeEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, save);
  }, [normalized, selectedParameterPath, state, transaction.state.revision]);

  useEffect(() => {
    const onCommand = (event: Event) => { const id = (event as CustomEvent<SpatialCadCommandDetail>).detail?.id; if (id === 'spatial.plan') setView('plan'); else if (id === 'spatial.3d') setView('3d'); else if (id === 'spatial.dimensions') globalThis.document.getElementById('civil-typed-epsg')?.focus(); else if (id === 'spatial.add.inlet') update('drainInletCount', normalized.drainInletCount + 1); else if (id === 'spatial.verify') verify(); else if (id === 'spatial.ai') onAiDesign(); };
    window.addEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand); return () => window.removeEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
  }, [normalized.drainInletCount, onAiDesign, update, verify]);

  const labels: Record<keyof CivilSpatialParameters, string> = { epsg: t.epsg, lengthM: t.lengthM, corridorWidthM: t.corridorWidthM, surfaceWidthM: t.surfaceWidthM, startElevationM: t.startElevationM, endElevationM: t.endElevationM, crossSlopePercent: t.crossSlopePercent, drainDiameterMm: t.drainDiameterMm, drainInletCount: t.drainInletCount };
  const fields: Array<[keyof CivilSpatialParameters, number, number, number, boolean?]> = [['epsg', 1, 999999, 1, true], ['lengthM', 10, 5000, 1], ['corridorWidthM', 2, 50, .1], ['surfaceWidthM', 4, 200, .5], ['startElevationM', -500, 9000, .1], ['endElevationM', -500, 9000, .1], ['crossSlopePercent', .2, 15, .1], ['drainDiameterMm', 100, 5000, 10], ['drainInletCount', 1, 20, 1]];
  return <div dir={civilLocale(lang) === 'ar' ? 'rtl' : 'ltr'} data-testid="civil-typed-spatial-cad" style={{ width: '100%', height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: '220px minmax(0,1fr) 292px', overflow: 'hidden', background: 'var(--nx-bg)' }}>
    <aside style={{ padding: 12, borderInlineEnd: '1px solid var(--nx-border)', overflow: 'auto' }}><b>{t.browser}</b><div style={{ marginTop: 12 }}>{t.project}</div><div style={{ marginTop: 7, color: 'var(--nx-warn, #d97706)', fontSize: 10 }}>{t.authorityMissing}</div><div style={{ marginTop: 7, fontSize: 10.5 }}>TIN · 2 triangles</div><div style={{ marginTop: 7, fontSize: 10.5 }}>Alignment A · {normalized.lengthM} m</div><div style={{ marginTop: 7, fontSize: 10.5 }}>Corridor · Drainage ({normalized.drainInletCount})</div><div style={{ marginTop: 16, color: state === 'BLOCKED' ? '#dc2626' : state === 'PREVIEW' ? '#2563eb' : '#d97706', fontWeight: 800 }}>{state}</div></aside>
      <main style={{ minWidth: 0, padding: 10, overflow: 'auto' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}><div role="group" aria-label={t.browser}><button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')} style={field}>{t.plan}</button><button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')} style={field}>{t.view3d}</button></div><small>{normalized.lengthM} m · {normalized.startElevationM}→{normalized.endElevationM} m · {normalized.epsg ? `EPSG:${normalized.epsg}` : 'CRS NOT_RUN'}</small></div>{view === 'plan' ? <svg data-testid="civil-plan" role="img" aria-label={t.plan} viewBox={`-5 ${-normalized.surfaceWidthM / 2 - 2} ${normalized.lengthM + 10} ${normalized.surfaceWidthM + 4}`} style={{ width: '100%', minHeight: 480, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)' }}><rect x="0" y={-normalized.surfaceWidthM / 2} width={normalized.lengthM} height={normalized.surfaceWidthM} fill="#d6c6a5" stroke="#64748b" strokeWidth=".2"/><rect x="0" y={-normalized.corridorWidthM / 2} width={normalized.lengthM} height={normalized.corridorWidthM} fill="#64748b"/><line x1="0" y1="0" x2={normalized.lengthM} y2="0" stroke="#f8fafc" strokeWidth=".15" strokeDasharray="1 .7"/><line x1="0" y1={normalized.corridorWidthM / 2 + 1} x2={normalized.lengthM} y2={normalized.corridorWidthM / 2 + 1} stroke="#38bdf8" strokeWidth=".25"/>{Array.from({ length: normalized.drainInletCount }, (_, index) => <circle key={index} cx={normalized.lengthM * index / normalized.drainInletCount} cy={normalized.corridorWidthM / 2 + 1} r=".5" fill="#0284c7"/>)}<circle cx={normalized.lengthM} cy={normalized.corridorWidthM / 2 + 1} r=".5" fill="#0284c7"/><text x={normalized.lengthM / 2} y={-normalized.corridorWidthM / 2 - 1} textAnchor="middle" fill="#334155" fontSize="1.3">ALIGNMENT A · CONCEPT</text></svg> : <AssemblyViewer3D parts={viewerParts} height={520} unit="mm" />} </main>
    <aside style={{ padding: 12, borderInlineStart: '1px solid var(--nx-border)', overflow: 'auto' }}><b>{t.properties}</b><SpatialCadTransactionStatus state={transaction.state} lang={lang} onUndo={transaction.undo} onRedo={transaction.redo}/><SpatialAiCandidateBridge candidate={candidate} currentDocument={cadDocument} currentDocumentId={documentIdRef.current} currentContentHash={contentHash} currentLocks={transaction.currentLocks} onAuthoritativeCommit={transaction.commitReviewed} onCommit={next => { const civilNext = normalizeCivilSpatialParameters(next as unknown as CivilSpatialParameters); const result = transaction.commit(civilNext, 'ai'); if (result) { setParams(civilNext); setState('NOT_RUN'); setIssues([]); publishVerification('NOT_RUN'); } return result; }} onDiscard={() => setCandidate(null)} lang={lang}/><div style={{ display: 'grid', gap: 6, marginTop: 10 }}>{fields.map(([key, min, max, step, optional]) => <label key={key} htmlFor={`civil-typed-${key}`} style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 6, alignItems: 'center', fontSize: 10.5 }}><span>{labels[key]}</span><CivilNumberInput id={`civil-typed-${key}`} label={labels[key]} value={normalized[key]} min={min} max={max} step={step} optional={optional} onCommit={value => update(key, value)}/></label>)}</div><div style={{ marginTop: 12, padding: 9, border: '1px solid var(--nx-warn, #d97706)', borderRadius: 6, fontSize: 10.5, lineHeight: 1.5 }}>{t.authority}</div><button type="button" data-testid="civil-run-verify" onClick={verify} style={{ marginTop: 10, width: '100%', minHeight: 36, background: 'var(--nx-accent)', border: 0, borderRadius: 6 }}>{t.run}</button><button type="button" onClick={() => { const next = normalizeCivilSpatialParameters(DEFAULTS); setSelectedParameterPath(null); if (transaction.commit(next)) { setParams(next); setState('NOT_RUN'); setIssues([]); publishVerification('NOT_RUN'); } }} style={{ ...field, marginTop: 6 }}>{t.reset}</button><section data-testid="civil-verification" aria-live="polite" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 5, fontSize: 10.5 }}><b>{t.gates}</b><span>{t.local}: <b>{state}</b></span><span>{t.survey}: <b>NOT_RUN</b> · {t.notConnected}</span><span>{t.vertical}: <b>NOT_RUN</b> · {t.notConnected}</span><span>{t.hydraulic}: <b>NOT_RUN</b> · {t.notConnected}</span>{issues.map(issue => <span key={issue} style={{ color: '#dc2626' }}>{issue}</span>)}</section><button type="button" onClick={onAiDesign} style={{ ...field, marginTop: 10 }}>{t.ai}</button></aside>
    <style>{`@media (max-width: 800px) { [data-testid="civil-typed-spatial-cad"] { grid-template-columns: minmax(0, 1fr) !important; } [data-testid="civil-typed-spatial-cad"] > aside { display: none; } }`}</style>
  </div>;
}
