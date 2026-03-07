import { getEmbedder } from './ai-provider.js';

export async function embed(text) {
  try {
    const embedder = await getEmbedder();
    return await embedder.embed(text);
  } catch (err) {
    console.error('Embedding failed:', err.message);
    return null;
  }
}

export async function embedBatch(texts) {
  try {
    const embedder = await getEmbedder();
    return await embedder.embedBatch(texts);
  } catch (err) {
    console.error('Batch embedding failed:', err.message);
    return texts.map(() => null);
  }
}
