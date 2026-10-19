'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Database, Loader2, Send, Sparkles, User } from 'lucide-react';
import VisualRenderer from './VisualRenderer';
import type { Visual } from '@/lib/ai/visual-types';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  visuals?: Visual[];
  tools?: { name: string; args: unknown; error?: string }[];
  isError?: boolean;
}

const SUGGESTIONS = [
  'What was my total sale today?',
  'Show me sales of last month in a bar chart.',
  'Which customer bought the most? What is his buying behavior?',
  'Which product is selling the most this week?',
  "How much tax do I need to pay on this month's sales? Show calculation.",
  'Show me low stock products.',
];

export default function ChatPanel({
  providers,
  defaultProvider,
}: {
  providers: { id: string; label: string }[];
  defaultProvider: string | null;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState(defaultProvider ?? providers[0]?.id ?? '');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;

    const history = messages.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, provider }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Request failed');
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: json.answer, visuals: json.visuals, tools: json.tools },
      ]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: e.message ?? 'Something went wrong.', isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  const noProvider = providers.length === 0;

  return (
    <section className="card flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-600" />
          <h2 className="font-semibold">Ask your business analyst</h2>
        </div>
        {providers.length > 1 && (
          <select
            aria-label="AI model"
            className="input !w-auto !py-1.5"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        )}
      </div>

      {noProvider && (
        <div className="m-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            No AI key found. Add <code className="rounded bg-amber-100 px-1">GEMINI_API_KEY</code> to{' '}
            <code className="rounded bg-amber-100 px-1">.env.local</code> and restart the server.
          </p>
        </div>
      )}

      {/* Conversation */}
      <div className="max-h-[68vh] min-h-[320px] flex-1 space-y-5 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="py-4 text-center">
            <p className="mb-4 text-sm text-slate-500">
              Ask anything about your sales, products or customers. Answers come from your live data.
            </p>
            <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  disabled={noProvider}
                  onClick={() => send(s)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end gap-2">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm text-white">
                {m.content}
              </div>
              <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200">
                <User className="h-4 w-4 text-slate-600" />
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2">
              <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100">
                <Sparkles className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <div
                  className={`md rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm ${
                    m.isError ? 'border border-red-200 bg-red-50 text-red-700' : 'bg-slate-100'
                  }`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>

                {m.visuals?.map((v, j) => (
                  <div key={j} className="rounded-xl border border-slate-200 bg-white p-4">
                    <VisualRenderer visual={v} />
                  </div>
                ))}

                {m.tools && m.tools.length > 0 && (
                  <details className="text-xs text-slate-500">
                    <summary className="flex cursor-pointer items-center gap-1 select-none">
                      <Database className="h-3 w-3" /> Data used
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {m.tools.map((t, k) => (
                        <li key={k}>
                          <code>{t.name}</code> <code className="text-slate-400">{JSON.stringify(t.args)}</code>
                          {t.error && <span className="text-red-600"> — {t.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          )
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Analysing your data…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        className="flex items-end gap-2 border-t border-slate-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          rows={1}
          className="input max-h-32 min-h-[40px] resize-none"
          placeholder="e.g. Which product is selling the most this week?"
          value={input}
          disabled={noProvider}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button className="btn-primary h-10" disabled={loading || !input.trim() || noProvider} aria-label="Send">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
