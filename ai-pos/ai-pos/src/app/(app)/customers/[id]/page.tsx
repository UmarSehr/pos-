import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarClock, Receipt, Repeat, Wallet } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSettings, profileById } from '@/lib/analytics';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import type { Sale } from '@/lib/types';
import VisualRenderer from '@/components/VisualRenderer';
import { EmptyState, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** One customer: what they bought, when, and how much they spent. */
export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: customer } = await sb.from('customer_stats').select('*').eq('id', params.id).maybeSingle();
  if (!customer) notFound();

  const [settings, profile, { data: salesData }] = await Promise.all([
    getSettings(sb),
    profileById(sb, customer),
    sb
      .from('sales')
      .select('*, sale_items(id,product_name,quantity,unit_price,line_total,created_at)')
      .eq('customer_id', params.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);
  const cur = settings.currency;
  const sales = (salesData ?? []) as Sale[];
  const st = profile.stats;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> All customers
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
      <p className="mb-6 text-sm text-slate-500">{customer.phone ?? 'No phone on file'} · Customer since {formatDate(customer.created_at)}</p>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total spent" value={formatMoney(st.total_spent, cur)} icon={Wallet} tone="green" />
        <StatCard label="Orders" value={st.orders} hint={`Avg ${formatMoney(st.avg_order_value, cur)}`} icon={Receipt} tone="indigo" />
        <StatCard label="Last purchase" value={formatDate(st.last_purchase)} hint={st.days_since_last_purchase !== null ? `${st.days_since_last_purchase} days ago` : undefined} icon={CalendarClock} />
        <StatCard label="Buys every" value={st.avg_days_between_orders ? `${st.avg_days_between_orders} days` : '—'} icon={Repeat} />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <div className="card p-4">
          <VisualRenderer
            visual={{
              type: 'table',
              title: 'Favourite products',
              columns: [
                { key: 'name', label: 'Product' },
                { key: 'quantity', label: 'Units', format: 'number' },
                { key: 'spent', label: 'Spent', format: 'currency' },
              ],
              data: profile.top_products,
            }}
          />
          {profile.top_products.length === 0 && <EmptyState>No purchases yet.</EmptyState>}
        </div>
        <div className="card p-4">
          {profile.monthly_spend.length > 0 ? (
            <VisualRenderer
              visual={{
                type: 'bar',
                title: 'Spend by month',
                xKey: 'period',
                format: 'currency',
                series: [{ key: 'total', label: 'Spent' }],
                data: profile.monthly_spend,
              }}
            />
          ) : (
            <EmptyState>No spending history yet.</EmptyState>
          )}
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Purchase history</h2>
      <div className="space-y-3">
        {sales.length === 0 && <div className="card"><EmptyState>No purchases yet.</EmptyState></div>}
        {sales.map((s) => (
          <details key={s.id} className="card group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Invoice #{s.invoice_no}</p>
                <p className="text-xs text-slate-500">{formatDateTime(s.created_at)} · {s.payment_method}</p>
              </div>
              <p className="font-semibold tabular-nums">{formatMoney(s.total, cur)}</p>
            </summary>
            <div className="border-t border-slate-100 px-4 py-3">
              <table className="w-full text-sm">
                <tbody>
                  {(s.sale_items ?? []).map((i) => (
                    <tr key={i.id}>
                      <td className="py-1">{i.product_name}</td>
                      <td className="py-1 text-right text-slate-500">{i.quantity} × {formatMoney(i.unit_price, cur)}</td>
                      <td className="py-1 text-right tabular-nums">{formatMoney(i.line_total, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Link href={`/receipt/${s.id}`} className="mt-2 inline-block text-sm text-indigo-600 hover:underline">View receipt</Link>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
