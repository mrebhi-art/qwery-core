/**
 * Lightweight server-side SVG chart renderer.
 * No DOM or browser required -- pure string construction.
 * Supports: bar, pie, line, area.
 */

type ChartData = Array<Record<string, unknown>>;

type ChartConfig = {
  colors?: string[];
  labels?: Record<string, string>;
  xKey?: string;
  yKey?: string;
  nameKey?: string;
  valueKey?: string;
};

const W = 600;
const H = 360;
const PAD = { top: 30, right: 20, bottom: 65, left: 60 } as const;
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

const PALETTE = [
  '#6366f1',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#a78bfa',
  '#84cc16',
];

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

function colors(cfg: ChartConfig, n: number): string[] {
  const base = cfg.colors?.length ? cfg.colors : PALETTE;
  return Array.from({ length: n }, (_, i) => base[i % base.length]!);
}

function firstKey(row: Record<string, unknown>, index: number): string {
  return Object.keys(row)[index] ?? '';
}

export function renderChartSvg(
  chartType: string,
  data: ChartData,
  config: ChartConfig,
): string {
  if (!Array.isArray(data) || data.length === 0) {
    return renderEmpty(chartType);
  }
  switch (chartType) {
    case 'pie':
      return renderPie(data, config);
    case 'line':
      return renderLine(data, config, false);
    case 'area':
      return renderLine(data, config, true);
    default:
      return renderBar(data, config);
  }
}

function renderEmpty(chartType: string): string {
  return `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${W}\" height=\"${H}\" viewBox=\"0 0 ${W} ${H}\">\n  <rect width=\"${W}\" height=\"${H}\" fill=\"#f8fafc\" rx=\"8\"/>\n  <text x=\"${W / 2}\" y=\"${H / 2 - 8}\" text-anchor=\"middle\" fill=\"#94a3b8\" font-family=\"system-ui,sans-serif\" font-size=\"14\">${esc(chartType)} chart</text>\n  <text x=\"${W / 2}\" y=\"${H / 2 + 12}\" text-anchor=\"middle\" fill=\"#cbd5e1\" font-family=\"system-ui,sans-serif\" font-size=\"11\">no data</text>\n</svg>`;
}

function renderBar(data: ChartData, config: ChartConfig): string {
  const xKey = config.xKey ?? firstKey(data[0]!, 0);
  const yKey = config.yKey ?? firstKey(data[0]!, 1);
  const clrs = colors(config, data.length);

  const values = data.map((d) => Number(d[yKey] ?? 0));
  const maxVal = Math.max(...values, 1);
  const gap = INNER_W / data.length;
  const barW = Math.max(2, gap * 0.7);

  const bars = data.map((d, i) => {
    const val = Number(d[yKey] ?? 0);
    const bh = (val / maxVal) * INNER_H;
    const x = PAD.left + i * gap + (gap - barW) / 2;
    const y = PAD.top + INNER_H - bh;
    const cx = x + barW / 2;
    return [
      `  <rect x=\"${x.toFixed(1)}\" y=\"${y.toFixed(1)}\" width=\"${barW.toFixed(1)}\" height=\"${Math.max(bh, 0).toFixed(1)}\" fill=\"${clrs[i % clrs.length]}\" rx=\"3\"/>`,
      `  <text x=\"${cx.toFixed(1)}\" y=\"${(PAD.top + INNER_H + 13).toFixed(1)}\" text-anchor=\"end\" fill=\"#64748b\" font-size=\"9\" font-family=\"system-ui,sans-serif\" transform=\"rotate(-40,${cx.toFixed(1)},${(PAD.top + INNER_H + 13).toFixed(1)})\">${esc(d[xKey])}</text>`,
      val > 0
        ? `  <text x=\"${cx.toFixed(1)}\" y=\"${(y - 3).toFixed(1)}\" text-anchor=\"middle\" fill=\"#475569\" font-size=\"8\" font-family=\"system-ui,sans-serif\">${esc(val)}</text>`
        : '',
    ].join('\n');
  });

  const yTicks = buildYTicks(maxVal, 0);
  const xLabel = esc(config.labels?.[xKey] ?? xKey);
  const yLabel = esc(config.labels?.[yKey] ?? yKey);

  return svgWrap([yTicks, axes(), bars.join('\n'), axisLabels(xLabel, yLabel)]);
}

function renderPie(data: ChartData, config: ChartConfig): string {
  const nameKey = config.nameKey ?? config.xKey ?? firstKey(data[0]!, 0);
  const valueKey = config.valueKey ?? config.yKey ?? firstKey(data[0]!, 1);
  const clrs = colors(config, data.length);

  const values = data.map((d) => Math.abs(Number(d[valueKey] ?? 0)));
  const total = values.reduce((a, b) => a + b, 0) || 1;

  const cx = PAD.left + INNER_W * 0.5;
  const cy = PAD.top + INNER_H / 2;
  const r = Math.min(INNER_W * 0.45, INNER_H / 2) - 8;

  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const val = values[i]!;
    const sweep = (val / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const midAngle = angle - sweep / 2;
    const lx = cx + r * 0.65 * Math.cos(midAngle);
    const ly = cy + r * 0.65 * Math.sin(midAngle);
    const pct = ((val / total) * 100).toFixed(1);
    const c = clrs[i % clrs.length]!;
    return [
      `  <path d=\"M${cx.toFixed(1)},${cy.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z\" fill=\"${c}\" stroke=\"#fff\" stroke-width=\"2\"/>`,
      sweep > 0.2
        ? `  <text x=\"${lx.toFixed(1)}\" y=\"${ly.toFixed(1)}\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#fff\" font-size=\"9\" font-family=\"system-ui,sans-serif\">${pct}%</text>`
        : '',
    ].join('\n');
  });

  const legendX = PAD.left + INNER_W * 0.52 + 20;
  const legend = data.map((d, i) => {
    const ly = PAD.top + 8 + i * 18;
    const c = clrs[i % clrs.length]!;
    const nm = esc(d[nameKey]);
    const val = esc(values[i]);
    return [
      `  <rect x=\"${legendX}\" y=\"${ly.toFixed(1)}\" width=\"10\" height=\"10\" fill=\"${c}\" rx=\"2\"/>`,
      `  <text x=\"${(legendX + 14).toFixed(1)}\" y=\"${(ly + 9).toFixed(1)}\" fill=\"#475569\" font-size=\"9\" font-family=\"system-ui,sans-serif\">${nm} (${val})</text>`,
    ].join('\n');
  });

  return svgWrap([slices.join('\n'), legend.join('\n')]);
}

function renderLine(data: ChartData, config: ChartConfig, area: boolean): string {
  const xKey = config.xKey ?? firstKey(data[0]!, 0);
  const yKey = config.yKey ?? firstKey(data[0]!, 1);
  const clrs = colors(config, 1);
  const color = clrs[0]!;

  const values = data.map((d) => Number(d[yKey] ?? 0));
  const maxVal = Math.max(...values, 1);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;
  const n = data.length;

  const pts = data.map((d, i) => ({
    x: PAD.left + (n > 1 ? (i / (n - 1)) * INNER_W : INNER_W / 2),
    y: PAD.top + INNER_H - ((Number(d[yKey] ?? 0) - minVal) / range) * INNER_H,
    label: String(d[xKey] ?? ''),
  }));

  const pathD = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const areaD = `${pathD} L${last.x.toFixed(1)},${(PAD.top + INNER_H).toFixed(1)} L${first.x.toFixed(1)},${(PAD.top + INNER_H).toFixed(1)} Z`;

  const yTicks = buildYTicks(maxVal, minVal);
  const dots = pts
    .map(
      (p) =>
        `  <circle cx=\"${p.x.toFixed(1)}\" cy=\"${p.y.toFixed(1)}\" r=\"3\" fill=\"${color}\"/>`,
    )
    .join('\n');

  const step = Math.max(1, Math.ceil(n / 10));
  const xLabels = pts
    .filter((_, i) => i % step === 0 || i === n - 1)
    .map(
      (p) =>
        `  <text x=\"${p.x.toFixed(1)}\" y=\"${(PAD.top + INNER_H + 13).toFixed(1)}\" text-anchor=\"middle\" fill=\"#64748b\" font-size=\"9\" font-family=\"system-ui,sans-serif\">${esc(p.label)}</text>`,
    )
    .join('\n');

  const xLabel = esc(config.labels?.[xKey] ?? xKey);
  const yLabel = esc(config.labels?.[yKey] ?? yKey);

  return svgWrap([
    yTicks,
    axes(),
    area ? `  <path d=\"${areaD}\" fill=\"${color}\" opacity=\"0.15\"/>` : '',
    `  <path d=\"${pathD}\" fill=\"none\" stroke=\"${color}\" stroke-width=\"2\" stroke-linejoin=\"round\"/>`,
    dots,
    xLabels,
    axisLabels(xLabel, yLabel),
  ]);
}

function buildYTicks(maxVal: number, minVal: number): string {
  const TICKS = 4;
  const range = maxVal - minVal || 1;
  return Array.from({ length: TICKS + 1 }, (_, i) => {
    const v = minVal + (range * (TICKS - i)) / TICKS;
    const y = PAD.top + (i / TICKS) * INNER_H;
    return [
      `  <line x1=\"${PAD.left}\" y1=\"${y.toFixed(1)}\" x2=\"${(PAD.left + INNER_W).toFixed(1)}\" y2=\"${y.toFixed(1)}\" stroke=\"#e2e8f0\" stroke-width=\"1\"/>`,
      `  <text x=\"${(PAD.left - 6).toFixed(1)}\" y=\"${(y + 4).toFixed(1)}\" text-anchor=\"end\" fill=\"#94a3b8\" font-size=\"9\" font-family=\"system-ui,sans-serif\">${Math.round(v)}</text>`,
    ].join('\n');
  }).join('\n');
}

function axes(): string {
  return [
    `  <line x1=\"${PAD.left}\" y1=\"${PAD.top}\" x2=\"${PAD.left}\" y2=\"${(PAD.top + INNER_H).toFixed(1)}\" stroke=\"#cbd5e1\" stroke-width=\"1\"/>`,
    `  <line x1=\"${PAD.left}\" y1=\"${(PAD.top + INNER_H).toFixed(1)}\" x2=\"${(PAD.left + INNER_W).toFixed(1)}\" y2=\"${(PAD.top + INNER_H).toFixed(1)}\" stroke=\"#cbd5e1\" stroke-width=\"1\"/>`,
  ].join('\n');
}

function axisLabels(xLabel: string, yLabel: string): string {
  const xLabelY = H - 6;
  const xLabelX = PAD.left + INNER_W / 2;
  const yLabelX = 12;
  const yLabelY = PAD.top + INNER_H / 2;
  return [
    `  <text x=\"${xLabelX.toFixed(1)}\" y=\"${xLabelY}\" text-anchor=\"middle\" fill=\"#64748b\" font-size=\"11\" font-family=\"system-ui,sans-serif\">${xLabel}</text>`,
    `  <text x=\"${yLabelX}\" y=\"${yLabelY.toFixed(1)}\" text-anchor=\"middle\" fill=\"#64748b\" font-size=\"11\" font-family=\"system-ui,sans-serif\" transform=\"rotate(-90,${yLabelX},${yLabelY.toFixed(1)})\">${yLabel}</text>`,
  ].join('\n');
}

function svgWrap(parts: string[]): string {
  return `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${W}\" height=\"${H}\" viewBox=\"0 0 ${W} ${H}\">\n  <rect width=\"${W}\" height=\"${H}\" fill=\"#ffffff\" rx=\"8\"/>\n${parts.filter(Boolean).join('\n')}\n</svg>`;
}
