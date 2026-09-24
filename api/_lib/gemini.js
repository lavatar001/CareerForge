// Gemini call wrapper — JSON-only calls with a parse/repair step.
// Models (pinned in CLAUDE.md): gemini-2.5-flash-lite (parse), gemini-2.5-flash (match/keywords).

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function stripFences(text) {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

async function callGemini({ model, system, user, maxOutputTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const resp = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens,
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Gemini ${model} error ${resp.status}: ${body.slice(0, 500)}`);
  }

  const json = await resp.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) throw new Error(`Gemini ${model} returned an empty response`);
  return text;
}

// Call Gemini expecting a JSON object back. On invalid JSON, re-request once
// asking for valid JSON only, then give up.
export async function geminiJSON({ model = 'gemini-2.5-flash-lite', system, user, maxOutputTokens = 8192 }) {
  const first = await callGemini({ model, system, user, maxOutputTokens });
  try {
    return JSON.parse(stripFences(first));
  } catch {
    const retry = await callGemini({
      model,
      system,
      user: `${user}\n\nYour last output was not valid JSON. Return valid JSON only — no markdown, no code fences, no commentary.`,
      maxOutputTokens,
    });
    return JSON.parse(stripFences(retry)); // let this throw — handler refunds credits
  }
}
