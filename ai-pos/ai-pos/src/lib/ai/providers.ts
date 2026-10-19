/**
 * Provider-agnostic LLM layer.
 *
 * Every model sits behind the same tiny interface (`LLMProvider.generateJSON`).
 * To ADD another model (Mistral, Groq, a local Ollama server, ...):
 *   1. write a `create...` function below that returns an LLMProvider
 *   2. register it in REGISTRY
 *   3. add its key to .env.local
 * Nothing else in the app needs to change.
 *
 * API keys are read from process.env on the server only - they never reach the browser.
 */

export type ProviderName = 'gemini' | 'openai' | 'anthropic';

export interface GenerateOptions {
  system: string;
  user: string;
  temperature?: number;
}

export interface LLMProvider {
  name: ProviderName;
  label: string;
  model: string;
  /** Returns the model's raw text, which the caller parses as JSON. */
  generateJSON(opts: GenerateOptions): Promise<string>;
}

const TIMEOUT_MS = 55_000;

async function postJSON(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.message ?? text.slice(0, 300);
      throw new Error(`AI provider error (${res.status}): ${msg}`);
    }
    return json;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('The AI provider took too long to respond. Please try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ Gemini ------------------------------ */
function createGemini(): LLMProvider {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  return {
    name: 'gemini',
    label: `Google Gemini (${model})`,
    model,
    async generateJSON({ system, user, temperature = 0.2 }) {
      const json = await postJSON(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' },
        }
      );
      const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
      if (!text) throw new Error(`Gemini returned no content (${json?.promptFeedback?.blockReason ?? 'empty response'}).`);
      return text;
    },
  };
}

/* ------------------------------ OpenAI ------------------------------ */
function createOpenAI(): LLMProvider {
  const key = process.env.OPENAI_API_KEY!;
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  return {
    name: 'openai',
    label: `OpenAI (${model})`,
    model,
    async generateJSON({ system, user }) {
      const json = await postJSON(
        'https://api.openai.com/v1/chat/completions',
        { Authorization: `Bearer ${key}` },
        {
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }
      );
      const text = json?.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('OpenAI returned no content.');
      return text;
    },
  };
}

/* ------------------------------ Anthropic (Claude) ------------------------------ */
function createAnthropic(): LLMProvider {
  const key = process.env.ANTHROPIC_API_KEY!;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  return {
    name: 'anthropic',
    label: `Anthropic Claude (${model})`,
    model,
    async generateJSON({ system, user, temperature = 0.2 }) {
      const json = await postJSON(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: 4096,
          temperature,
          system: `${system}\n\nRespond with a single valid JSON object and nothing else.`,
          messages: [{ role: 'user', content: user }],
        }
      );
      const text = json?.content?.map((c: any) => (c.type === 'text' ? c.text : '')).join('') ?? '';
      if (!text) throw new Error('Claude returned no content.');
      return text;
    },
  };
}

/* ------------------------------ Registry ------------------------------ */
const REGISTRY: Record<ProviderName, { envKey: string; create: () => LLMProvider; label: string }> = {
  gemini: { envKey: 'GEMINI_API_KEY', create: createGemini, label: 'Google Gemini' },
  openai: { envKey: 'OPENAI_API_KEY', create: createOpenAI, label: 'OpenAI GPT' },
  anthropic: { envKey: 'ANTHROPIC_API_KEY', create: createAnthropic, label: 'Anthropic Claude' },
};

/** Providers whose API key is configured in the environment. */
export function availableProviders(): { id: ProviderName; label: string }[] {
  return (Object.keys(REGISTRY) as ProviderName[])
    .filter((id) => !!process.env[REGISTRY[id].envKey])
    .map((id) => ({ id, label: REGISTRY[id].create().label }));
}

export function defaultProviderName(): ProviderName | null {
  const avail = availableProviders().map((p) => p.id);
  const wanted = (process.env.AI_PROVIDER || 'gemini') as ProviderName;
  return avail.includes(wanted) ? wanted : avail[0] ?? null;
}

export function getProvider(name?: string | null): LLMProvider {
  const id = (name && name in REGISTRY ? name : defaultProviderName()) as ProviderName | null;
  if (!id || !process.env[REGISTRY[id].envKey]) {
    throw new Error(
      'No AI provider is configured. Add GEMINI_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) to .env.local and restart the server.'
    );
  }
  return REGISTRY[id].create();
}
