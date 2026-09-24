// Claude call wrapper — quality writing (enhancement, letters, interview answers).
// Model pinned in CLAUDE.md: claude-sonnet-5.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const MODEL = 'claude-sonnet-5';

// Structured JSON call — the schema guarantees valid, parseable output.
export async function claudeJSON({ system, user, schema, maxTokens = 16000 }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined this request.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude response was truncated (max_tokens).');
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Claude returned no text content');
  return JSON.parse(text);
}

// Plain-text call — for letters and long-form writing (Phase 2+).
export async function claudeText({ system, user, maxTokens = 16000 }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined this request.');
  }

  return response.content.find((b) => b.type === 'text')?.text ?? '';
}
