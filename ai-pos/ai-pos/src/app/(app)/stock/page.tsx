import { AlertTriangle, Boxes, Coins, Package, PackageX, ShoppingBag, Warehouse } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fetchProductStock, getSettings } from '@/lib/analytics';
import { LOW_STOCK_THRESHOLD } from '@/lib/constants';
import { formatMoney, formatNumber } from '@/lib/format';
import VisualRenderer from '@/components/VisualRenderer';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function StockDashboardPage() {
  const sb = createClient();
  const [products, settings] = await Promise.all([fetchProductStock(sb), getSettings(sb)]);
  const cur = settings.currency;

  const num = (v: unknown) => Number(v ?? 0) || 0;
  const units = products.reduce((a, p) => a + p.quantity, 0);
  const sold = products.reduce((a, p) => a + p.sold_qty, 0);
  const costValue = products.reduce((a, p) => a + p.quantity * num(p.purchase_price), 0);
  const retailValue = products.reduce((a, p) => a + p.quantity * num(p.selling_price), 0);
  const low = products.filter((p) => p.quantity > 0 && p.quantity < LOW_STOCK_THRESHOLD).sort((a, b) => a.quantity - b.quantity);
  const out = products.filter((p) => p.quantity === 0);

  // Sold vs remaining for the 10 products with the most movement
  const top = [...products]
    .sort((a, b) => b.sold_qty + b.quantity - (a.sold_qty + a.quantity))
    .slice(0, 10)
    .map((p) => ({ product: p.name, sold: p.sold_qty, remaining: p.quantity }));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Stock Dashboard" subtitle="Live inventory position across all products." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total products" value={formatNumber(products.length)} icon={Package} tone="indigo" />
        <StatCard label="Total stock quantity" value={formatNumber(units)} hint="units on hand" icon={Boxes} tone="indigo" />
        <StatCard label={`Low stock (<${LOW_STOCK_THRESHOLD})`} value={low.length} icon={AlertTriangle} tone="amber" />
        <StatCard label="Out of stock" value={out.length} icon={PackageX} tone="red" />
        <StatCard label="Inventory value (cost)" value={formatMoney(costValue, cur)} icon={Coins} tone="green" />
        <StatCard label="Inventory value (retail)" value={formatMoney(retailValue, cur)} hint={`Potential profit ${formatMoney(retailValue - costValue, cur)}`} icon={Warehouse} tone="green" />
        <StatCard label="Quantity sold" value={formatNumber(sold)} hint="all time" icon={ShoppingBag} />
        <StatCard label="Quantity remaining" value={formatNumber(units)} hint={sold + units ? `${Math.round((sold / (sold + units)) * 100)}% of stock sold` : undefined} icon={Boxes} />
      </div>

      {products.length === 0 ? (
        <div className="card"><EmptyState>No products yet. Add some in Inventory to see stock analytics.</EmptyState></div>
      ) : (
        <>
          <div className="mb-6 grid gap-5 lg:grid-cols-3">
            <div className="card p-4">
              <VisualRenderer
                visual={{
                  type: 'pie',
                  title: 'Sold vs remaining (units)',
                  nameKey: 'name',
                  valueKey: 'value',
                  format: 'number',
                  data: [{ name: 'Sold', value: sold }, { name: 'Remaining', value: units }],
                }}
              />
            </div>
            <div className="card p-4 lg:col-span-2">
              <VisualRenderer
                visual={{
                  type: 'bar',
                  title: 'Sold vs remaining — top 10 products by movement',
                  xKey: 'product',
                  format: 'number',
                  series: [{ key: 'sold', label: 'Sold' }, { key: 'remaining', label: 'Remaining' }],
                  data: top,
                }}
              />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <StockTable title="Low stock alert" tone="amber" rows={low} empty="Nothing running low. 🎉" />
            <StockTable title="Out of stock" tone="red" rows={out} empty="No products are out of stock." />
          </div>
        </>
      )}
    </div>
  );
}

function StockTable({ title, tone, rows, empty }: { title: string; tone: 'amber' | 'red'; rows: any[]; empty: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <span className={`badge ${tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="sticky top-0 bg-slate-50">
              <tr><th className="th">Product</th><th className="th">SKU</th><th className="th">Supplier</th><th className="th text-right">Qty</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="td font-medium">{p.name}</td>
                  <td className="td text-slate-600">{p.sku}</td>
                  <td className="td text-slate-600">{p.supplier || '—'}</td>
                  <td className="td text-right tabular-nums">{p.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
