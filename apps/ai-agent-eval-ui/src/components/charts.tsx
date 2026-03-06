import { useState } from 'react';

export const PALETTE = [
  '#1a7a4a', '#1a4a7a', '#7a5c00', '#c0392b',
  '#7a1a4a', '#1a7a7a', '#4a7a1a', '#7a4a1a',
];

// ─── DonutChart ───────────────────────────────────────────────────────────────

export type PieSlice = { label: string; value: number; color: string };

/** Returns an SVG path string for a donut/pie slice.
 *  When the slice spans the full circle, falls back to two half-arcs (degenerate case). */
function buildSlicePath(
  cx: number, cy: number, r: number, innerR: number,
  startAngle: number, endAngle: number,
): string {
  const span = endAngle - startAngle;
  if (span >= Math.PI * 2 - 0.0001) {
    // Full circle — two half-arcs so the path is non-degenerate
    const [ox1, ox2] = [cx - r, cx + r];
    if (innerR <= 0) {
      return `M ${ox1} ${cy} A ${r} ${r} 0 1 1 ${ox2} ${cy} A ${r} ${r} 0 1 1 ${ox1} ${cy} Z`;
    }
    const [ix1, ix2] = [cx - innerR, cx + innerR];
    return [
      `M ${ox1} ${cy} A ${r} ${r} 0 1 1 ${ox2} ${cy} A ${r} ${r} 0 1 1 ${ox1} ${cy} Z`,
      `M ${ix1} ${cy} A ${innerR} ${innerR} 0 1 0 ${ix2} ${cy} A ${innerR} ${innerR} 0 1 0 ${ix1} ${cy} Z`,
    ].join(' ');
  }
  const large = span > Math.PI ? 1 : 0;
  const [ox1, oy1] = [cx + r * Math.cos(startAngle), cy + r * Math.sin(startAngle)];
  const [ox2, oy2] = [cx + r * Math.cos(endAngle), cy + r * Math.sin(endAngle)];
  if (innerR <= 0) {
    return `M ${cx} ${cy} L ${ox1} ${oy1} A ${r} ${r} 0 ${large} 1 ${ox2} ${oy2} Z`;
  }
  const [ix1, iy1] = [cx + innerR * Math.cos(startAngle), cy + innerR * Math.sin(startAngle)];
  const [ix2, iy2] = [cx + innerR * Math.cos(endAngle), cy + innerR * Math.sin(endAngle)];
  return `M ${ox1} ${oy1} A ${r} ${r} 0 ${large} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`;
}

export type DonutChartProps = {
  slices: PieSlice[];
  size?: number;
  /** 0 = pie,  0.55 = donut ring */
  innerRatio?: number;
  showLegend?: boolean;
};

export function DonutChart({ slices, size = 140, innerRatio = 0.55, showLegend = true }: DonutChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return <div className="dash-no-data">No data</div>;

  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 4;
  const innerR = innerRatio > 0 ? r * innerRatio : 0;

  let angle = -Math.PI / 2;
  const paths = slices
    .filter((sl) => sl.value > 0)
    .map((sl) => {
      const sweep = (sl.value / total) * Math.PI * 2;
      const endAngle = angle + sweep;
      const d = buildSlicePath(cx, cy, r, innerR, angle, endAngle);
      const midAngle = angle + sweep / 2;
      angle = endAngle;
      return { ...sl, d, midAngle };
    });

  const hoveredSlice = paths.find((p) => p.label === hovered);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={size} height={size} style={{ flexShrink: 0, overflow: 'visible' }}>
        {paths.map((p) => (
          <path
            key={p.label}
            d={p.d}
            fill={p.color}
            fillRule="evenodd"
            opacity={hovered && hovered !== p.label ? 0.45 : 1}
            onMouseEnter={() => setHovered(p.label)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'default', transition: 'opacity .15s' }}
          />
        ))}
        {/* Center label on hover */}
        {innerR > 0 && hoveredSlice && (
          <>
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
              {hoveredSlice.value}
            </text>
            <text x={cx} y={cy + 9} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
              {hoveredSlice.label.length > 13 ? hoveredSlice.label.slice(0, 11) + '…' : hoveredSlice.label}
            </text>
          </>
        )}
        {innerR > 0 && !hoveredSlice && (
          <>
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
              {total}
            </text>
            <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill="var(--text-muted)">total</text>
          </>
        )}
      </svg>
      {showLegend && (
        <div className="dash-legend" style={{ flex: 1, minWidth: 80 }}>
          {slices.filter((s) => s.value > 0).map((s) => (
            <div key={s.label} className="dash-legend-item">
              <div className="dash-legend-dot" style={{ background: s.color }} />
              <span style={{ color: hovered === s.label ? 'var(--text)' : undefined }}>{s.label}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {((s.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VerticalBarChart ─────────────────────────────────────────────────────────

export type BarItem = { label: string; value: number };

export type VerticalBarChartProps = {
  data: BarItem[];
  formatValue?: (v: number) => string;
  color?: string;
  height?: number;
  maxItems?: number;
};

const VB = { top: 24, right: 12, bottom: 48, left: 42 };

export function VerticalBarChart({
  data,
  formatValue = (v) => String(Math.round(v)),
  color = 'var(--green)',
  height = 200,
  maxItems = 12,
}: VerticalBarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const items = data.slice(0, maxItems);
  if (items.length === 0) return <div className="dash-no-data">No data</div>;

  const maxVal = Math.max(...items.map((d) => d.value), 1);
  const W = 600;
  const chartH = height - VB.top - VB.bottom;
  const chartW = W - VB.left - VB.right;
  const barW = Math.max(6, Math.floor(chartW / items.length) - 6);
  const gap = (chartW - barW * items.length) / (items.length + 1);

  // Y-axis gridlines at 25%, 50%, 75%, 100%
  const gridFracs = [0.25, 0.5, 0.75, 1] as const;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="dash-chart-svg" style={{ height }}>
      {/* Baseline */}
      <line
        x1={VB.left} y1={VB.top + chartH}
        x2={W - VB.right} y2={VB.top + chartH}
        stroke="var(--border)" strokeWidth="1"
      />
      {/* Grid lines + y-labels */}
      {gridFracs.map((f) => {
        const y = VB.top + chartH * (1 - f);
        return (
          <g key={f}>
            <line x1={VB.left} y1={y} x2={W - VB.right} y2={y} stroke="var(--bg-elevated)" strokeWidth="1" />
            <text x={VB.left - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">
              {formatValue(maxVal * f)}
            </text>
          </g>
        );
      })}
      {/* Bars */}
      {items.map((d, i) => {
        const barH = Math.max(2, (d.value / maxVal) * chartH);
        const x = VB.left + gap + i * (barW + gap);
        const y = VB.top + chartH - barH;
        const lx = x + barW / 2;
        const ly = VB.top + chartH + 14;
        const labelText = d.label.length > 10 ? d.label.slice(0, 9) + '…' : d.label;
        const isHov = hovered === i;
        return (
          <g
            key={d.label}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'default' }}
          >
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx="3" opacity={isHov ? 1 : 0.82} />
            {(isHov || items.length <= 8) && (
              <text x={lx} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--text-secondary)">
                {formatValue(d.value)}
              </text>
            )}
            <text
              x={lx} y={ly} textAnchor="end" fontSize="9" fill={isHov ? 'var(--text)' : 'var(--text-muted)'}
              transform={`rotate(-40,${lx},${ly})`}
            >
              {labelText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── AreaChart ────────────────────────────────────────────────────────────────

export type TimePoint = { label: string; values: number[] };
export type ChartSeries = { label: string; color: string; fillOpacity?: number; dashed?: boolean };

export type AreaChartProps = {
  points: TimePoint[];
  series: ChartSeries[];
  height?: number;
  formatY?: (v: number) => string;
  showLegend?: boolean;
};

const AC = { top: 16, right: 16, bottom: 30, left: 38 };

export function AreaChart({
  points,
  series,
  height = 160,
  formatY = (v) => String(Math.round(v)),
  showLegend = true,
}: AreaChartProps) {
  if (points.length === 0) return <div className="dash-no-data">No data</div>;

  const W = 600;
  const chartH = height - AC.top - AC.bottom;
  const chartW = W - AC.left - AC.right;
  const maxVal = Math.max(...points.flatMap((p) => p.values), 1);

  const xPos = (i: number) =>
    points.length === 1
      ? AC.left + chartW / 2
      : AC.left + (i / (points.length - 1)) * chartW;

  const yPos = (v: number) => AC.top + chartH - (v / maxVal) * chartH;
  const bottom = AC.top + chartH;

  // Show at most 8 x-axis labels
  const labelStep = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="dash-chart-svg" style={{ height }}>
        {/* Baseline */}
        <line x1={AC.left} y1={bottom} x2={W - AC.right} y2={bottom} stroke="var(--border)" strokeWidth="1" />
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = yPos(maxVal * f);
          return (
            <g key={f}>
              <line x1={AC.left} y1={y} x2={W - AC.right} y2={y} stroke="var(--bg-elevated)" strokeWidth="1" />
              <text x={AC.left - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">
                {formatY(maxVal * f)}
              </text>
            </g>
          );
        })}
        {/* Series */}
        {series.map((s, si) => {
          const pts = points.map((p, i) => ({ x: xPos(i), y: yPos(p.values[si] ?? 0) }));
          if (pts.length === 0) return null;
          const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
          const areaD = [
            `M ${pts[0]!.x} ${bottom}`,
            ...pts.map((p) => `L ${p.x} ${p.y}`),
            `L ${pts[pts.length - 1]!.x} ${bottom} Z`,
          ].join(' ');
          return (
            <g key={s.label}>
              <path d={areaD} fill={s.color} opacity={s.fillOpacity ?? 0.1} />
              <path
                d={lineD} fill="none" stroke={s.color} strokeWidth="1.5"
                strokeDasharray={s.dashed ? '4 3' : undefined}
              />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={s.color} />
              ))}
            </g>
          );
        })}
        {/* X-axis labels */}
        {points.map((p, i) => {
          if (i % labelStep !== 0 && i !== points.length - 1) return null;
          return (
            <text key={i} x={xPos(i)} y={bottom + 16} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
              {p.label}
            </text>
          );
        })}
      </svg>
      {showLegend && (
        <div className="dash-legend">
          {series.map((s) => (
            <div key={s.label} className="dash-legend-item">
              <svg width="16" height="6" style={{ flexShrink: 0 }}>
                {s.dashed
                  ? <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray="4 2" />
                  : <rect x="0" y="0" width="16" height="6" rx="2" fill={s.color} opacity="0.75" />
                }
              </svg>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
