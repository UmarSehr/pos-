# AI POS — Point of Sale with an AI Business Analyst

Next.js 14 · React · Tailwind CSS · Supabase (PostgreSQL + Auth) · Gemini / OpenAI / Claude

| Module | What it does |
| --- | --- |
| **AI Dashboard** (`/dashboard`) | Live KPIs + a ChatGPT-style assistant. Ask in plain language; get a text answer **and** charts / tables / cards built from your live Supabase data. |
| **POS Terminal** (`/pos`) | Search or scan barcode, edit qty / price / discount %, customer name + phone, payment method. Checkout deducts stock and saves the sale in one atomic database transaction, then opens a printable receipt. |
| **Inventory** (`/inventory`) | Add / edit / delete products (name, category, SKU, barcode, purchase & selling price, quantity, supplier). |
| **Stock Dashboard** (`/stock`) | Total products, total units, low stock (<10), out of stock, inventory value (cost & retail), sold vs remaining (cards + charts). |
| **Customers** (`/customers`) | Ranked list; per-customer history: what they bought, when, how much they spent. |
| **Reports** (`/reports`) | Day / Week / Month / Year, with a step-by-step tax calculation, profit, top products, payment methods. |
| **Settings** (`/settings`) | Store name, address, currency, **tax rate**, receipt footer. |

---

## 1. Set up Supabase (≈5 minutes)

1. Create a project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
   This creates the tables (`products`, `customers`, `sales`, `sale_items`, `settings`), the atomic `complete_sale()` checkout function, two views, and Row Level Security policies.
3. **Authentication → Providers → Email**: for quick local testing turn **off** "Confirm email" (otherwise new accounts must click a confirmation link before signing in).
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

## 2. Configure `.env.local`

```bash
cp .env.example .env.local
```

```ini
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_STORE_TIMEZONE=Asia/Karachi     # "today", reports and receipts use this timezone

AI_PROVIDER=gemini                          # gemini | openai | anthropic
GEMINI_API_KEY=...                          # https://aistudio.google.com/apikey
GEMINI_MODEL=gemini-2.5-flash               # change if Google retires/renames the model
# optional extra models (a model picker appears in the chat when more than one key is set)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
```

AI keys have no `NEXT_PUBLIC_` prefix, so they stay on the server and never reach the browser.

## 3. Run

```bash
npm install
npm run dev          # http://localhost:3000
```

1. Click **Create one** on the login page and register the first user.
2. **Settings** → set your store name and **tax rate** (default 18%).
3. **Inventory** → add products.
4. **POS Terminal** → make a sale → print the receipt.
5. **AI Dashboard** → ask questions. (The AI answers from your real sales, so make a few sales first.)

Production: `npm run build && npm start`, or deploy to Vercel and add the same environment variables.

---

## How the AI works

```
question ──► 1. PLAN    model picks data tools (never sees data, never writes SQL)
             2. FETCH   server runs those tools against Supabase as the signed-in user (RLS applies)
             3. ANSWER  model writes the reply + chart specs from the REAL results
             4. HYDRATE server fills charts/tables with exact rows from the results
          ◄── text answer + Recharts charts / tables / KPI cards
```

* **System prompt** (`src/lib/ai/prompts.ts`): *"You are an expert POS business analyst. You have access to the store's sales, product, and customer data. Always provide accurate, data-driven answers."* plus per-step rules.
* **Why tools instead of text-to-SQL?** Whitelisted, read-only, parameterised queries can't be tricked into touching other data, and the numbers are computed by tested code, not by the model.
* **Charts can't contain hallucinated numbers.** The model only names *which dataset* to plot (e.g. `t0.series`); the server copies the actual rows in.
* Every answer has a **"Data used"** drop-down showing which tools/arguments produced it.

Tools (`src/lib/ai/tools.ts`): `sales_summary`, `top_products`, `category_sales`, `top_customers`, `customer_profile`, `tax_report`, `low_stock`, `out_of_stock`, `inventory_summary`, `recent_sales`.

Handles all your example questions, e.g. *"What was my total sale today?"*, *"Show me sales of last month in a bar chart."*, *"Which customer bought the most? What is his buying behavior?"*, *"Which product is selling the most this week?"*, *"How much tax do I need to pay on this month's sales? Show calculation."*, *"Show me low stock products."*

### Swap or add models

`src/lib/ai/providers.ts` defines one tiny interface, `generateJSON({system, user})`. Gemini, OpenAI and Claude are already implemented. To add another (Mistral, Groq, local Ollama…): write a `createXxx()` function, add it to `REGISTRY`, add its key to `.env.local`. Nothing else changes.

### Add a new AI tool

Add an entry to `TOOLS` in `src/lib/ai/tools.ts` (name, description, args, `run`). The planner prompt picks it up automatically.

---

## Notes & decisions

* **Atomic checkout.** `complete_sale()` locks product rows (`FOR UPDATE`), refuses to oversell, deducts stock, upserts the customer (by phone), and calculates totals server-side. If anything fails, nothing is saved.
* **Tax.** Exclusive: `tax = (subtotal − discounts) × rate`. The rate used is stored on every sale, so changing it later never rewrites history. "Tax payable" in reports/AI is the sales tax *collected* on those sales — confirm filing rules with your accountant (the AI says so too).
* **Profit** = net sales − purchase cost of items sold (cost is snapshotted per sale line).
* **Security.** Row Level Security is on for every table; only signed-in users can read/write. This is a **single-store** design (every signed-in user sees all data). For multi-store/multi-tenant, add a `store_id` column and scope the policies on it.
* **Timezone.** "Today / this week / this month" follow `NEXT_PUBLIC_STORE_TIMEZONE`, so a 1 AM sale counts on the right business day even on a UTC server. Weeks start on Monday.
* **Low stock** = quantity 1–9; **out of stock** = 0 (threshold in `src/lib/constants.ts`).
* **Next.js version.** Pinned to the 14.x line as requested (`^14.2.25`). Run `npm update next` to pick up the latest 14.2 patch, and plan a move to a newer major when convenient.
* **Large catalogs.** The POS loads all products into the browser for instant search (fine for thousands). For 50k+ SKUs, swap that for server-side search.

## Project layout

```
supabase/schema.sql            tables, RLS, complete_sale(), views
src/middleware.ts              session refresh + redirect to /login
src/lib/analytics.ts           all report/AI queries (single source of truth for numbers)
src/lib/dates.ts               timezone-aware ranges (today, this_week, last_month…)
src/lib/ai/                    providers · tools · prompts · pipeline · visual hydration
src/app/api/ai/chat/route.ts   authenticated AI endpoint
src/app/(app)/                 dashboard, pos, inventory, stock, customers, reports, settings, receipt
src/components/                Sidebar, ChatPanel, VisualRenderer (Recharts), UI helpers
```
