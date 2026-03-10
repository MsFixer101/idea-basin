import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_MODEL = 'gemini-2.0-flash';

export async function generate(prompt, system, apiKey, model, { imageBase64, imageMime } = {}) {
  if (!apiKey) throw new Error('Gemini API key required');

  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({
    model: model || DEFAULT_MODEL,
    systemInstruction: system,
  });

  let content;
  if (imageBase64 && imageMime) {
    content = [
      prompt,
      { inlineData: { mimeType: imageMime, data: imageBase64 } },
    ];
  } else {
    content = prompt;
  }

  const result = await m.generateContent(content);
  return result.response.text();
}

export async function describeImage(base64Data, mimeType, prompt, apiKey, model) {
  if (!apiKey) throw new Error('Gemini API key required');

  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model: model || DEFAULT_MODEL });
  const result = await m.generateContent([
    { inlineData: { mimeType, data: base64Data } },
    prompt || 'Describe this image concisely.',
  ]);
  return result.response.text();
}
