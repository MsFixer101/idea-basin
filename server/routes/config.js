import { Router } from 'express';
import { execFileSync } from 'child_process';
import * as config from '../services/config.js';

const router = Router();

// GET /api/config — return full config
router.get('/', async (req, res) => {
  try {
    const cfg = await config.load();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config — deep-merge partial update
router.post('/', async (req, res) => {
  try {
    const updated = await config.save(req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config/status — ping Ollama, check embedded model cache
router.get('/status', async (req, res) => {
  try {
    const cfg = await config.load();
    const status = { ollama: { reachable: false, models: [] }, embedded: { ready: false } };

    // Check Ollama
    try {
      const ollamaUrl = cfg.ollama?.url || 'http://localhost:11434';
      const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const data = await resp.json();
        status.ollama.reachable = true;
        status.ollama.models = (data.models || []).map(m => ({
          name: m.name,
          size: m.size,
          parameters: m.details?.parameter_size,
          family: m.details?.family,
        }));
      }
    } catch { /* Ollama not reachable */ }

    // Check embedded model
    try {
      const { getStatus } = await import('../services/embedded-model.js');
      status.embedded = await getStatus();
    } catch { /* embedded model not available yet */ }

    // Check model-service (replaces direct Claude CLI)
    try {
      const msResp = await fetch('http://localhost:4000/health', { signal: AbortSignal.timeout(2000) });
      const msData = await msResp.json();
      const cliProvider = msData.providers?.find(p => p.name === 'cli-tools');
      status.claudeCli = { available: cliProvider?.available || false, via: 'model-service' };
    } catch {
      status.claudeCli = { available: false, via: 'model-service' };
    }

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/sync-models — fetch models from a provider using its API
// Body: { provider: 'deepseek', apiKey: 'sk-...' }
// For Ollama, uses the configured URL. For cloud providers, hits /v1/models.
router.post('/sync-models', async (req, res) => {
  try {
    const { provider, apiKey } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider required' });

    const cfg = await config.load();

    // Provider API base URLs (OpenAI-compatible)
    const API_BASES = {
      openai:   'https://api.openai.com',
      deepseek: 'https://api.deepseek.com',
      kimi:     'https://api.moonshot.ai',
      grok:     'https://api.x.ai',
      qwen:     'https://dashscope-intl.aliyuncs.com/compatible-mode',
    };

    if (provider === 'ollama') {
      const ollamaUrl = cfg.ollama?.url || 'http://localhost:11434';
      const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return res.status(502).json({ error: 'Ollama not reachable' });
      const data = await resp.json();
      const models = (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        parameters: m.details?.parameter_size,
        family: m.details?.family,
      }));
      return res.json({ provider: 'ollama', models });
    }

    if (provider === 'claude') {
      // Anthropic uses a different API format
      if (!apiKey) return res.status(400).json({ error: 'apiKey required for Claude' });
      console.log(`[sync-models] Claude: key starts with "${apiKey.slice(0, 8)}...", length ${apiKey.length}`);
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.log(`[sync-models] Claude failed: ${resp.status}`, err);
        return res.status(resp.status).json({ error: err.error?.message || 'Failed to fetch Claude models' });
      }
      const data = await resp.json();
      const models = (data.data || []).map(m => ({ name: m.id, label: m.display_name || m.id }));
      console.log(`[sync-models] Claude: got ${models.length} models`);
      return res.json({ provider: 'claude', models });
    }

    if (provider === 'gemini') {
      if (!apiKey) return res.status(400).json({ error: 'apiKey required for Gemini' });
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return res.status(resp.status).json({ error: err.error?.message || 'Failed to fetch Gemini models' });
      }
      const data = await resp.json();
      const models = (data.models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => ({
          name: m.name.replace('models/', ''),
          label: m.displayName || m.name.replace('models/', ''),
        }));
      return res.json({ provider: 'gemini', models });
    }

    // OpenAI-compatible providers
    const base = API_BASES[provider];
    if (!base) return res.status(400).json({ error: `Unknown provider: ${provider}` });
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

    const resp = await fetch(`${base}/v1/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: err.error?.message || `Failed to fetch ${provider} models` });
    }
    const data = await resp.json();
    let models = (data.data || []).map(m => ({
      name: m.id,
      label: m.id,
      owned_by: m.owned_by,
    }));

    // OpenAI returns everything (DALL-E, Whisper, TTS, fine-tunes, legacy, snapshots).
    // Filter to current chat/reasoning/embedding models, no date-stamped snapshots.
    if (provider === 'openai') {
      const DATED = /-\d{4}(-\d{2}(-\d{2})?)?$/;   // gpt-4o-2024-08-06, o1-2024-12-17
      const LEGACY = /^(gpt-3\.5|gpt-4-|gpt-4o|chatgpt-4o|o[14]-|o1$)/;  // retired / retiring
      const KEEP = /^(gpt-|o\d|text-embedding-)/;
      const SKIP = /^(ft:|.*-realtime|.*-audio|gpt-4-.*-preview|text-embedding-ada)/;
      models = models
        .filter(m => KEEP.test(m.name) && !SKIP.test(m.name) && !DATED.test(m.name) && !LEGACY.test(m.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    return res.json({ provider, models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
