const DEFAULT_BASE = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-4o-mini';

export async function generate(prompt, system, apiKey, model, baseUrl) {
  if (!apiKey) throw new Error('API key required');

  const base = (baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`API error (${base}): ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}
