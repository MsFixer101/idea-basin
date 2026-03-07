const DEFAULT_BASE = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-4o-mini';

export async function generate(prompt, system, apiKey, model, baseUrl, { imageBase64, imageMime } = {}) {
  if (!apiKey) throw new Error('API key required');

  let userContent;
  if (imageBase64 && imageMime) {
    const dataUrl = `data:${imageMime};base64,${imageBase64}`;
    userContent = [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: prompt },
    ];
  } else {
    userContent = prompt;
  }

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
        { role: 'user', content: userContent },
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
