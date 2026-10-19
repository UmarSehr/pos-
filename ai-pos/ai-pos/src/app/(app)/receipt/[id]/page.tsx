import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PrintControls from '@/components/PrintControls';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { DEFAULT_SETTINGS } from '@/lib/types';
import type { Sale } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Printable receipt / invoice. Works on thermal (80mm) and A4 printers. */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { print?: string };
}) {
  const sb = createClient();
  const [{ data: saleData }, { data: settingsData }] = await Promise.all([
    sb.from('sales').select('*, sale_items(*)').eq('id', params.id).maybeSingle(),
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (!saleData) notFound();

  const sale = saleData as Sale;
  const s = { ...DEFAULT_SETTINGS, ...(settingsData ?? {}) };
  const money = (n: number | string) => formatMoney(n, s.currency);
  const items = [...(sale.sale_items ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div className="mx-auto max-w-md">
      <PrintControls autoPrint={searchParams.print === '1'} />

      <div className="card p-6 text-sm print:border-0 print:p-0 print:shadow-none">
        <div className="text-center">
          <h1 className="text-lg font-bold">{s.store_name}</h1>
          {s.store_address && <p className="text-slate-600">{s.store_address}</p>}
          {s.store_phone && <p className="text-slate-600">Tel: {s.store_phone}</p>}
        </div>

        <div className="my-4 border-y border-dashed border-slate-300 py-3">
          <div className="flex justify-between"><span className="text-slate-500">Invoice #</span><span className="font-semibold">{sale.invoice_no}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Date</span><span>{formatDateTime(sale.created_at)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Customer</span><span>{sale.customer_name}</span></div>
          {sale.customer_phone && <div className="flex justify-between"><span className="text-slate-500">Phone</span><span>{sale.customer_phone}</span></div>}
          <div className="flex justify-between"><span className="text-slate-500">Payment</span><span className="capitalize">{sale.payment_method}</span></div>
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
              <th className="py-1">Item</th>
              <th className="py-1 text-right">Qty</th>
              <th className="py-1 text-right">Price</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="py-1.5 pr-2">
                  {i.product_name}
                  {Number(i.discount_percent) > 0 && <div className="text-xs text-slate-500">Discount {formatNumber(i.discount_percent)}%</div>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{i.quantity}</td>
                <td className="py-1.5 text-right tabular-nums">{formatNumber(i.unit_price)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatNumber(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 space-y-1 border-t border-dashed border-slate-300 pt-3">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(sale.subtotal)}</span></div>
          <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">− {money(sale.discount_total)}</span></div>
          <div className="flex justify-between"><span>Tax ({formatNumber(sale.tax_rate)}%)</span><span className="tabular-nums">{money(sale.tax_amount)}</span></div>
          <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-bold"><span>TOTAL</span><span className="tabular-nums">{money(sale.total)}</span></div>
        </div>

        {s.receipt_footer && <p className="mt-5 text-center text-slate-600">{s.receipt_footer}</p>}
      </div>
    </div>
  );
}
