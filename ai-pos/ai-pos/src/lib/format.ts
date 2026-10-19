import { TZ } from './dates';

export function formatMoney(value: number | string | null | undefined, currency = 'PKR'): string {
  const n = Number(value ?? 0) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatNumber(value: number | string | null | undefined): string {
  const n = Number(value ?? 0) || 0;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

/** Date + time in the store's timezone (same output on server and browser). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium' }).format(new Date(iso));
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
