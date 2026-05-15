import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { listEntries } from '@/lib/daemon';

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const { groupId } = await req.json();
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

  const entries = await listEntries(groupId);
  if (entries.length === 0) {
    return NextResponse.json({ suggestion: 'No entries yet. Both parties need to submit their feelings first.' });
  }

  const entriesByParty: Record<string, typeof entries> = {};
  for (const e of entries) {
    (entriesByParty[e.party] ??= []).push(e);
  }

  const summary = Object.entries(entriesByParty).map(([party, items]) =>
    `${party}:\n${items.map(i => `- ${i.title}${i.description ? ': ' + i.description : ''}`).join('\n')}`
  ).join('\n\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are a family mediator helping two family members resolve conflicts. Below are feelings and expectations each person has logged. Analyze the common ground and tensions, then suggest concrete, actionable steps both can take to improve the relationship.

Be empathetic, balanced, and practical. Don't take sides. If entries are in Hebrew, respond in Hebrew.

${summary}`
    }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  return NextResponse.json({ suggestion: text });
}
