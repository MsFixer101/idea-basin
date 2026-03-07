import { getTagger } from './ai-provider.js';

const TAG_SYSTEM = `You are a knowledge tagger. Analyze this content and return 5-15 specific concept tags.
Tags should be precise technical/domain terms, NOT generic words.
Good tags: ["RLHF", "preference-pairs", "transformer-architecture", "pgvector"]
Bad tags: ["interesting", "research", "technology", "important"]
Return ONLY a JSON array of strings. No explanation.`;

const SUMMARY_SYSTEM = `Summarize this content in 2-3 sentences. Be specific about findings, methods, or key points.
Do NOT use phrases like "this paper discusses" or "this article explores".
State what it actually says/does/proves.`;

export async function generateTags(text, apiKey) {
  try {
    const tagger = await getTagger(apiKey);
    if (!tagger) return [];

    const truncated = text.substring(0, 16000);
    const result = await tagger.generate(truncated, TAG_SYSTEM);
    if (!result) return [];

    const match = result.match(/\[[\s\S]*?\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  } catch {
    return [];
  }
}

export async function generateSummary(text, apiKey) {
  try {
    const tagger = await getTagger(apiKey);
    if (!tagger) return 'No summary (tagging disabled)';

    const truncated = text.substring(0, 16000);
    return (await tagger.generate(truncated, SUMMARY_SYSTEM)) || 'Summary generation failed.';
  } catch (err) {
    return `Summary unavailable (${err.message})`;
  }
}
