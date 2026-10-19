/**
 * Turns the AI's visual *specs* into renderable visuals.
 *
 * IMPORTANT ACCURACY DESIGN: the model never copies numbers into a chart.
 * It only says WHICH dataset to plot (e.g. "t0.series") and which columns to use.
 * The server then pulls the exact rows from the tool results, so chart values can't be
 * mis-typed or hallucinated by the model.
 */
import type { ColumnDef, DataRow, SeriesDef, ValueFormat, Visual } from './visual-types';

const FORMATS: ValueFormat[] = ['currency', 'number', 'percent', 'text', 'date'];
const MAX_ROWS = 500;

const asFormat = (f: unknown): ValueFormat | undefined =>
  typeof f === 'string' && (FORMATS as string[]).includes(f) ? (f as ValueFormat) : undefined;

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** Resolve "t0.totals.total" against { t0: <tool result>, t1: ... } */
export function getPath(root: Record<string, unknown>, path: unknown): unknown {
  if (typeof path !== 'string' || !path) return undefined;
  let cur: any = root;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function dataset(root: Record<string, unknown>, path: unknown): DataRow[] | null {
  const v = getPath(root, path);
  if (!Array.isArray(v) || v.length === 0) return null;
  return (v as DataRow[]).filter((r) => r && typeof r === 'object').slice(0, MAX_ROWS);
}

function columnsOf(raw: any): ColumnDef[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((c) => c && typeof c.key === 'string')
    .map((c) => ({ key: c.key, label: asString(c.label, c.key), format: asFormat(c.format) }));
}

export function hydrateVisual(raw: any, root: Record<string, unknown>): Visual | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = asString(raw.title);

  switch (raw.type) {
    case 'bar':
    case 'line':
    case 'area': {
      const data = dataset(root, raw.dataset);
      const xKey = asString(raw.x ?? raw.xKey);
      const series: SeriesDef[] = (Array.isArray(raw.series) ? raw.series : [])
        .filter((s: any) => s && typeof s.key === 'string')
        .map((s: any) => ({ key: s.key, label: asString(s.label, s.key) }));
      if (!data || !xKey || series.length === 0) return null;
      return { type: raw.type, title, xKey, series, data, format: asFormat(raw.format), stacked: !!raw.stacked };
    }
    case 'pie': {
      const data = dataset(root, raw.dataset);
      const nameKey = asString(raw.name ?? raw.nameKey);
      const valueKey = asString(raw.value ?? raw.valueKey);
      if (!data || !nameKey || !valueKey) return null;
      return { type: 'pie', title, nameKey, valueKey, data: data.slice(0, 12), format: asFormat(raw.format) };
    }
    case 'table': {
      const data = dataset(root, raw.dataset);
      const columns = columnsOf(raw.columns);
      if (!data) return null;
      const cols = columns.length
        ? columns
        : Object.keys(data[0]).map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
      return { type: 'table', title, columns: cols, data };
    }
    case 'cards': {
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .map((it: any) => {
          if (!it || typeof it.label !== 'string') return null;
          const resolved = it.path !== undefined ? getPath(root, it.path) : undefined;
          const value = resolved ?? it.value;
          if (value === undefined || value === null || typeof value === 'object') return null;
          return {
            label: it.label,
            value: value as string | number,
            format: asFormat(it.format),
            hint: typeof it.hint === 'string' ? it.hint : undefined,
          };
        })
        .filter(Boolean);
      if (items.length === 0) return null;
      return { type: 'cards', title: title || undefined, items };
    }
    default:
      return null;
  }
}
