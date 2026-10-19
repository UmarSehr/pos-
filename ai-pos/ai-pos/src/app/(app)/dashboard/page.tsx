import { AlertTriangle, PackageX, Receipt, TrendingUp, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { salesSummary, getSettings } from '@/lib/analytics';
import { resolveRange } from '@/lib/dates';
import { LOW_STOCK_THRESHOLD } from '@/lib/constants';
import { formatMoney } from '@/lib/format';
import { availableProviders, defaultProviderName } from '@/lib/ai/providers';
import ChatPanel from '@/components/ChatPanel';
import { PageHeader, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const sb = createClient();
  const [settings, today, month, low, out, customers] = await Promise.all([
    getSettings(sb),
    salesSummary(sb, resolveRange('today')),
    salesSummary(sb, resolveRange('this_month')),
    sb.from('products').select('id', { count: 'exact', head: true }).gt('quantity', 0).lt('quantity', LOW_STOCK_THRESHOLD),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('quantity', 0),
    sb.from('customers').select('id', { count: 'exact', head: true }),
  ]);
  const cur = settings.currency;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="AI Dashboard" subtitle="Live numbers from your store, plus an AI analyst you can ask anything." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Sales today" value={formatMoney(today.totals.total_collected, cur)} hint={`${today.totals.orders} orders`} icon={Receipt} tone="indigo" />
        <StatCard label="Sales this month" value={formatMoney(month.totals.total_collected, cur)} hint={`Profit ${formatMoney(month.totals.profit, cur)}`} icon={TrendingUp} tone="green" />
        <StatCard label="Low stock" value={low.count ?? 0} hint={`under ${LOW_STOCK_THRESHOLD} units`} icon={AlertTriangle} tone="amber" />
        <StatCard label="Out of stock" value={out.count ?? 0} icon={PackageX} tone="red" />
        <StatCard label="Customers" value={customers.count ?? 0} icon={Users} />
      </div>

      <ChatPanel providers={availableProviders()} defaultProvider={defaultProviderName()} />
    </div>
  );
}
