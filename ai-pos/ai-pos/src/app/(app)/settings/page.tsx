'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/components/SettingsProvider';
import { PageHeader } from '@/components/ui';

/** Store name, receipt details, currency and the tax rate used for new sales. */
export default function SettingsPage() {
  const router = useRouter();
  const current = useSettings();
  const [f, setF] = useState({
    store_name: current.store_name,
    store_address: current.store_address ?? '',
    store_phone: current.store_phone ?? '',
    tax_rate: String(current.tax_rate),
    currency: current.currency,
    receipt_footer: current.receipt_footer ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const rate = Number(f.tax_rate);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) return setMsg({ ok: false, text: 'Tax rate must be between 0 and 100.' });
    if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) return setMsg({ ok: false, text: 'Currency must be a 3-letter code, e.g. PKR, USD.' });

    setSaving(true);
    setMsg(null);
    const { error } = await createClient()
      .from('settings')
      .upsert({
        id: 1,
        store_name: f.store_name.trim() || 'My Store',
        store_address: f.store_address.trim(),
        store_phone: f.store_phone.trim(),
        tax_rate: rate,
        currency: f.currency.trim().toUpperCase(),
        receipt_footer: f.receipt_footer.trim(),
      });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: 'Settings saved.' });
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" subtitle="Store details shown on receipts, and the tax rate applied to new sales." />
      <form onSubmit={save} className="card space-y-4 p-6">
        <div>
          <label className="label">Store name</label>
          <input className="input" value={f.store_name} onChange={set('store_name')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Address</label>
            <input className="input" value={f.store_address} onChange={set('store_address')} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={f.store_phone} onChange={set('store_phone')} />
          </div>
          <div>
            <label className="label">Sales tax rate (%)</label>
            <input className="input" type="number" min={0} max={100} step="0.01" value={f.tax_rate} onChange={set('tax_rate')} />
          </div>
          <div>
            <label className="label">Currency code</label>
            <input className="input uppercase" maxLength={3} value={f.currency} onChange={set('currency')} />
          </div>
        </div>
        <div>
          <label className="label">Receipt footer</label>
          <input className="input" value={f.receipt_footer} onChange={set('receipt_footer')} />
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          The tax rate applies to <strong>new</strong> sales. Each sale stores the rate used at the time, so past reports never change.
        </p>

        {msg && (
          <p className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {msg.ok && <CheckCircle2 className="h-4 w-4" />} {msg.text}
          </p>
        )}
        <button className="btn-primary" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save settings
        </button>
      </form>
    </div>
  );
}
