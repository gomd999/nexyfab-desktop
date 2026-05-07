'use client';

import React, { useState } from 'react';

/**
 * CAM (Computer-Aided Manufacturing) Workspace
 * 
 * Future commercial milestone: Allow users to generate 2.5D/3-Axis CNC toolpaths 
 * directly in the browser and simulate the milling process.
 */
export default function CAMWorkspacePanel({ onClose }: { onClose?: () => void }) {
  const [activeTool, setActiveTool] = useState<'face' | 'pocket' | 'contour' | 'drill'>('face');
  const [generating, setGenerating] = useState(false);

  const handleGenerateGCode = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      alert('G-Code generated successfully! (Simulation Mode)');
    }, 2000);
  };

  return (
    <div style={{
      position: 'absolute', top: 60, right: 20, width: 340,
      background: '#ffffff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      border: '1px solid #d0d7de', zIndex: 150, display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #d0d7de', background: '#f6f8fa', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#24292f' }}>CAM Workspace (Beta)</h3>
        {onClose && <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>}
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#57606a' }}>
          Select a machining strategy to generate CNC toolpaths for the current solid body.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(['face', 'pocket', 'contour', 'drill'] as const).map(tool => (
            <button
              key={tool}
              onClick={() => setActiveTool(tool)}
              style={{
                flex: '1 1 45%', padding: '8px', borderRadius: 6,
                border: activeTool === tool ? '2px solid #0969da' : '1px solid #d0d7de',
                background: activeTool === tool ? '#ddf4ff' : '#ffffff',
                color: activeTool === tool ? '#0969da' : '#24292f',
                fontWeight: 600, fontSize: 12, cursor: 'pointer'
              }}
            >
              {tool.charAt(0).toUpperCase() + tool.slice(1)} Milling
            </button>
          ))}
        </div>

        <div style={{ background: '#f6f8fa', padding: 12, borderRadius: 6, marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#24292f' }}>Tool Configuration</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
            <span>End Mill Dia:</span> <span>6.0 mm</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
            <span>Spindle Speed:</span> <span>8000 RPM</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>Feed Rate:</span> <span>1200 mm/min</span>
          </div>
        </div>

        <button
          onClick={handleGenerateGCode}
          disabled={generating}
          style={{
            marginTop: 8, padding: '12px', background: '#2da44e', color: 'white',
            border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13,
            cursor: generating ? 'default' : 'pointer', opacity: generating ? 0.7 : 1
          }}
        >
          {generating ? 'Calculating Toolpaths...' : 'Generate G-Code'}
        </button>
      </div>
    </div>
  );
}
