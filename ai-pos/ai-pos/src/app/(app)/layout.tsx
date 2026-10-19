import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
import { SettingsProvider } from '@/components/SettingsProvider';
import { DEFAULT_SETTINGS, type StoreSettings } from '@/lib/types';

/** Layout for every signed-in page: sidebar + content. Re-checks auth server-side. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
  const settings: StoreSettings = {
    ...DEFAULT_SETTINGS,
    ...(data ?? {}),
    tax_rate: Number(data?.tax_rate ?? DEFAULT_SETTINGS.tax_rate),
  };

  return (
    <SettingsProvider settings={settings}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar storeName={settings.store_name} email={user.email ?? ''} />
        <main className="min-w-0 flex-1 p-4 md:p-8 print:p-0">{children}</main>
      </div>
    </SettingsProvider>
  );
}
