'use client';

/**
 * Renders the visuals the AI returns (and the charts used on Stock / Reports pages):
 * bar / line / area / pie charts (Recharts), tables and KPI cards.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useSettings } from './SettingsProvider';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import type { ValueFormat, Visual } from '@/lib/ai/visual-types';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16'];

function useFmt() {
  const { currency } = useSettings();
  return (v: unknown, f?: ValueFormat): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (f === 'date') return typeof v === 'string' ? formatDateTime(v) : String(v);
    if (f === 'currency' || f === 'number' || f === 'percent') {
      const n = Number(v);
      if (Number.isNaN(n)) return String(v);
      if (f === 'currency') return formatMoney(n, currency);
      if (f === 'percent') return `${n.toFixed(1)}%`;
      return formatNumber(n);
    }
    return typeof v === 'number' ? formatNumber(v) : String(v);
  };
}

/** "2026-10-18" -> "10-18", "2026-10" -> "Oct 26" to keep axes readable. */
function shortLabel(v: unknown): string {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(5);
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return s.length > 18 ? s.slice(0, 17) + '…' : s;
}

export default function VisualRenderer({ visual }: { visual: Visual }) {
  const fmt = useFmt();

  /* ---------------- KPI cards ---------------- */
  if (visual.type === 'cards') {
    return (
      <div>
        {visual.title && <p className="mb-2 text-sm font-semibold text-slate-700">{visual.title}</p>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {visual.items.map((it, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">{it.label}</p>
              <p className="mt-1 break-words text-xl font-semibold tabular-nums">{fmt(it.value, it.format)}</p>
              {it.hint && <p className="mt-0.5 text-xs text-slate-500">{it.hint}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ---------------- Table ---------------- */
  if (visual.type === 'table') {
    const rows = visual.data.slice(0, 100);
    return (
      <div>
        {visual.title && <p className="mb-2 text-sm font-semibold text-slate-700">{visual.title}</p>}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white">
            <thead className="bg-slate-50">
              <tr>
                {visual.columns.map((c) => (
                  <th key={c.key} className="th">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  {visual.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`td ${c.format === 'currency' || c.format === 'number' || c.format === 'percent' ? 'text-right tabular-nums' : ''}`}
                    >
                      {fmt(r[c.key], c.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visual.data.length > rows.length && (
          <p className="mt-1 text-xs text-slate-500">Showing first {rows.length} of {visual.data.length} rows.</p>
        )}
      </div>
    );
  }

  /* ---------------- Pie ---------------- */
  if (visual.type === 'pie') {
    const data = visual.data.map((r) => ({ name: String(r[visual.nameKey] ?? ''), value: Number(r[visual.valueKey]) || 0 }));
    return (
      <div>
        {visual.title && <p className="mb-2 text-sm font-semibold text-slate-700">{visual.title}</p>}
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(v, visual.format)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  /* ---------------- Bar / line / area ---------------- */
  const multi = visual.series.length > 1;
  const axis = { tick: { fontSize: 11, fill: '#64748b' }, tickLine: false, axisLine: { stroke: '#e2e8f0' } } as const;
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
      <XAxis dataKey={visual.xKey} tickFormatter={shortLabel} interval="preserveStartEnd" minTickGap={12} {...axis} />
      <YAxis tickFormatter={(v) => (visual.format === 'currency' ? formatNumber(v) : fmt(v, visual.format))} width={64} {...axis} />
      <Tooltip
        formatter={(v: any, name: any) => [fmt(v, visual.format), name]}
        labelFormatter={(l: any) => String(l)}
        cursor={{ fill: 'rgba(79,70,229,0.06)' }}
      />
      {multi && <Legend />}
    </>
  );

  return (
    <div>
      {visual.title && <p className="mb-2 text-sm font-semibold text-slate-700">{visual.title}</p>}
      <div className="h-72 w-full">
        <ResponsiveContainer>
          {visual.type === 'bar' ? (
            <BarChart data={visual.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              {visual.series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={COLORS[i % COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  stackId={visual.stacked ? 'a' : undefined}
                />
              ))}
            </BarChart>
          ) : visual.type === 'line' ? (
            <LineChart data={visual.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              {visual.series.map((s, i) => (
                <Line key={s.key} dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={visual.data.length < 32} />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={visual.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              {visual.series.map((s, i) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={COLORS[i % COLORS.length]}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.15}
                  stackId={visual.stacked ? 'a' : undefined}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
