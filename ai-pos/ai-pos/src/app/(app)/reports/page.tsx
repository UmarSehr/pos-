import Link from 'next/link';
import { Percent, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fetchSales, getSettings, salesSummary, taxReport, topProducts, type GroupBy } from '@/lib/analytics';
import { TZ, localDateStr, rangeForPeriod, type Period } from '@/lib/dates';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import VisualRenderer from '@/components/VisualRenderer';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

const PERIODS: { id: Period; label: string; group: GroupBy }[] = [
  { id: 'day', label: 'Day', group: 'hour' },
  { id: 'week', label: 'Week', group: 'day' },
  { id: 'month', label: 'Month', group: 'day' },
  { id: 'year', label: 'Year', group: 'month' },
];

export default async function ReportsPage({ searchParams }: { searchParams: { period?: string; date?: string } }) {
  const sb = createClient();
  const period = (PERIODS.find((p) => p.id === searchParams.period) ?? PERIODS[2]);
  const today = localDateStr(new Date(), TZ);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today;
  const range = rangeForPeriod(period.id, anchor);

  const [settings, summary, tax, products, sales] = await Promise.all([
    getSettings(sb),
    salesSummary(sb, range, period.group),
    taxReport(sb, range),
    topProducts(sb, range, 10, 'revenue'),
    fetchSales(sb, range),
  ]);
  const cur = settings.currency;
  const t = summary.totals;
  const recent = [...sales].reverse().slice(0, 100);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Sales Reports" subtitle={`${range.label} · ${range.fromDate}${range.fromDate !== range.toDate ? ` → ${range.toDate}` : ''}`} />

      {/* Filters */}
      <form action="/reports" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div>
          <span className="label">Period</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {PERIODS.map((p) => (
              <Link
                key={p.id}
                href={`/reports?period=${p.id}&date=${anchor}`}
                className={`px-4 py-2 text-sm font-medium ${p.id === period.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="date">Date within period</label>
          <input id="date" name="date" type="date" defaultValue={anchor} max={today} className="input" />
        </div>
        <input type="hidden" name="period" value={period.id} />
        <button className="btn-secondary">Apply</button>
        <Link href={`/reports?period=${period.id}`} className="btn-ghost">Reset to today</Link>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total sales" value={formatMoney(t.total_collected, cur)} hint={`${t.orders} orders`} icon={Receipt} tone="indigo" />
        <StatCard label="Net sales" value={formatMoney(t.net_sales, cur)} hint={`Discounts ${formatMoney(t.discounts, cur)}`} icon={Wallet} tone="green" />
        <StatCard label="Tax collected" value={formatMoney(t.tax, cur)} icon={Percent} tone="amber" />
        <StatCard label="Gross profit" value={formatMoney(t.profit, cur)} hint={`Avg order ${formatMoney(t.avg_order_value, cur)}`} icon={TrendingUp} tone="green" />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          {t.orders > 0 ? (
            <VisualRenderer
              visual={{
                type: 'bar',
                title: `Sales by ${period.group}`,
                xKey: 'period',
                format: 'currency',
                series: [{ key: 'total', label: 'Total sales' }, { key: 'profit', label: 'Profit' }],
                data: summary.series,
              }}
            />
          ) : (
            <EmptyState>No sales in this period.</EmptyState>
          )}
        </div>

        {/* Tax calculation */}
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Tax calculation</h2>
          <dl className="space-y-2 text-sm">
            {tax.calculation.map((c, i) => {
              const strong = i === 3;
              return (
                <div key={c.step} className={`flex justify-between gap-3 ${strong ? 'rounded-lg bg-amber-50 px-2 py-1.5 font-semibold text-amber-900' : ''}`}>
                  <dt className={strong ? '' : 'text-slate-600'}>{c.step}</dt>
                  <dd className="tabular-nums">{formatMoney(c.amount, cur)}</dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Based on the tax rate recorded on each sale (current setting: {formatNumber(settings.tax_rate)}%). Confirm filing details with your accountant.
          </p>
        </div>
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <div className="card p-4">
          <VisualRenderer
            visual={{
              type: 'table',
              title: 'Top products by revenue',
              columns: [
                { key: 'product', label: 'Product' },
                { key: 'quantity', label: 'Units', format: 'number' },
                { key: 'revenue', label: 'Revenue', format: 'currency' },
              ],
              data: products.rows,
            }}
          />
          {products.rows.length === 0 && <EmptyState>No products sold in this period.</EmptyState>}
        </div>
        <div className="card p-4">
          <VisualRenderer
            visual={{
              type: 'table',
              title: 'Payment methods',
              columns: [
                { key: 'method', label: 'Method' },
                { key: 'orders', label: 'Orders', format: 'number' },
                { key: 'total', label: 'Total', format: 'currency' },
              ],
              data: summary.payment_methods,
            }}
          />
          {summary.payment_methods.length === 0 && <EmptyState>No payments in this period.</EmptyState>}
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Sales in this period</h2>
      <div className="card overflow-x-auto">
        {recent.length === 0 ? (
          <EmptyState>No sales in this period.</EmptyState>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Invoice</th><th className="th">Date</th><th className="th">Customer</th><th className="th">Payment</th>
                <th className="th text-right">Tax</th><th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="td"><Link href={`/receipt/${s.id}`} className="text-indigo-600 hover:underline">#{s.invoice_no}</Link></td>
                  <td className="td text-slate-600">{formatDateTime(s.created_at)}</td>
                  <td className="td">{s.customer_name}</td>
                  <td className="td capitalize text-slate-600">{s.payment_method}</td>
                  <td className="td text-right tabular-nums">{formatMoney(s.tax_amount, cur)}</td>
                  <td className="td text-right font-medium tabular-nums">{formatMoney(s.total, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {sales.length > recent.length && <p className="mt-2 text-xs text-slate-500">Showing the latest {recent.length} of {sales.length} sales.</p>}
    </div>
  );
}
