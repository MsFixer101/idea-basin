import { pipeline, env } from '@huggingface/transformers';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { access } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', 'data', 'models');

// Point Transformers.js cache to our local dir
env.cacheDir = CACHE_DIR;
env.allowLocalModels = true;

const MODEL_ID = 'TaylorAI/bge-micro-v2';
const DIMENSION = 384;

let extractor = null;
let loading = false;

async function getExtractor() {
  if (extractor) return extractor;
  if (loading) {
    // Wait for in-flight load
    while (loading) await new Promise(r => setTimeout(r, 100));
    return extractor;
  }
  loading = true;
  try {
    console.log(`[embedded] Loading ${MODEL_ID}...`);
    extractor = await pipeline('feature-extraction', MODEL_ID, {
      quantized: true,
      dtype: 'q8',
    });
    console.log(`[embedded] Model ready (${DIMENSION}-dim)`);
    return extractor;
  } catch (err) {
    console.error('[embedded] Failed to load model:', err.message);
    return null;
  } finally {
    loading = false;
  }
}

export async function embed(text) {
  const ext = await getExtractor();
  if (!ext) return null;
  const output = await ext(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function embedBatch(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Classify files against nodes using embedding similarity.
 * @param {Array} files - [{ path, name, preview }]
 * @param {Array} nodes - [{ id, label, description, why }]
 * @param {number} threshold - minimum similarity score (default 0.3)
 * @returns {Array} [{ path, node_id, reason }]
 */
export async function classifyBySimilarity(files, nodes, threshold = 0.3) {
  if (files.length === 0 || nodes.length === 0) return [];

  // Embed node labels + descriptions
  const nodeTexts = nodes.map(n =>
    `${n.label}. ${n.description || ''} ${n.why || ''}`.trim()
  );
  const nodeEmbeddings = await embedBatch(nodeTexts);

  // Embed file previews
  const fileTexts = files.map(f =>
    `${f.name}. ${f.preview || ''}`.substring(0, 500)
  );
  const fileEmbeddings = await embedBatch(fileTexts);

  const results = [];
  for (let fi = 0; fi < files.length; fi++) {
    if (!fileEmbeddings[fi]) continue;
    let bestScore = -1;
    let bestIdx = -1;
    for (let ni = 0; ni < nodes.length; ni++) {
      if (!nodeEmbeddings[ni]) continue;
      const score = cosineSimilarity(fileEmbeddings[fi], nodeEmbeddings[ni]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = ni;
      }
    }
    if (bestScore >= threshold && bestIdx >= 0) {
      results.push({
        path: files[fi].path,
        node_id: nodes[bestIdx].id,
        reason: `similar to ${nodes[bestIdx].label}`,
      });
    }
  }
  return results;
}

export async function getStatus() {
  const ready = !!extractor;
  let cached = false;
  try {
    await access(CACHE_DIR);
    cached = true;
  } catch { /* not cached */ }
  return { ready, cached, model: MODEL_ID, dimension: DIMENSION };
}
