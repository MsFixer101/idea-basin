import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json');

const DEFAULTS = {
  // New: list of user-configured provider IDs
  configuredProviders: [],
  // New: feature → { provider, model } assignment
  features: {
    scan: { provider: 'embedded', model: '' },
    embedding: { provider: 'embedded', model: '' },
    tagging: { provider: 'disabled', model: '' },
  },
  ollama: {
    url: 'http://localhost:11434',
  },
  whatsapp: {
    enabled: false,
    groupJid: '',
    aliases: [],           // empty = use DEFAULT_ALIASES in bot
    defaultProvider: 'claude-cli',
    // API keys synced from browser on group activation:
    geminiApiKey: '',
    grokApiKey: '',
    claudeApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
    kimiApiKey: '',
    qwenApiKey: '',
  },
  briefing: {
    enabled: false,
    schedule: '0 7 * * *',
    timezone: 'UTC',
    provider: 'claude-cli',
    model: '',
    sections: {
      kbActivity: true,
      crossRefs: true,
      rssFeeds: true,
      braveSearch: true,
      randomConnection: true,
    },
    rssFeeds: [
      { url: 'https://rss.arxiv.org/rss/cs.AI', name: 'arXiv AI', category: 'research' },
      { url: 'https://hnrss.org/newest?points=100', name: 'Hacker News (Top)', category: 'tech' },
      { url: 'https://simonwillison.net/atom/everything/', name: 'Simon Willison', category: 'ai-blog' },
    ],
    braveSearchTopics: [],
    prompt: '',
    whatsappDelivery: true,
    artifactSave: true,
  },
  chat: {
    assistantPrompt: 'You are the Idea Basin assistant \u2014 a helpful AI embedded in a knowledge management app. You can search the knowledge base, browse nodes, create new nodes and resources, read local files, and open files.',
    researchPrompt: 'You are a research assistant embedded in a knowledge management app. Your focus is finding, synthesizing, and organizing information. Use search tools proactively, cite sources, and create artifact documents for substantial findings. Be thorough and analytical.',
    guidelines: 'Be concise and helpful. Use short paragraphs.\nWhen the user asks about something in their knowledge base, use the auto-retrieved context above first. If it\'s not sufficient, use search_knowledge for a more targeted query.\nWhen creating nodes or resources, confirm what you created and mention the ID.\nFor general conversation (greetings, opinions, coding help), respond directly without tools.\nIf you\'re unsure which node to use, call list_nodes first.',
    subAgentPrompt: 'You are a focused research agent. Find information on your assigned topic using the tools available. Report facts with source citations. Be thorough but concise \u2014 bullet points preferred.',
    synthesisPrompt: 'You are a research synthesizer. Combine findings from multiple research agents into a well-structured markdown document with: executive summary, main findings by theme, properly formatted citations, and a conclusion.',
  },
};

let cached = null;

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object') {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Migrate old config format (providers.scan='ollama', models.scan='hermes4:14b')
 * to new format (features.scan={ provider:'ollama', model:'hermes4:14b' }).
 */
function migrateIfNeeded(cfg) {
  // Detect old format: providers is an object with string values like {scan: 'ollama'}
  if (cfg.providers && typeof cfg.providers.scan === 'string') {
    cfg.features = {
      scan: { provider: cfg.providers.scan || 'embedded', model: cfg.models?.scan || '' },
      embedding: { provider: cfg.providers.embedding || 'embedded', model: cfg.models?.embedding || '' },
      tagging: { provider: cfg.providers.tagging || 'disabled', model: cfg.models?.tagging || '' },
    };
    // Build configuredProviders from what was in use
    const LOCAL = new Set(['embedded', 'disabled', 'claude-cli']);
    const used = new Set();
    for (const f of Object.values(cfg.features)) {
      if (f.provider && !LOCAL.has(f.provider)) {
        used.add(f.provider);
      }
    }
    cfg.configuredProviders = [...used];
    // Clean up old keys
    delete cfg.providers;
    delete cfg.models;
  }
  return cfg;
}

export async function load() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    cached = migrateIfNeeded(deepMerge(DEFAULTS, JSON.parse(raw)));
  } catch {
    cached = { ...DEFAULTS, features: { ...DEFAULTS.features } };
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(cached, null, 2));
  }
  return cached;
}

export async function save(updates) {
  if (!cached) await load();
  cached = deepMerge(cached, updates);
  await writeFile(CONFIG_PATH, JSON.stringify(cached, null, 2));
  return cached;
}

export async function get(key) {
  if (!cached) await load();
  if (!key) return cached;
  return key.split('.').reduce((o, k) => o?.[k], cached);
}
