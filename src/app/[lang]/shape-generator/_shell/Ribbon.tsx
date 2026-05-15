'use client';

import { I, type IconName } from './Icons';
import type { ReactNode } from 'react';

// ── Tab strip ────────────────────────────────────────────────────────────────

export interface RibbonTabDef {
  id: string;
  label: string;
  mode?: boolean;
}

export interface RibbonTabsProps {
  tabs: RibbonTabDef[];
  activeTab: string;
  onChange: (id: string) => void;
}

export function RibbonTabs({ tabs, activeTab, onChange }: RibbonTabsProps) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          className={`tab ${activeTab === t.id ? 'active' : ''} ${t.mode ? 'mode' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export interface ToolProps {
  ico: IconName;
  lbl: string;
  big?: boolean;
  hasCaret?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function Tool({ ico, lbl, big = true, hasCaret, active, disabled, onClick }: ToolProps) {
  const Icon = I[ico] ?? I.cube;
  return (
    <button
      type="button"
      className={`tool ${big ? '' : 'sm'} ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={lbl}
      style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
    >
      <span className="ico">
        <Icon size={big ? 22 : 14} />
      </span>
      <span className="lbl">{lbl}</span>
      {hasCaret && <span className="caret">▾</span>}
    </button>
  );
}

// ── Group ────────────────────────────────────────────────────────────────────

export interface GrpProps {
  title: string;
  children: ReactNode;
}

export function Grp({ title, children }: GrpProps) {
  return (
    <div className="grp">
      <div className="tools">{children}</div>
      <div className="title">{title}</div>
    </div>
  );
}

// ── Ribbon container ─────────────────────────────────────────────────────────

export interface RibbonProps {
  tabs: RibbonTabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: ReactNode;
}

export function Ribbon({ tabs, activeTab, onTabChange, children }: RibbonProps) {
  return (
    <div className="nx-ribbon">
      <RibbonTabs tabs={tabs} activeTab={activeTab} onChange={onTabChange} />
      <div className="row">{children}</div>
    </div>
  );
}
