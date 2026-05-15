'use client';

// J2 — Standard parts library modal extracted from ShapeGeneratorInner.
// 3 categories × ~5 parts; clicking a card emits the part id and the host
// dispatches `handleSelectStandardPart`. Pure presentation — no scene state
// touched here.

import React from 'react';

interface StandardPartsLibraryProps {
  open: boolean;
  selectedStandardPart: string | null;
  onSelect: (partId: string) => void;
  onClose: () => void;
  labels: {
    standardPartsLibrary: string;
    fastenersLabel: string;
    structuralLabel: string;
    bearingsLabel: string;
    hexBolt: string;
    hexNut: string;
    socketHeadCapScrew: string;
    flatWasher: string;
    springWasher: string;
    iBeam: string;
    angleBracket: string;
    channelBeam: string;
    ballBearing: string;
    bushing: string;
  };
}

interface PartDef { id: string; name: string; icon: string; std: string }

export default function StandardPartsLibrary({
  open, selectedStandardPart, onSelect, onClose, labels: l,
}: StandardPartsLibraryProps) {
  if (!open) return null;

  const categories: Array<{ key: string; label: string; icon: string; parts: PartDef[] }> = [
    {
      key: 'fastener', label: l.fastenersLabel, icon: '🔩',
      parts: [
        { id: 'hexBolt',             name: l.hexBolt,             icon: '🔩', std: 'ISO 4014' },
        { id: 'hexNut',              name: l.hexNut,              icon: '⬡', std: 'ISO 4032' },
        { id: 'socketHeadCapScrew',  name: l.socketHeadCapScrew,  icon: '🔧', std: 'ISO 4762' },
        { id: 'flatWasher',          name: l.flatWasher,          icon: '⊙', std: 'ISO 7089' },
        { id: 'springWasher',        name: l.springWasher,        icon: '◎', std: 'DIN 127' },
        { id: 'spurGear',            name: 'Spur Gear',           icon: '⚙', std: 'ISO 53' },
      ],
    },
    {
      key: 'structural', label: l.structuralLabel, icon: '🏗️',
      parts: [
        { id: 'iBeam',         name: l.iBeam,         icon: '🏗️', std: 'ISO 657' },
        { id: 'angleBracket',  name: l.angleBracket,  icon: '📐', std: 'ISO 657' },
        { id: 'channelBeam',   name: l.channelBeam,   icon: '⊏', std: 'ISO 657' },
      ],
    },
    {
      key: 'bearing', label: l.bearingsLabel, icon: '⊚',
      parts: [
        { id: 'ballBearing', name: l.ballBearing, icon: '⊚', std: 'ISO 15' },
        { id: 'bushing',     name: l.bushing,     icon: '◯', std: 'ISO 3547' },
      ],
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--nx-glass-input)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--nx-panel-2)', borderRadius: 14, padding: 24,
          maxWidth: 600, width: '90%', maxHeight: '80vh', overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          border: '1px solid var(--nx-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--nx-text)' }}>
            {l.standardPartsLibrary}
          </h3>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'none', fontSize: 18,
              cursor: 'pointer', color: 'var(--nx-text-2)',
            }}
          >✕</button>
        </div>
        {categories.map(cat => (
          <div key={cat.key} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 12, fontWeight: 800, color: 'var(--nx-text-2)',
              textTransform: 'uppercase', marginBottom: 8,
            }}>
              {cat.icon} {cat.label}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 8,
            }}>
              {cat.parts.map(part => (
                <button
                  key={part.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('application/vnd.nexyfab.standardpart', part.id)}
                  onClick={() => { onSelect(part.id); onClose(); }}
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 4,
                    padding: '12px 8px', borderRadius: 10,
                    border: selectedStandardPart === part.id ? '2px solid var(--nx-accent)' : '1px solid var(--nx-border)',
                    background: selectedStandardPart === part.id ? 'var(--nx-accent)22' : 'var(--nx-panel)',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--nx-accent-2)')}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor =
                      selectedStandardPart === part.id ? 'var(--nx-accent)' : 'var(--nx-border)';
                  }}
                >
                  <span style={{ fontSize: 24 }}>{part.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--nx-text)', textAlign: 'center' }}>{part.name}</span>
                  <span style={{ fontSize: 9, color: 'var(--nx-text-2)' }}>{part.std}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
