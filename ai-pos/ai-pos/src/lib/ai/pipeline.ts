/**
 * The AI analyst pipeline  (two model calls per question):
 *
 *   1. PLAN     model picks which data tools to call (it sees no data)
 *   2. FETCH    server runs those tools against Supabase (as the signed-in user)
 *   3. ANSWER   model writes a conversational answer + visual specs from the real results
 *   4. HYDRATE  server swaps visual specs for exact rows from the tool results
 *
 * Works with any provider that implements LLMProvider (Gemini / OpenAI / Claude / ...).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSettings } from '../analytics';
import { TZ, localDateStr } from '../dates';
import type { LLMProvider } from './providers';
import { composerSystem, plannerSystem } from './prompts';
import { runTool, toolNames } from './tools';
import { hydrateVisual } from './visuals';
import type { Visual } from './visual-types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  answer: string;
  visuals: Visual[];
  tools: { name: string; args: unknown; error?: string }[];
  provider: string;
  model: string;
}

/** Tolerant JSON parsing: strips ```json fences and surrounding prose. */
export function extractJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
    throw new Error('Model did not return valid JSON');
  }
}

/** Keep the model's view small: long arrays are cut (charts/tables still get the full rows). */
function trimForModel(v: unknown, maxRows = 60): unknown {
  if (Array.isArray(v)) {
    const head = v.slice(0, maxRows).map((x) => trimForModel(x, maxRows));
    return v.length > maxRows
      ? [...head, { _note: `${v.length - maxRows} more rows omitted from this view (charts/tables still use all rows)` }]
      : head;
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimForModel(x, maxRows)]));
  }
  return v;
}

function historyText(history: ChatTurn[]): string {
  if (!history.length) return '(none)';
  return history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content.slice(0, 600)}`)
    .join('\n');
}

export async function answerQuestion(opts: {
  sb: SupabaseClient;
  provider: LLMProvider;
  message: string;
  history: ChatTurn[];
}): Promise<ChatResult> {
  const { sb, provider, message, history } = opts;
  const now = new Date();
  const settings = await getSettings(sb);
  const ctx = {
    today: localDateStr(now),
    weekday: new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(now),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(now),
    timezone: TZ,
    currency: settings.currency,
    taxRate: settings.tax_rate,
    storeName: settings.store_name,
  };

  /* ---- 1. PLAN ---- */
  let planned: { name: string; args: unknown }[] = [];
  let planFailed = false;
  try {
    const raw = await provider.generateJSON({
      system: plannerSystem(ctx),
      user: `CONVERSATION SO FAR:\n${historyText(history)}\n\nLATEST USER QUESTION:\n${message}`,
      temperature: 0,
    });
    const plan = extractJson(raw);
    planned = (Array.isArray(plan?.tools) ? plan.tools : [])
      .filter((t: any) => t && toolNames.has(t.name))
      .slice(0, 4)
      .map((t: any) => ({ name: t.name as string, args: t.args ?? {} }));
  } catch (e: any) {
    // A provider/network error should surface to the user; only a bad plan is recoverable.
    if (String(e?.message).startsWith('AI provider error') || /too long|no content/i.test(String(e?.message))) throw e;
    planFailed = true;
  }

  /* ---- 2. FETCH ---- */
  const results = await Promise.all(
    planned.map(async (call) => {
      try {
        return { ...call, data: await runTool(sb, call.name, call.args, now), error: undefined as string | undefined };
      } catch (e: any) {
        return { ...call, data: undefined, error: String(e?.message ?? e) };
      }
    })
  );

  /* ---- 3. ANSWER ---- */
  const modelView = results.map((r, i) => ({
    id: `t${i}`,
    tool: r.name,
    args: r.args,
    result: r.error ? { error: r.error } : trimForModel(r.data),
  }));

  const raw = await provider.generateJSON({
    system: composerSystem(ctx),
    user:
      `CONVERSATION SO FAR:\n${historyText(history)}\n\nUSER QUESTION:\n${message}\n\n` +
      `TOOL RESULTS (id -> use as dataset path prefix, e.g. "t0.series"):\n` +
      (results.length
        ? JSON.stringify(modelView)
        : planFailed
          ? '[] (planning failed - no data was fetched)'
          : '[] (no data tools were needed)'),
    temperature: 0.2,
  });

  let answer = '';
  let visualSpecs: unknown[] = [];
  try {
    const parsed = extractJson(raw);
    answer = typeof parsed?.answer === 'string' ? parsed.answer : '';
    visualSpecs = Array.isArray(parsed?.visuals) ? parsed.visuals : [];
  } catch {
    answer = raw.trim(); // model ignored the JSON format - still show its text
  }
  if (!answer) answer = "I couldn't put together an answer for that. Could you rephrase the question?";

  /* ---- 4. HYDRATE visuals from real data ---- */
  const root: Record<string, unknown> = {};
  results.forEach((r, i) => {
    if (!r.error) root[`t${i}`] = r.data;
  });
  const visuals = visualSpecs.map((s) => hydrateVisual(s, root)).filter((v): v is Visual => v !== null);

  return {
    answer,
    visuals,
    tools: results.map((r) => ({ name: r.name, args: r.args, error: r.error })),
    provider: provider.name,
    model: provider.model,
  };
}
