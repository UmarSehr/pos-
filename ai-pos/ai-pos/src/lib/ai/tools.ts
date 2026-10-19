/**
 * The data tools the AI assistant may call.
 *
 * Design choice: the model does NOT write SQL. It picks from this whitelist of
 * read-only, parameterised functions, each of which queries Supabase as the signed-in user
 * (so Row Level Security applies). This is safer and far more accurate than text-to-SQL.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRange, type RangeSpec } from '../dates';
import {
  categorySales,
  customerProfile,
  inventorySummary,
  lowStock,
  outOfStock,
  profileById,
  recentSales,
  salesSummary,
  taxReport,
  topCustomers,
  topProducts,
  type GroupBy,
} from '../analytics';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ToolDef {
  name: string;
  description: string;
  args: string;
  run: (sb: SupabaseClient, args: any, now: Date) => Promise<unknown>;
}

const limit = (v: unknown, def = 10, max = 50) => Math.min(Math.max(Math.floor(Number(v) || def), 1), max);
const GROUPS: GroupBy[] = ['none', 'hour', 'day', 'week', 'month'];

export const TOOLS: ToolDef[] = [
  {
    name: 'sales_summary',
    description:
      'Total sales, orders, discounts, tax, profit and average order value for a period, optionally broken into a time series. Use for "total sale today", "sales last month", "sales by day/month", "compare periods", profit questions, charts of sales over time.',
    args: '{"range": <range>, "group_by": "none|hour|day|week|month"}  (group_by "none" = totals only; use "day" for a week/month chart, "month" for a year chart, "hour" for a single day)',
    run: (sb, a, now) =>
      salesSummary(sb, resolveRange(a.range as RangeSpec, now), GROUPS.includes(a.group_by) ? a.group_by : 'none'),
  },
  {
    name: 'top_products',
    description: 'Best-selling products in a period, ranked by units sold, revenue or profit.',
    args: '{"range": <range>, "limit": 10, "metric": "quantity|revenue|profit"}',
    run: (sb, a, now) =>
      topProducts(
        sb,
        resolveRange(a.range as RangeSpec, now),
        limit(a.limit),
        ['quantity', 'revenue', 'profit'].includes(a.metric) ? a.metric : 'quantity'
      ),
  },
  {
    name: 'category_sales',
    description: 'Revenue, units and profit per product category in a period.',
    args: '{"range": <range>}',
    run: (sb, a, now) => categorySales(sb, resolveRange(a.range as RangeSpec, now)),
  },
  {
    name: 'top_customers',
    description: 'Customers ranked by total amount spent in a period (identified customers only; walk-in sales reported separately).',
    args: '{"range": <range>, "limit": 10}',
    run: (sb, a, now) => topCustomers(sb, resolveRange(a.range as RangeSpec, now), limit(a.limit)),
  },
  {
    name: 'customer_profile',
    description:
      'Full buying-behaviour profile of ONE customer: orders, total spent, frequency, favourite products/categories, monthly spend, recent purchases. Give "name_or_phone" for a named customer, OR "top_in_range" to profile whoever spent the most in that period.',
    args: '{"name_or_phone": "Ali"}  or  {"top_in_range": <range>}',
    run: async (sb, a, now) => {
      if (typeof a.name_or_phone === 'string' && a.name_or_phone.trim()) return customerProfile(sb, a.name_or_phone);
      if (a.top_in_range) {
        const top = await topCustomers(sb, resolveRange(a.top_in_range as RangeSpec, now), 1);
        const best = top.rows[0];
        if (!best) return { found: false, message: 'No identified customers have purchases in that period.' };
        return profileById(sb, { id: best.customer_id, name: best.customer, phone: best.phone, created_at: null });
      }
      return { found: false, message: 'Provide name_or_phone or top_in_range.' };
    },
  },
  {
    name: 'tax_report',
    description:
      'Sales-tax calculation for a period: gross sales, discounts, taxable sales, tax collected (the tax payable on those sales), with a step-by-step calculation and a daily breakdown.',
    args: '{"range": <range>}',
    run: (sb, a, now) => taxReport(sb, resolveRange(a.range as RangeSpec, now)),
  },
  {
    name: 'low_stock',
    description: 'Products running low on stock (quantity below the threshold, default 10, but not zero).',
    args: '{"threshold": 10}',
    run: (sb, a) => lowStock(sb, a.threshold ? limit(a.threshold, 10, 1000) : undefined),
  },
  {
    name: 'out_of_stock',
    description: 'Products with zero quantity left.',
    args: '{}',
    run: (sb) => outOfStock(sb),
  },
  {
    name: 'inventory_summary',
    description:
      'Inventory overview: total products, total units, inventory value (cost & retail), low/out-of-stock counts, units sold vs remaining, per-category stock.',
    args: '{}',
    run: (sb) => inventorySummary(sb),
  },
  {
    name: 'recent_sales',
    description: 'The most recent individual sales / invoices.',
    args: '{"limit": 10}',
    run: (sb, a) => recentSales(sb, limit(a.limit)),
  },
];

export const toolNames = new Set(TOOLS.map((t) => t.name));

export function toolCatalog(): string {
  return TOOLS.map((t) => `- ${t.name}: ${t.description}\n  args: ${t.args}`).join('\n');
}

export async function runTool(sb: SupabaseClient, name: string, args: unknown, now: Date): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}"`);
  return tool.run(sb, (args && typeof args === 'object' ? args : {}) as any, now);
}
