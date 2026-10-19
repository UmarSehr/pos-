/**
 * Analytics queries over the live Supabase data.
 * Used by BOTH the Reports / Dashboard pages and the AI assistant's tools, so the
 * numbers the AI quotes are exactly the numbers shown in the rest of the app.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TZ,
  addDays,
  localDateStr,
  localHour,
  mondayOf,
  monthLabel,
  type ResolvedRange,
} from './dates';
import { LOW_STOCK_THRESHOLD } from './constants';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const PAGE = 1000;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => Number(v ?? 0) || 0;

/** Supabase returns max 1000 rows per request - this pages through all of them. */
export async function fetchAll<T = Row>(make: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function fetchSales(sb: SupabaseClient, range: ResolvedRange): Promise<Row[]> {
  return fetchAll((a, b) =>
    sb
      .from('sales')
      .select(
        'id,invoice_no,customer_id,customer_name,customer_phone,subtotal,discount_total,tax_rate,tax_amount,total,payment_method,created_at'
      )
      .gte('created_at', range.start.toISOString())
      .lt('created_at', range.end.toISOString())
      .order('created_at', { ascending: true })
      .order('id')
      .range(a, b)
  );
}

export function fetchItems(sb: SupabaseClient, range: ResolvedRange): Promise<Row[]> {
  return fetchAll((a, b) =>
    sb
      .from('sale_items')
      .select('sale_id,product_id,product_name,category,quantity,unit_price,discount_percent,line_total,unit_cost,created_at')
      .gte('created_at', range.start.toISOString())
      .lt('created_at', range.end.toISOString())
      .order('created_at', { ascending: true })
      .order('id')
      .range(a, b)
  );
}

export async function getSettings(sb: SupabaseClient) {
  const { data } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
  return {
    store_name: data?.store_name ?? 'My Store',
    tax_rate: num(data?.tax_rate ?? 18),
    currency: (data?.currency as string) ?? 'PKR',
  };
}

/* ------------------------------------------------------------------ */
/*  Sales summary / time series                                        */
/* ------------------------------------------------------------------ */
export type GroupBy = 'none' | 'hour' | 'day' | 'week' | 'month';

function bucketKey(iso: string, g: GroupBy): string {
  const d = new Date(iso);
  if (g === 'hour') return `${String(localHour(d)).padStart(2, '0')}:00`;
  const ds = localDateStr(d);
  if (g === 'day') return ds;
  if (g === 'week') return mondayOf(ds);
  if (g === 'month') return ds.slice(0, 7);
  return 'all';
}

/** Every bucket label in the range (so charts show zero-sale days instead of gaps). */
function allKeys(range: ResolvedRange, g: GroupBy): string[] | null {
  const today = localDateStr(new Date());
  const last = range.toDate > today ? today : range.toDate;
  if (g === 'hour') return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  if (g === 'day') {
    const keys: string[] = [];
    for (let d = range.fromDate; d <= last && keys.length <= 400; d = addDays(d, 1)) keys.push(d);
    return keys.length > 400 ? null : keys;
  }
  if (g === 'month') {
    const keys: string[] = [];
    let ym = range.fromDate.slice(0, 7);
    const lastYm = last.slice(0, 7);
    while (ym <= lastYm && keys.length < 240) {
      keys.push(ym);
      const [y, m] = ym.split('-').map(Number);
      ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    return keys;
  }
  return null;
}

export async function salesSummary(sb: SupabaseClient, range: ResolvedRange, groupBy: GroupBy = 'none') {
  const [sales, items] = await Promise.all([fetchSales(sb, range), fetchItems(sb, range)]);

  const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + num(r[k]), 0);
  const gross = sum(sales, 'subtotal');
  const discounts = sum(sales, 'discount_total');
  const tax = sum(sales, 'tax_amount');
  const total = sum(sales, 'total');
  const net = gross - discounts;
  const cost = items.reduce((a, i) => a + num(i.quantity) * num(i.unit_cost), 0);

  const totals = {
    orders: sales.length,
    units_sold: items.reduce((a, i) => a + num(i.quantity), 0),
    gross_sales: r2(gross),
    discounts: r2(discounts),
    net_sales: r2(net),
    tax: r2(tax),
    total_collected: r2(total),
    cost_of_goods: r2(cost),
    profit: r2(net - cost),
    avg_order_value: sales.length ? r2(total / sales.length) : 0,
  };

  let series: Row[] = [];
  if (groupBy !== 'none') {
    const map = new Map<string, Row>();
    const get = (k: string) => {
      if (!map.has(k)) map.set(k, { period: k, orders: 0, net_sales: 0, tax: 0, total: 0, profit: 0 });
      return map.get(k)!;
    };
    allKeys(range, groupBy)?.forEach(get);
    for (const s of sales) {
      const b = get(bucketKey(s.created_at, groupBy));
      b.orders += 1;
      b.net_sales += num(s.subtotal) - num(s.discount_total);
      b.tax += num(s.tax_amount);
      b.total += num(s.total);
    }
    for (const i of items) {
      get(bucketKey(i.created_at, groupBy)).profit += num(i.line_total) - num(i.quantity) * num(i.unit_cost);
    }
    series = [...map.values()]
      .sort((a, b) => String(a.period).localeCompare(String(b.period)))
      .map((b) => ({
        ...b,
        net_sales: r2(b.net_sales),
        tax: r2(b.tax),
        total: r2(b.total),
        profit: r2(b.profit),
      }));
  }

  const withSales = series.filter((s) => s.orders > 0);
  const best = withSales.reduce<Row | null>((m, s) => (!m || s.total > m.total ? s : m), null);
  const worst = withSales.reduce<Row | null>((m, s) => (!m || s.total < m.total ? s : m), null);

  const payMap = new Map<string, { method: string; orders: number; total: number }>();
  for (const s of sales) {
    const p = payMap.get(s.payment_method) ?? { method: s.payment_method, orders: 0, total: 0 };
    p.orders += 1;
    p.total += num(s.total);
    payMap.set(s.payment_method, p);
  }

  return {
    range: { label: range.label, from: range.fromDate, to: range.toDate },
    group_by: groupBy,
    totals,
    series,
    best_period: best ? { period: best.period, total: best.total, orders: best.orders } : null,
    weakest_period_with_sales: worst ? { period: worst.period, total: worst.total, orders: worst.orders } : null,
    payment_methods: [...payMap.values()].map((p) => ({ ...p, total: r2(p.total) })),
    note: 'total = what customers paid (incl. tax); net_sales = after discounts, before tax; profit = net_sales - purchase cost of items sold.',
  };
}

/* ------------------------------------------------------------------ */
/*  Products & categories                                              */
/* ------------------------------------------------------------------ */
export async function topProducts(
  sb: SupabaseClient,
  range: ResolvedRange,
  limit = 10,
  metric: 'quantity' | 'revenue' | 'profit' = 'quantity'
) {
  const items = await fetchItems(sb, range);
  const map = new Map<string, Row>();
  for (const i of items) {
    const key = i.product_id ?? `name:${i.product_name}`;
    const p = map.get(key) ?? { product: i.product_name, category: i.category, quantity: 0, revenue: 0, profit: 0 };
    p.quantity += num(i.quantity);
    p.revenue += num(i.line_total);
    p.profit += num(i.line_total) - num(i.quantity) * num(i.unit_cost);
    map.set(key, p);
  }
  const rows = [...map.values()]
    .map((p): Row => ({ ...p, revenue: r2(p.revenue), profit: r2(p.profit) }))
    .sort((a: Row, b: Row) => b[metric] - a[metric])
    .slice(0, limit)
    .map((p, idx): Row => ({ rank: idx + 1, ...p }));
  return {
    range: { label: range.label, from: range.fromDate, to: range.toDate },
    ranked_by: metric,
    distinct_products_sold: map.size,
    rows,
  };
}

export async function categorySales(sb: SupabaseClient, range: ResolvedRange) {
  const items = await fetchItems(sb, range);
  const map = new Map<string, Row>();
  for (const i of items) {
    const c = map.get(i.category) ?? { category: i.category, units: 0, revenue: 0, profit: 0 };
    c.units += num(i.quantity);
    c.revenue += num(i.line_total);
    c.profit += num(i.line_total) - num(i.quantity) * num(i.unit_cost);
    map.set(i.category, c);
  }
  const rows = [...map.values()]
    .map((c) => ({ ...c, revenue: r2(c.revenue), profit: r2(c.profit) }))
    .sort((a, b) => b.revenue - a.revenue);
  return { range: { label: range.label, from: range.fromDate, to: range.toDate }, rows };
}

/* ------------------------------------------------------------------ */
/*  Customers                                                          */
/* ------------------------------------------------------------------ */
export async function topCustomers(sb: SupabaseClient, range: ResolvedRange, limit = 10) {
  const sales = await fetchSales(sb, range);
  const map = new Map<string, Row>();
  let walkIn = { orders: 0, total: 0 };
  for (const s of sales) {
    if (!s.customer_id) {
      walkIn = { orders: walkIn.orders + 1, total: walkIn.total + num(s.total) };
      continue;
    }
    const c = map.get(s.customer_id) ?? {
      customer_id: s.customer_id,
      customer: s.customer_name,
      phone: s.customer_phone,
      orders: 0,
      total_spent: 0,
      last_purchase: s.created_at,
    };
    c.orders += 1;
    c.total_spent += num(s.total);
    if (s.created_at > c.last_purchase) c.last_purchase = s.created_at;
    map.set(s.customer_id, c);
  }
  const rows = [...map.values()]
    .map((c): Row => ({ ...c, total_spent: r2(c.total_spent), avg_order: r2(c.total_spent / c.orders) }))
    .sort((a: Row, b: Row) => b.total_spent - a.total_spent)
    .slice(0, limit)
    .map((c, i): Row => ({ rank: i + 1, ...c }));
  return {
    range: { label: range.label, from: range.fromDate, to: range.toDate },
    identified_customers: map.size,
    walk_in_sales: { orders: walkIn.orders, total: r2(walkIn.total) },
    rows,
  };
}

/** Full buying-behaviour profile for one customer (looked up by name or phone). */
export async function customerProfile(sb: SupabaseClient, query: string) {
  const safe = query.replace(/[,()%*\\]/g, ' ').trim();
  if (!safe) return { found: false, message: 'No customer name or phone given.' };

  const { data: matches, error } = await sb
    .from('customer_stats')
    .select('*')
    .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`)
    .order('total_spent', { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  if (!matches?.length) return { found: false, message: `No customer matching "${query}".` };

  const lower = safe.toLowerCase();
  const chosen = matches.find((m) => m.name.toLowerCase() === lower || m.phone === safe) ?? matches[0];
  return profileById(sb, chosen, matches.filter((m) => m.id !== chosen.id));
}

export async function profileById(sb: SupabaseClient, c: Row, others: Row[] = []) {
  const [sales, items] = await Promise.all([
    fetchAll((a, b) =>
      sb.from('sales').select('*').eq('customer_id', c.id).order('created_at', { ascending: true }).order('id').range(a, b)
    ),
    fetchAll((a, b) =>
      sb
        .from('sale_items')
        .select('sale_id,product_name,category,quantity,line_total,sales!inner(customer_id)')
        .eq('sales.customer_id', c.id)
        .order('id')
        .range(a, b)
    ),
  ]);

  const total = sales.reduce((a, s) => a + num(s.total), 0);
  const first = sales[0]?.created_at ?? null;
  const last = sales[sales.length - 1]?.created_at ?? null;
  const dayMs = 86_400_000;
  const spanDays = first && last ? (new Date(last).getTime() - new Date(first).getTime()) / dayMs : 0;

  const agg = (keyFn: (i: Row) => string) => {
    const m = new Map<string, Row>();
    for (const i of items) {
      const k = keyFn(i);
      const r = m.get(k) ?? { name: k, quantity: 0, spent: 0 };
      r.quantity += num(i.quantity);
      r.spent += num(i.line_total);
      m.set(k, r);
    }
    return [...m.values()].map((r) => ({ ...r, spent: r2(r.spent) })).sort((a, b) => b.spent - a.spent);
  };

  const monthly = new Map<string, number>();
  const pay = new Map<string, number>();
  for (const s of sales) {
    const ym = localDateStr(new Date(s.created_at)).slice(0, 7);
    monthly.set(ym, (monthly.get(ym) ?? 0) + num(s.total));
    pay.set(s.payment_method, (pay.get(s.payment_method) ?? 0) + 1);
  }

  const itemsBySale = new Map<string, string[]>();
  for (const i of items) {
    const arr = itemsBySale.get(i.sale_id) ?? [];
    arr.push(`${i.quantity}× ${i.product_name}`);
    itemsBySale.set(i.sale_id, arr);
  }

  return {
    found: true,
    customer: { id: c.id, name: c.name, phone: c.phone, customer_since: c.created_at },
    stats: {
      orders: sales.length,
      total_spent: r2(total),
      avg_order_value: sales.length ? r2(total / sales.length) : 0,
      units_bought: items.reduce((a, i) => a + num(i.quantity), 0),
      total_discounts_received: r2(sales.reduce((a, s) => a + num(s.discount_total), 0)),
      first_purchase: first,
      last_purchase: last,
      days_since_last_purchase: last ? Math.floor((Date.now() - new Date(last).getTime()) / dayMs) : null,
      avg_days_between_orders: sales.length > 1 ? r2(spanDays / (sales.length - 1)) : null,
    },
    top_products: agg((i) => i.product_name).slice(0, 8),
    top_categories: agg((i) => i.category).slice(0, 5),
    payment_methods: [...pay.entries()].map(([method, orders]) => ({ method, orders })),
    monthly_spend: [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, t]) => ({ period, label: monthLabel(period), total: r2(t) })),
    recent_orders: [...sales]
      .reverse()
      .slice(0, 10)
      .map((s) => ({
        invoice_no: s.invoice_no,
        date: s.created_at,
        total: num(s.total),
        items: (itemsBySale.get(s.id) ?? []).join(', '),
      })),
    other_matches: others.map((o) => ({ name: o.name, phone: o.phone, total_spent: o.total_spent })),
  };
}

/* ------------------------------------------------------------------ */
/*  Tax                                                                */
/* ------------------------------------------------------------------ */
export async function taxReport(sb: SupabaseClient, range: ResolvedRange) {
  const [sales, settings] = await Promise.all([fetchSales(sb, range), getSettings(sb)]);
  const sum = (k: string) => sales.reduce((a, s) => a + num(s[k]), 0);
  const gross = sum('subtotal');
  const discounts = sum('discount_total');
  const taxable = gross - discounts;
  const tax = sum('tax_amount');

  const byRate = new Map<number, { rate: number; taxable_sales: number; tax: number; orders: number }>();
  const byDay = new Map<string, { period: string; taxable_sales: number; tax: number }>();
  for (const s of sales) {
    const rate = num(s.tax_rate);
    const r = byRate.get(rate) ?? { rate, taxable_sales: 0, tax: 0, orders: 0 };
    r.taxable_sales += num(s.subtotal) - num(s.discount_total);
    r.tax += num(s.tax_amount);
    r.orders += 1;
    byRate.set(rate, r);

    const day = localDateStr(new Date(s.created_at));
    const d = byDay.get(day) ?? { period: day, taxable_sales: 0, tax: 0 };
    d.taxable_sales += num(s.subtotal) - num(s.discount_total);
    d.tax += num(s.tax_amount);
    byDay.set(day, d);
  }

  const rates = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  const rateText = rates.length === 1 ? `${rates[0].rate}%` : 'recorded rate per sale';

  return {
    range: { label: range.label, from: range.fromDate, to: range.toDate },
    current_tax_rate_percent: settings.tax_rate,
    orders: sales.length,
    gross_sales: r2(gross),
    discounts: r2(discounts),
    taxable_sales: r2(taxable),
    tax_collected: r2(tax),
    total_collected_incl_tax: r2(sum('total')),
    calculation: [
      { step: 'Gross sales (before discounts)', amount: r2(gross) },
      { step: 'Less: discounts', amount: -r2(discounts) },
      { step: 'Taxable sales (net of discounts)', amount: r2(taxable) },
      { step: `Sales tax @ ${rateText}`, amount: r2(tax) },
      { step: 'Total collected from customers (incl. tax)', amount: r2(sum('total')) },
    ],
    by_rate: rates.map((r) => ({ ...r, taxable_sales: r2(r.taxable_sales), tax: r2(r.tax) })),
    daily: [...byDay.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((d) => ({ ...d, taxable_sales: r2(d.taxable_sales), tax: r2(d.tax) })),
    note: 'Tax is the sales tax collected, computed on sales after discounts at the rate recorded on each sale. It is an estimate of the liability, not tax advice.',
  };
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */
export function fetchProductStock(sb: SupabaseClient): Promise<Row[]> {
  return fetchAll((a, b) => sb.from('product_stock').select('*').order('name').order('id').range(a, b));
}

export async function lowStock(sb: SupabaseClient, threshold = LOW_STOCK_THRESHOLD) {
  const products = await fetchProductStock(sb);
  const low = products
    .filter((p) => p.quantity > 0 && p.quantity < threshold)
    .sort((a, b) => a.quantity - b.quantity)
    .map((p) => ({
      product: p.name,
      sku: p.sku,
      category: p.category,
      quantity: p.quantity,
      supplier: p.supplier,
      selling_price: num(p.selling_price),
    }));
  return {
    threshold,
    low_stock_count: low.length,
    out_of_stock_count: products.filter((p) => p.quantity === 0).length,
    rows: low,
  };
}

export async function outOfStock(sb: SupabaseClient) {
  const products = await fetchProductStock(sb);
  const rows = products
    .filter((p) => p.quantity === 0)
    .map((p) => ({ product: p.name, sku: p.sku, category: p.category, supplier: p.supplier, sold_all_time: p.sold_qty }));
  return { out_of_stock_count: rows.length, rows };
}

export async function inventorySummary(sb: SupabaseClient) {
  const products = await fetchProductStock(sb);
  const units = products.reduce((a, p) => a + p.quantity, 0);
  const costValue = products.reduce((a, p) => a + p.quantity * num(p.purchase_price), 0);
  const retailValue = products.reduce((a, p) => a + p.quantity * num(p.selling_price), 0);
  const sold = products.reduce((a, p) => a + p.sold_qty, 0);

  const cat = new Map<string, Row>();
  for (const p of products) {
    const c = cat.get(p.category) ?? { category: p.category, products: 0, units: 0, cost_value: 0 };
    c.products += 1;
    c.units += p.quantity;
    c.cost_value += p.quantity * num(p.purchase_price);
    cat.set(p.category, c);
  }

  return {
    total_products: products.length,
    total_stock_units: units,
    low_stock_count: products.filter((p) => p.quantity > 0 && p.quantity < LOW_STOCK_THRESHOLD).length,
    out_of_stock_count: products.filter((p) => p.quantity === 0).length,
    inventory_value_at_cost: r2(costValue),
    inventory_value_at_retail: r2(retailValue),
    potential_gross_profit: r2(retailValue - costValue),
    units_sold_all_time: sold,
    units_remaining: units,
    by_category: [...cat.values()]
      .map((c) => ({ ...c, cost_value: r2(c.cost_value) }))
      .sort((a, b) => b.cost_value - a.cost_value),
  };
}

export async function recentSales(sb: SupabaseClient, limit = 10) {
  const { data, error } = await sb
    .from('sales')
    .select('invoice_no,customer_name,total,payment_method,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return { rows: data ?? [] };
}

export { TZ };
