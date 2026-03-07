import * as config from './config.js';
import * as claudeClient from './claude-client.js';
import * as openaiClient from './openai-client.js';
import * as geminiClient from './gemini-client.js';
import * as embeddedModel from './embedded-model.js';
import { callClaude } from './claude-cli.js';

// --- Provider Registry ---
// All OpenAI-compatible providers share openai-client.js with different base URLs.

const PROVIDER_API_BASES = {
  openai:   'https://api.openai.com',
  deepseek: 'https://api.deepseek.com',
  kimi:     'https://api.moonshot.ai',
  grok:     'https://api.x.ai',
  qwen:     'https://dashscope-intl.aliyuncs.com/compatible-mode',
};

const OLLAMA_DEFAULTS = {
  chatPreferred: ['qwen', 'llama', 'mistral', 'gemma', 'phi', 'hermes'],
  embedPreferred: ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'snowflake-arctic-embed'],
};

// --- Ollama helpers ---

async function getOllamaUrl() {
  return (await config.get('ollama.url')) || 'http://localhost:11434';
}

async function ollamaDetectModel(type) {
  const url = await getOllamaUrl();
  const res = await fetch(`${url}/api/tags`);
  const data = await res.json();
  const models = data.models || [];
  const preferred = type === 'embed' ? OLLAMA_DEFAULTS.embedPreferred : OLLAMA_DEFAULTS.chatPreferred;

  for (const name of preferred) {
    const found = models.find(m =>
      type === 'embed'
        ? m.name.startsWith(name)
        : m.name.startsWith(name) && !m.name.includes('embed') && !m.name.includes('base')
    );
    if (found) return found.name;
  }
  if (type === 'embed') {
    const embed = models.find(m => m.name.includes('embed'));
    if (embed) return embed.name;
  } else {
    const fallback = models.find(m => !m.name.includes('embed') && !m.name.includes('base'));
    if (fallback) return fallback.name;
  }
  return null;
}

async function ollamaGenerate(prompt, system, modelOverride) {
  const url = await getOllamaUrl();
  const model = modelOverride || await ollamaDetectModel('chat');
  if (!model) return null;
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      stream: false,
    }),
  });
  const data = await res.json();
  return data.message?.content || null;
}

async function ollamaEmbed(text, modelOverride) {
  const url = await getOllamaUrl();
  const model = modelOverride || await ollamaDetectModel('embed');
  if (!model) return null;
  const res = await fetch(`${url}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });
  const data = await res.json();
  return data.embedding || null;
}

// --- Feature resolution helpers ---

async function getFeature(name) {
  const feature = await config.get(`features.${name}`);
  if (feature?.provider) return feature;
  // Backward compat: fall back to old config shape
  const oldProvider = await config.get(`providers.${name}`);
  const oldModel = await config.get(`models.${name}`);
  return { provider: oldProvider || 'embedded', model: oldModel || '' };
}

function makeGenerator(provider, model, apiKey) {
  switch (provider) {
    case 'claude':
      return (prompt, system) => claudeClient.generate(prompt, system, apiKey, model || undefined);
    case 'claude-cli':
      return (prompt, system) => callClaude(prompt, system);
    case 'ollama':
      return (prompt, system) => ollamaGenerate(prompt, system, model || undefined);
    case 'gemini':
      return (prompt, system) => geminiClient.generate(prompt, system, apiKey, model || undefined);
    case 'openai':
    case 'deepseek':
    case 'kimi':
    case 'grok':
    case 'qwen': {
      const baseUrl = PROVIDER_API_BASES[provider];
      return (prompt, system) => openaiClient.generate(prompt, system, apiKey, model || undefined, baseUrl);
    }
    default:
      return null;
  }
}

// --- Public API ---

/**
 * Get a classifier function based on the configured scan provider.
 * @param {string} apiKey - Optional API key for cloud providers
 */
export async function getClassifier(apiKey) {
  const { provider, model } = await getFeature('scan');

  if (provider === 'embedded') {
    return { type: 'embedded', classify: null };
  }

  const classify = makeGenerator(provider, model, apiKey);
  return { type: provider, classify };
}

/**
 * Get an embedder based on the configured embedding provider.
 */
export async function getEmbedder() {
  const { provider, model } = await getFeature('embedding');

  if (provider === 'ollama') {
    const embedModel = model || undefined;
    return {
      embed: (text) => ollamaEmbed(text, embedModel),
      embedBatch: async (texts) => {
        const results = [];
        for (const t of texts) results.push(await ollamaEmbed(t, embedModel));
        return results;
      },
      dimension: 768,
    };
  }

  // Default: embedded
  return {
    embed: embeddedModel.embed,
    embedBatch: embeddedModel.embedBatch,
    dimension: 384,
  };
}

/**
 * Get a tagger/summarizer based on the configured tagging provider.
 * Returns null if tagging is disabled.
 * @param {string} apiKey - Optional API key for cloud providers
 */
export async function getTagger(apiKey) {
  const { provider, model } = await getFeature('tagging');

  if (provider === 'disabled') return null;
  if (provider === 'embedded') return null;

  const generate = makeGenerator(provider, model, apiKey);
  return generate ? { generate } : null;
}
