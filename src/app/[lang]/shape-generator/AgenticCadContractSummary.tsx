'use client';

import type { CSSProperties } from 'react';
import {
  createAgenticCadContractViewModel,
  type AgenticCadContractState,
  type AgenticCadContractViewModel,
} from './controllers/agenticCadContractViewModel';
import { shapeGeneratorLocale, translateCadMessage } from './i18n/adapter';

type Copy = {
  title: string;
  disclaimer: string;
  plan: string;
  receipt: string;
  tool: string;
  risk: string;
  none: string;
  notAuthoritative: string;
  hold: string;
  state: Record<AgenticCadContractState | 'INVALID', string>;
};

const COPY: Record<'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar', Copy> = {
  en: { title: 'Agent CAD contract', disclaimer: 'Agent turn completion is not CAD validation.', plan: 'Plan', receipt: 'Receipt', tool: 'Tool', risk: 'Risk', none: '—', notAuthoritative: 'NOT_AUTHORITATIVE', hold: 'HOLD', state: { NOT_RUN: 'NOT_RUN', INVALID: 'INVALID', INVALID_CONTRACT: 'INVALID', DRY_RUN_ONLY: 'DRY_RUN_ONLY', READ_ONLY_READY: 'READ_ONLY_READY', BLOCKED: 'BLOCKED', SANDBOX_PASS: 'SANDBOX_PASS', AWAITING_HUMAN_APPROVAL: 'AWAITING_HUMAN_APPROVAL' } },
  ko: { title: '에이전트 CAD 계약', disclaimer: '에이전트 작업 완료는 CAD 검증을 의미하지 않습니다.', plan: '계획', receipt: '영수증', tool: '도구', risk: '위험도', none: '—', notAuthoritative: '권위 없음', hold: '보류', state: { NOT_RUN: '미실행', INVALID: '무효', INVALID_CONTRACT: '무효', DRY_RUN_ONLY: '드라이런 전용', READ_ONLY_READY: '읽기 전용 준비', BLOCKED: '차단됨', SANDBOX_PASS: '샌드박스 통과', AWAITING_HUMAN_APPROVAL: '사람 승인 대기' } },
  ja: { title: 'エージェント CAD 契約', disclaimer: 'エージェント処理の完了は CAD 検証ではありません。', plan: '計画', receipt: 'レシート', tool: 'ツール', risk: 'リスク', none: '—', notAuthoritative: '権威なし', hold: '保留', state: { NOT_RUN: '未実行', INVALID: '無効', INVALID_CONTRACT: '無効', DRY_RUN_ONLY: 'ドライランのみ', READ_ONLY_READY: '読み取り準備完了', BLOCKED: 'ブロック', SANDBOX_PASS: 'サンドボックス通過', AWAITING_HUMAN_APPROVAL: '人の承認待ち' } },
  zh: { title: '代理 CAD 合约', disclaimer: '代理回合完成不等于 CAD 验证。', plan: '计划', receipt: '收据', tool: '工具', risk: '风险', none: '—', notAuthoritative: '非权威', hold: '暂停', state: { NOT_RUN: '未运行', INVALID: '无效', INVALID_CONTRACT: '无效', DRY_RUN_ONLY: '仅演练', READ_ONLY_READY: '只读就绪', BLOCKED: '已阻止', SANDBOX_PASS: '沙盒通过', AWAITING_HUMAN_APPROVAL: '等待人工批准' } },
  es: { title: 'Contrato CAD del agente', disclaimer: 'Completar el turno del agente no es validación CAD.', plan: 'Plan', receipt: 'Recibo', tool: 'Herramienta', risk: 'Riesgo', none: '—', notAuthoritative: 'NO_AUTORITATIVO', hold: 'EN ESPERA', state: { NOT_RUN: 'NO EJECUTADO', INVALID: 'NO VÁLIDO', INVALID_CONTRACT: 'NO VÁLIDO', DRY_RUN_ONLY: 'SOLO SIMULACIÓN', READ_ONLY_READY: 'LECTURA LISTA', BLOCKED: 'BLOQUEADO', SANDBOX_PASS: 'SIMULACIÓN APROBADA', AWAITING_HUMAN_APPROVAL: 'ESPERANDO APROBACIÓN HUMANA' } },
  ar: { title: 'عقد CAD للوكيل', disclaimer: 'اكتمال دور الوكيل ليس تحقق CAD.', plan: 'الخطة', receipt: 'الإيصال', tool: 'الأداة', risk: 'المخاطر', none: '—', notAuthoritative: 'غير سلطوي', hold: 'معلّق', state: { NOT_RUN: 'لم يُشغّل', INVALID: 'غير صالح', INVALID_CONTRACT: 'غير صالح', DRY_RUN_ONLY: 'تشغيل تجريبي فقط', READ_ONLY_READY: 'جاهز للقراءة فقط', BLOCKED: 'محظور', SANDBOX_PASS: 'نجح في العزل', AWAITING_HUMAN_APPROVAL: 'بانتظار موافقة بشرية' } },
};

function bounded(value: string | null, fallback: string): string {
  if (!value || value.length > 96 || !/^[A-Za-z0-9._:-]+$/u.test(value)) return fallback;
  return value;
}

function shortHash(value: string | null, fallback: string): string {
  if (!value || !/^[a-f0-9]{64}$/iu.test(value)) return fallback;
  return `${value.slice(0, 8)}…`;
}

export interface AgenticCadContractSummaryProps {
  lang: string;
  result: unknown;
  /** Optional precomputed model for callers that already enforce the contract boundary. */
  viewModel?: AgenticCadContractViewModel;
}

export default function AgenticCadContractSummary({ lang, result, viewModel }: AgenticCadContractSummaryProps) {
  const { locale, direction } = shapeGeneratorLocale(lang);
  const copy = COPY[locale];
  const model = viewModel ?? createAgenticCadContractViewModel(result);
  const stateKey = model.state === 'INVALID_CONTRACT' ? 'INVALID' : model.state;
  const blocker = model.blocker ? translateCadMessage(model.blocker, locale).text : null;
  return (
    <section dir={direction} aria-label={copy.title} data-testid="agentic-cad-contract-summary" data-state={stateKey} style={styles.panel}>
      <div style={styles.heading}><strong>{copy.title}</strong><span data-testid="agentic-cad-state">{copy.state[stateKey]}</span></div>
      <p style={styles.disclaimer}>{copy.disclaimer}</p>
      <dl style={styles.details}>
        <div><dt>{copy.plan}</dt><dd>{shortHash(model.planSha256, copy.none)}</dd></div>
        <div><dt>{copy.receipt}</dt><dd>{shortHash(model.receiptSha256, copy.none)}</dd></div>
        <div><dt>{copy.tool}</dt><dd>{bounded(model.toolId, copy.none)}</dd></div>
        <div><dt>{copy.risk}</dt><dd>{bounded(model.highestRisk, copy.none)}</dd></div>
      </dl>
      <p data-testid="agentic-cad-authority-warning" style={styles.warning}>{copy.notAuthoritative} · {copy.hold}</p>
      {blocker && <p data-testid="agentic-cad-blocker" style={styles.warning}>{blocker}</p>}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: { display: 'grid', gap: 8, padding: 12, border: '1px solid var(--nx-border, #30363d)', borderRadius: 10, background: 'var(--nx-panel, #161b22)', color: 'var(--nx-text, #e6edf3)', fontSize: 12, lineHeight: 1.45 },
  heading: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
  disclaimer: { margin: 0, color: 'var(--nx-text-2, #8b949e)' },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, margin: 0 },
  warning: { margin: 0, color: '#f0c36d', fontWeight: 700 },
};
