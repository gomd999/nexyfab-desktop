import React from 'react';

interface DragDropOverlayProps {
  isDragOver: boolean;
  dropFileHereText: string;
}

export default function DragDropOverlay({ isDragOver, dropFileHereText }: DragDropOverlayProps) {
  if (!isDragOver) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(59,130,246,0.12)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '3px dashed #3b82f6', pointerEvents: 'none' }}>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{dropFileHereText}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>STEP · STL · OBJ · PLY · IGES · DXF · BREP</div>
      </div>
    </div>
  );
}
