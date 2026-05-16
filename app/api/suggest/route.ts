import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { listEntries } from '@/lib/daemon';

const client = new Anthropic();

const CATEGORY_LABELS: Record<string, string> = {
  context: 'Context/Observations',
  idea: 'Ideas/Proposals',
  concern: 'Concerns/Risks',
  decision: 'Decisions Needed',
};

export async function POST(req: NextRequest) {
  const { groupId } = await req.json();
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

  const entries = await listEntries(groupId);
  if (entries.length === 0) {
    return NextResponse.json({ suggestion: 'No entries yet. Both collaborators need to surface their context first.' });
  }

  const entriesByParty: Record<string, typeof entries> = {};
  for (const e of entries) {
    (entriesByParty[e.party] ??= []).push(e);
  }

  const summary = Object.entries(entriesByParty).map(([party, items]) => {
    const byCat: Record<string, typeof items> = {};
    for (const item of items) {
      (byCat[item.category || 'context'] ??= []).push(item);
    }
    const sections = Object.entries(byCat).map(([cat, catItems]) =>
      `  [${CATEGORY_LABELS[cat] || cat}]\n${catItems.map(i => `  - ${i.title}${i.description ? ': ' + i.description : ''}`).join('\n')}`
    ).join('\n');
    return `${party}:\n${sections}`;
  }).join('\n\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are an information-flow analyst helping two collaborators make better joint decisions. Below is what each collaborator has surfaced — organized by category (Context, Ideas, Concerns, Decisions Needed).

Your job is to synthesize this into actionable clarity. Specifically:

1. **Information Asymmetries**: Where does one person hold context the other likely doesn't have? What assumptions might differ?
2. **Premature Filtering**: Are there signs that relevant information was filtered out before sharing? Are there gaps in one person's perspective that the other's entries imply should exist?
3. **Common Ground**: What do both sides agree on or value, even if expressed differently?
4. **Optimization Conflicts**: Where is each person optimizing for different things? How might they optimize for the shared system instead?
5. **Proposed Path Forward**: Concrete next steps that account for both perspectives. Frame decisions as joint choices, not compromises.

Be direct and analytical. Don't hedge or be diplomatic at the expense of clarity. If entries are in Hebrew, respond in Hebrew.

${summary}`
    }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  return NextResponse.json({ suggestion: text });
}
