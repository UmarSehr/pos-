'use client';

/** Inventory: full CRUD for products (add / edit / delete), with search and category filter. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/components/SettingsProvider';
import { formatMoney } from '@/lib/format';
import { LOW_STOCK_THRESHOLD } from '@/lib/constants';
import type { Product } from '@/lib/types';
import { EmptyState, PageHeader } from '@/components/ui';

interface FormState {
  id?: string;
  name: string;
  category: string;
  sku: string;
  barcode: string;
  purchase_price: string;
  selling_price: string;
  quantity: string;
  supplier: string;
}

const EMPTY: FormState = {
  name: '', category: 'General', sku: '', barcode: '', purchase_price: '', selling_price: '', quantity: '', supplier: '',
};

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);
  const { currency } = useSettings();
  const money = (n: number) => formatMoney(n, currency);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');

  const load = useCallback(async () => {
    const all: Product[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('products').select('*').order('name').range(from, from + 999);
      if (error) {
        setPageError(error.message);
        break;
      }
      all.push(...((data ?? []) as Product[]));
      if (!data || data.length < 1000) break;
    }
    setProducts(all);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === 'all' || p.category === category) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode ?? '').toLowerCase().includes(q) ||
          (p.supplier ?? '').toLowerCase().includes(q))
    );
  }, [products, search, category]);

  function openEdit(p: Product) {
    setError('');
    setForm({
      id: p.id,
      name: p.name,
      category: p.category,
      sku: p.sku,
      barcode: p.barcode ?? '',
      purchase_price: String(p.purchase_price),
      selling_price: String(p.selling_price),
      quantity: String(p.quantity),
      supplier: p.supplier ?? '',
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const purchase = Number(form.purchase_price);
    const selling = Number(form.selling_price);
    const qty = Number(form.quantity);
    if (!form.name.trim() || !form.sku.trim()) return setError('Name and SKU are required.');
    if ([purchase, selling].some((n) => Number.isNaN(n) || n < 0)) return setError('Prices must be 0 or more.');
    if (!Number.isInteger(qty) || qty < 0) return setError('Quantity must be a whole number, 0 or more.');

    setSaving(true);
    setError('');
    const row = {
      name: form.name.trim(),
      category: form.category.trim() || 'General',
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || null,
      purchase_price: purchase,
      selling_price: selling,
      quantity: qty,
      supplier: form.supplier.trim(),
    };
    const { error: err } = form.id
      ? await supabase.from('products').update(row).eq('id', form.id)
      : await supabase.from('products').insert(row);
    setSaving(false);

    if (err) {
      setError(err.code === '23505' ? 'That SKU or barcode is already used by another product.' : err.message);
      return;
    }
    setForm(null);
    load();
  }

  async function remove(p: Product) {
    if (!confirm(`Delete "${p.name}"? Past sales keep their history.`)) return;
    const { error: err } = await supabase.from('products').delete().eq('id', p.id);
    if (err) setPageError(err.message);
    else load();
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Inventory"
        subtitle={`${products.length} products`}
        actions={
          <button className="btn-primary" onClick={() => { setError(''); setForm({ ...EMPTY }); }}>
            <Plus className="h-4 w-4" /> Add product
          </button>
        }
      />

      {pageError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pageError}</p>}

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, SKU, barcode, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input !w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState>{products.length === 0 ? 'No products yet — click “Add product” to create your first one.' : 'No products match your filters.'}</EmptyState>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Product</th><th className="th">Category</th><th className="th">SKU</th>
                <th className="th text-right">Cost</th><th className="th text-right">Price</th><th className="th text-right">Qty</th>
                <th className="th">Supplier</th><th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="td font-medium">{p.name}</td>
                  <td className="td text-slate-600">{p.category}</td>
                  <td className="td text-slate-600">{p.sku}</td>
                  <td className="td text-right tabular-nums">{money(Number(p.purchase_price))}</td>
                  <td className="td text-right tabular-nums">{money(Number(p.selling_price))}</td>
                  <td className="td text-right">
                    <span className={`badge ${p.quantity === 0 ? 'bg-red-50 text-red-700' : p.quantity < LOW_STOCK_THRESHOLD ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {p.quantity}
                    </span>
                  </td>
                  <td className="td text-slate-600">{p.supplier || '—'}</td>
                  <td className="td whitespace-nowrap text-right">
                    <button className="btn-ghost !px-2" aria-label="Edit" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></button>
                    <button className="btn-ghost !px-2 text-red-600" aria-label="Delete" onClick={() => remove(p)}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / edit modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setForm(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{form.id ? 'Edit product' : 'Add product'}</h2>
              <button type="button" aria-label="Close" onClick={() => setForm(null)}><X className="h-5 w-5 text-slate-500" /></button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Product name *</label>
                <input className="input" required value={form.name} onChange={set('name')} autoFocus />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="input" list="cats" value={form.category} onChange={set('category')} />
                <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <label className="label">SKU *</label>
                <input className="input" required value={form.sku} onChange={set('sku')} />
              </div>
              <div className="col-span-2">
                <label className="label">Barcode (optional)</label>
                <input className="input" value={form.barcode} onChange={set('barcode')} />
              </div>
              <div>
                <label className="label">Purchase price</label>
                <input className="input" type="number" min={0} step="0.01" required value={form.purchase_price} onChange={set('purchase_price')} />
              </div>
              <div>
                <label className="label">Selling price</label>
                <input className="input" type="number" min={0} step="0.01" required value={form.selling_price} onChange={set('selling_price')} />
              </div>
              <div>
                <label className="label">Total quantity</label>
                <input className="input" type="number" min={0} step="1" required value={form.quantity} onChange={set('quantity')} />
              </div>
              <div>
                <label className="label">Supplier</label>
                <input className="input" value={form.supplier} onChange={set('supplier')} />
              </div>
            </div>

            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} {form.id ? 'Save changes' : 'Add product'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
