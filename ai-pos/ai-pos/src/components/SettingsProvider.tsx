'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_SETTINGS, type StoreSettings } from '@/lib/types';

const Ctx = createContext<StoreSettings>(DEFAULT_SETTINGS);

/** Makes the store settings (currency, tax rate, name) available to every client component. */
export function SettingsProvider({ settings, children }: { settings: StoreSettings; children: React.ReactNode }) {
  return <Ctx.Provider value={settings}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
