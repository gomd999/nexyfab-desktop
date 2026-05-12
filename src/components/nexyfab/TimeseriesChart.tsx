'use client';

/**
 * TimeseriesChart — pure-SVG line/bar chart for the API health dashboard.
 *
 * Why no library: recharts/d3 add 200KB+ to the admin bundle just for
 * 2-3 charts. Hand-rolled SVG covers the simple cases (time-bucketed
 * series, single y-axis, hover tooltip) without the weight.
 *
 * Renders bars by default (good for cost / call counts). Pass mode='line'
 * for latency curves where the trend matters more than absolute volume.
 */
import React, { useMemo, useState } from 'react';

export interface TimeseriesPoint {
  ts: number;
  value: number;
}

export interface TimeseriesChartProps {
  data: TimeseriesPoint[];
  height?: number;
  color?: string;
  mode?: 'bar' | 'line';
  /** y-axis formatter (e.g. v => `$${v.toFixed(2)}` for cost) */
  formatY?: (v: number) => string;
  /** Override the y-axis maximum; default = max value × 1.1 */
  maxY?: number;
  /** Title shown over the chart */
  title?: string;
  /** Subtitle e.g. "windowH=24, bucketM=60" */
  subtitle?: string;
}

const DEFAULT_HEIGHT = 120;
const PAD_LEFT = 50;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

export default function TimeseriesChart({
  data,
  height = DEFAULT_HEIGHT,
  color = '#79c0ff',
  mode = 'bar',
  formatY = v => v.toLocaleString(),
  maxY,
  title,
  subtitle,
}: TimeseriesChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Cap container at 800px CSS but draw at 800 so SVG scales responsively.
  const width = 800;
  const innerW = width - PAD_LEFT - PAD_RIGHT;
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const computed = useMemo(() => {
    if (data.length === 0) return null;
    const max = maxY ?? Math.max(1, ...data.map(d => d.value)) * 1.1;
    const stepX = innerW / Math.max(1, data.length - 1);
    return { max, stepX };
  }, [data, maxY, innerW]);

  if (data.length === 0 || !computed) {
    return (
      <div style={containerStyle}>
        {title && <div style={titleStyle}>{title}</div>}
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 12 }}>
          데이터 없음
        </div>
      </div>
    );
  }

  const { max, stepX } = computed;
  const ticks = [0, max / 2, max];
  const xToTime = (i: number) => new Date(data[i].ts).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div style={containerStyle}>
      {title && <div style={titleStyle}>{title}</div>}
      {subtitle && <div style={subtitleStyle}>{subtitle}</div>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y-axis grid + labels */}
        {ticks.map((v, i) => {
          const y = PAD_TOP + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} stroke="#21262d" strokeWidth={1} />
              <text x={PAD_LEFT - 6} y={y + 4} fill="#6e7681" fontSize={9} textAnchor="end" fontFamily="monospace">
                {formatY(v)}
              </text>
            </g>
          );
        })}

        {/* Data */}
        {mode === 'bar' && (
          <g>
            {data.map((d, i) => {
              const x = PAD_LEFT + i * stepX;
              const h = (d.value / max) * innerH;
              const barW = Math.max(1, stepX * 0.7);
              return (
                <rect
                  key={i}
                  x={x - barW / 2}
                  y={PAD_TOP + innerH - h}
                  width={barW}
                  height={h}
                  fill={color}
                  opacity={hoverIdx === null || hoverIdx === i ? 0.9 : 0.45}
                  onMouseEnter={() => setHoverIdx(i)}
                />
              );
            })}
          </g>
        )}

        {mode === 'line' && (
          <>
            <polyline
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              points={data.map((d, i) => `${PAD_LEFT + i * stepX},${PAD_TOP + innerH - (d.value / max) * innerH}`).join(' ')}
            />
            {data.map((d, i) => {
              const x = PAD_LEFT + i * stepX;
              const y = PAD_TOP + innerH - (d.value / max) * innerH;
              return (
                <circle
                  key={i}
                  cx={x} cy={y} r={hoverIdx === i ? 3.5 : 1.5}
                  fill={color}
                  onMouseEnter={() => setHoverIdx(i)}
                />
              );
            })}
          </>
        )}

        {/* Hover tooltip */}
        {hoverIdx !== null && (
          <g>
            <line
              x1={PAD_LEFT + hoverIdx * stepX}
              y1={PAD_TOP}
              x2={PAD_LEFT + hoverIdx * stepX}
              y2={PAD_TOP + innerH}
              stroke="#58a6ff" strokeDasharray="2,2" strokeWidth={1}
            />
            <text
              x={Math.min(width - 90, Math.max(PAD_LEFT, PAD_LEFT + hoverIdx * stepX + 6))}
              y={PAD_TOP + 12}
              fill="#e6edf3" fontSize={10} fontFamily="monospace"
            >
              {formatY(data[hoverIdx].value)}
            </text>
            <text
              x={Math.min(width - 90, Math.max(PAD_LEFT, PAD_LEFT + hoverIdx * stepX + 6))}
              y={PAD_TOP + 24}
              fill="#8b949e" fontSize={9} fontFamily="monospace"
            >
              {xToTime(hoverIdx)}
            </text>
          </g>
        )}

        {/* X-axis: first / mid / last labels */}
        {[0, Math.floor(data.length / 2), data.length - 1].map(i => (
          <text
            key={i}
            x={PAD_LEFT + i * stepX}
            y={height - 6}
            fill="#6e7681" fontSize={9} textAnchor="middle" fontFamily="monospace"
          >
            {xToTime(i)}
          </text>
        ))}
      </svg>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: 12,
};
const titleStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#e6edf3', marginBottom: 2,
};
const subtitleStyle: React.CSSProperties = {
  fontSize: 10, color: '#6e7681', marginBottom: 8,
};
