import Link from 'next/link';
import { Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSettings } from '@/lib/analytics';
import { formatDate, formatMoney } from '@/lib/format';
import type { CustomerStat } from '@/lib/types';
import { EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string } }) {
  const sb = createClient();
  const settings = await getSettings(sb);
  const q = (searchParams.q ?? '').replace(/[,()%*\\]/g, ' ').trim();

  let query = sb.from('customer_stats').select('*').order('total_spent', { ascending: false }).limit(200);
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data, error } = await query;
  const customers = (data ?? []) as CustomerStat[];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Customers" subtitle="Everyone who has bought from you, ranked by total spend. Customers are created automatically at checkout." />

      <form className="mb-4 flex gap-2" action="/customers">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} className="input pl-9" placeholder="Search by name or phone…" />
        </div>
        <button className="btn-primary">Search</button>
      </form>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}

      <div className="card overflow-x-auto">
        {customers.length === 0 ? (
          <EmptyState>{q ? 'No customers match your search.' : 'No customers yet. Enter a name or phone number at checkout to start building customer history.'}</EmptyState>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Customer</th><th className="th">Phone</th><th className="th text-right">Orders</th>
                <th className="th text-right">Total spent</th><th className="th">Last purchase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="td font-medium">
                    <Link href={`/customers/${c.id}`} className="text-indigo-600 hover:underline">{c.name}</Link>
                  </td>
                  <td className="td text-slate-600">{c.phone ?? '—'}</td>
                  <td className="td text-right tabular-nums">{c.orders}</td>
                  <td className="td text-right tabular-nums">{formatMoney(c.total_spent, settings.currency)}</td>
                  <td className="td text-slate-600">{formatDate(c.last_purchase)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
