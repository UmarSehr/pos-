'use client';

/**
 * POS Terminal
 *  - search by name / SKU / barcode (barcode scanners "type" the code + Enter, which adds the item)
 *  - editable quantity, price and discount % per line
 *  - customer name / phone, payment method
 *  - checkout calls the `complete_sale` database function: stock is deducted, the sale is saved
 *    with a timestamp, and the totals are calculated server-side in ONE atomic transaction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Minus, Plus, Printer, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/components/SettingsProvider';
import { formatMoney, round2 } from '@/lib/format';
import { LOW_STOCK_THRESHOLD, PAYMENT_METHODS } from '@/lib/constants';
import type { Product } from '@/lib/types';

interface CartLine {
  product: Product;
  quantity: number;
  unit_price: number;
  discount_percent: number;
}

export default function POSPage() {
  const supabase = useMemo(() => createClient(), []);
  const { tax_rate, currency } = useSettings();
  const money = (n: number) => formatMoney(n, currency);

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [payment, setPayment] = useState<string>('cash');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSale, setLastSale] = useState<{ id: string; invoice_no: number; total: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async () => {
    const all: Product[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('products').select('*').order('name').range(from, from + 999);
      if (error) {
        setError(error.message);
        break;
      }
      all.push(...((data ?? []) as Product[]));
      if (!data || data.length < 1000) break;
    }
    setProducts(all);
    setLoadingProducts(false);
  }, [supabase]);

  useEffect(() => {
    loadProducts();
    searchRef.current?.focus();
  }, [loadProducts]);

  /* ---------- product search ---------- */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            (p.barcode ?? '').toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
        )
      : products;
    return list.slice(0, 60);
  }, [products, query]);

  function addToCart(p: Product) {
    setError('');
    setLastSale(null);
    if (p.quantity <= 0) return setError(`"${p.name}" is out of stock.`);
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) {
        if (c[i].quantity >= p.quantity) {
          setError(`Only ${p.quantity} of "${p.name}" in stock.`);
          return c;
        }
        return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...c, { product: p, quantity: 1, unit_price: Number(p.selling_price), discount_percent: 0 }];
    });
  }

  function onSearchEnter() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => (p.barcode ?? '').toLowerCase() === q || p.sku.toLowerCase() === q);
    const target = exact ?? (results.length === 1 ? results[0] : undefined);
    if (target) {
      addToCart(target);
      setQuery('');
    } else if (results.length === 0) {
      setError(`No product found for "${query}".`);
    }
  }

  function patchLine(id: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  }

  function setQty(line: CartLine, raw: number) {
    const q = Math.max(1, Math.min(line.product.quantity, Math.floor(raw) || 1));
    if (raw > line.product.quantity) setError(`Only ${line.product.quantity} of "${line.product.name}" in stock.`);
    patchLine(line.product.id, { quantity: q });
  }

  /* ---------- customer lookup by phone ---------- */
  async function lookupCustomer() {
    const phone = customerPhone.trim();
    if (!phone) return;
    const { data } = await supabase.from('customers').select('name').eq('phone', phone).maybeSingle();
    if (data?.name && !customerName.trim()) setCustomerName(data.name);
  }

  /* ---------- totals (the database recalculates these authoritatively) ---------- */
  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    for (const l of cart) {
      const gross = round2(l.quantity * l.unit_price);
      const line = round2(gross * (1 - l.discount_percent / 100));
      subtotal += gross;
      discount += gross - line;
    }
    const taxable = subtotal - discount;
    const tax = round2((taxable * tax_rate) / 100);
    return { subtotal: round2(subtotal), discount: round2(discount), tax, total: round2(taxable + tax) };
  }, [cart, tax_rate]);

  /* ---------- checkout ---------- */
  async function checkout() {
    if (cart.length === 0 || saving) return;
    setSaving(true);
    setError('');
    const { data: saleId, error: err } = await supabase.rpc('complete_sale', {
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_payment_method: payment,
      p_items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
      })),
    });

    if (err || !saleId) {
      setError(err?.message ?? 'Could not complete the sale.');
      await loadProducts(); // stock may have changed under us
      setSaving(false);
      return;
    }

    const { data: sale } = await supabase.from('sales').select('id,invoice_no,total').eq('id', saleId).single();
    setLastSale(sale ? { id: sale.id, invoice_no: sale.invoice_no, total: Number(sale.total) } : { id: saleId as string, invoice_no: 0, total: totals.total });
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setPayment('cash');
    setQuery('');
    await loadProducts();
    setSaving(false);
    searchRef.current?.focus();
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[1fr_440px]">
      {/* ------------ LEFT: product picker ------------ */}
      <section className="min-w-0">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">POS Terminal</h1>

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="input !py-3 pl-10 text-base"
            placeholder="Search product, SKU or scan barcode…  (Enter to add)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSearchEnter();
              }
            }}
          />
        </div>

        {loadingProducts ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
          </div>
        ) : products.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-500">
            No products yet. <Link href="/inventory" className="text-indigo-600 underline">Add products in Inventory</Link> to start selling.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {results.map((p) => {
              const out = p.quantity <= 0;
              return (
                <button
                  key={p.id}
                  disabled={out}
                  onClick={() => addToCart(p)}
                  className="card flex flex-col items-start p-3 text-left transition hover:border-indigo-300 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                  <span className="mt-0.5 text-xs text-slate-500">{p.sku}</span>
                  <span className="mt-2 text-base font-semibold tabular-nums">{money(Number(p.selling_price))}</span>
                  <span
                    className={`badge mt-1 ${
                      out ? 'bg-red-50 text-red-700' : p.quantity < LOW_STOCK_THRESHOLD ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {out ? 'Out of stock' : `${p.quantity} in stock`}
                  </span>
                </button>
              );
            })}
            {results.length === 0 && <p className="col-span-full py-6 text-sm text-slate-500">No matching products.</p>}
          </div>
        )}
      </section>

      {/* ------------ RIGHT: cart ------------ */}
      <aside className="card flex h-fit flex-col lg:sticky lg:top-6">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShoppingCart className="h-5 w-5 text-indigo-600" /> Current sale
          </h2>
          {cart.length > 0 && (
            <button className="text-xs text-slate-500 hover:text-red-600" onClick={() => setCart([])}>
              Clear
            </button>
          )}
        </div>

        {lastSale && (
          <div className="m-3 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="flex-1">
              <p className="font-medium text-emerald-800">
                Sale completed{lastSale.invoice_no ? ` · Invoice #${lastSale.invoice_no}` : ''} · {money(lastSale.total)}
              </p>
              <a href={`/receipt/${lastSale.id}?print=1`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-emerald-700 underline">
                <Printer className="h-4 w-4" /> Print receipt
              </a>
            </div>
            <button aria-label="Dismiss" onClick={() => setLastSale(null)}>
              <X className="h-4 w-4 text-emerald-700" />
            </button>
          </div>
        )}

        {error && (
          <div className="m-3 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error}</span>
            <button aria-label="Dismiss" onClick={() => setError('')}><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Lines */}
        <div className="max-h-[42vh] divide-y divide-slate-100 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">Cart is empty. Scan or pick a product.</p>
          ) : (
            cart.map((l) => (
              <div key={l.product.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.product.name}</p>
                    <p className="text-xs text-slate-500">{l.product.sku} · {l.product.quantity} in stock</p>
                  </div>
                  <button aria-label="Remove" className="text-slate-400 hover:text-red-600" onClick={() => setCart((c) => c.filter((x) => x.product.id !== l.product.id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2">
                  <div>
                    <span className="label">Qty</span>
                    <div className="flex items-center">
                      <button className="btn-secondary !px-2 !py-1.5" onClick={() => setQty(l, l.quantity - 1)} aria-label="Decrease"><Minus className="h-3 w-3" /></button>
                      <input type="number" min={1} className="input !w-14 !px-1 text-center" value={l.quantity} onChange={(e) => setQty(l, Number(e.target.value))} />
                      <button className="btn-secondary !px-2 !py-1.5" onClick={() => setQty(l, l.quantity + 1)} aria-label="Increase"><Plus className="h-3 w-3" /></button>
                    </div>
                  </div>
                  <div>
                    <span className="label">Price</span>
                    <input type="number" min={0} step="0.01" className="input !px-2" value={l.unit_price} onChange={(e) => patchLine(l.product.id, { unit_price: Math.max(0, Number(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <span className="label">Disc %</span>
                    <input type="number" min={0} max={100} step="0.5" className="input !px-2" value={l.discount_percent} onChange={(e) => patchLine(l.product.id, { discount_percent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
                  </div>
                  <p className="pb-2 text-right text-sm font-semibold tabular-nums">
                    {money(round2(l.quantity * l.unit_price * (1 - l.discount_percent / 100)))}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Customer + payment */}
        <div className="space-y-3 border-t border-slate-200 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="cphone">Customer phone</label>
              <input id="cphone" className="input" inputMode="tel" placeholder="03xx-xxxxxxx" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} onBlur={lookupCustomer} />
            </div>
            <div>
              <label className="label" htmlFor="cname">Customer name</label>
              <input id="cname" className="input" placeholder="Walk-in" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
          </div>
          <div>
            <span className="label">Payment</span>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayment(m)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium capitalize ${
                    payment === m ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Totals */}
        <div className="space-y-1 border-t border-slate-200 bg-slate-50 p-4 text-sm">
          <Row label="Subtotal" value={money(totals.subtotal)} />
          <Row label="Discount" value={`− ${money(totals.discount)}`} />
          <Row label={`Tax (${tax_rate}%)`} value={money(totals.tax)} />
          <div className="flex items-center justify-between pt-2 text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(totals.total)}</span>
          </div>
          <button className="btn-primary mt-3 w-full !py-3 text-base" disabled={cart.length === 0 || saving} onClick={checkout}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Complete sale
          </button>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
