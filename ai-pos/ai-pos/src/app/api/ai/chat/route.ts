import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProvider } from '@/lib/ai/providers';
import { answerQuestion, type ChatTurn } from '@/lib/ai/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  // 1. Only signed-in users may use the assistant (and it queries as that user, so RLS applies).
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });

  // 2. Validate input.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : '';
  if (!message) return NextResponse.json({ error: 'Please type a question.' }, { status: 400 });

  const history: ChatTurn[] = (Array.isArray(body?.history) ? body.history : [])
    .filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-8)
    .map((h: any) => ({ role: h.role, content: h.content.slice(0, 1500) }));

  // 3. Run the AI analyst pipeline.
  try {
    const provider = getProvider(typeof body?.provider === 'string' ? body.provider : null);
    const result = await answerQuestion({ sb, provider, message, history });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[ai/chat]', e);
    return NextResponse.json({ error: String(e?.message ?? 'Something went wrong.') }, { status: 500 });
  }
}
