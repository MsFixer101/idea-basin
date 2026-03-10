import { useState, useEffect } from 'react';
import { theme } from '../styles/theme.js';
import { api } from '../hooks/useApi.js';
import cryptoManager from '../services/crypto-manager.js';

// --- Provider Registry ---

const PROVIDER_DEFS = {
  ollama:     { label: 'Ollama',              needsKey: false, needsUrl: true, keyId: null, keyUrl: 'https://ollama.com' },
  claude:     { label: 'Anthropic (Claude)',   needsKey: true,  needsUrl: false, keyId: 'anthropic', keyPlaceholder: 'sk-ant-...', keyUrl: 'https://console.anthropic.com' },
  openai:     { label: 'OpenAI',              needsKey: true,  needsUrl: false, keyId: 'openai', keyPlaceholder: 'sk-...', keyUrl: 'https://platform.openai.com/api-keys' },
  deepseek:   { label: 'DeepSeek',            needsKey: true,  needsUrl: false, keyId: 'deepseek', keyPlaceholder: 'sk-...', keyUrl: 'https://platform.deepseek.com/api_keys' },
  kimi:       { label: 'Kimi (Moonshot)',      needsKey: true,  needsUrl: false, keyId: 'kimi', keyPlaceholder: 'sk-...', keyUrl: 'https://platform.moonshot.ai' },
  gemini:     { label: 'Gemini (Google)',       needsKey: true,  needsUrl: false, keyId: 'gemini', keyPlaceholder: 'AIza...', keyUrl: 'https://aistudio.google.com/apikey' },
  grok:       { label: 'Grok (xAI)',           needsKey: true,  needsUrl: false, keyId: 'grok', keyPlaceholder: 'xai-...', keyUrl: 'https://console.x.ai' },
  qwen:       { label: 'Qwen (Alibaba)',       needsKey: true,  needsUrl: false, keyId: 'qwen', keyPlaceholder: 'sk-...', keyUrl: 'https://dashscope.console.aliyun.com' },
};

// WhatsApp alias providers — includes claude-cli (no key) + all keyed providers
const WA_PROVIDER_DEFS = {
  'claude-cli': { label: 'Claude CLI',   needsKey: false, keyId: null },
  claude:       { label: 'Claude API',   needsKey: true,  keyId: 'anthropic' },
  gemini:       { label: 'Gemini',       needsKey: true,  keyId: 'gemini' },
  grok:         { label: 'Grok',         needsKey: true,  keyId: 'grok' },
  ollama:       { label: 'Ollama',       needsKey: false, keyId: null },
  openai:       { label: 'OpenAI',       needsKey: true,  keyId: 'openai' },
  deepseek:     { label: 'DeepSeek',     needsKey: true,  keyId: 'deepseek' },
  kimi:         { label: 'Kimi',         needsKey: true,  keyId: 'kimi' },
  qwen:         { label: 'Qwen',         needsKey: true,  keyId: 'qwen' },
};

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

// --- Shared Components ---

function StatusDot({ ok, loading }) {
  if (loading) return <span style={{ color: theme.accent.amber, fontSize: 12 }}>...</span>;
  return <span style={{
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    background: ok ? theme.accent.green : theme.accent.red, flexShrink: 0,
  }} />;
}

// --- Styles ---

const cardStyle = {
  border: `1px solid ${theme.border.default}`,
  borderRadius: 10, padding: 16, marginBottom: 12, background: theme.bg.deep,
};

const sectionTitleStyle = {
  fontSize: 15, fontWeight: 600, color: theme.accent.indigo, marginBottom: 14,
};

const selectStyle = {
  background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
  borderRadius: 8, padding: '8px 12px', color: theme.text.primary,
  fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%',
};

const inputStyle = { ...selectStyle, flex: 1 };

const btnPrimary = {
  background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: 'none', color: '#fff',
  padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
  fontSize: 12, fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
};

const btnSecondary = {
  background: theme.bg.card, border: `1px solid ${theme.border.default}`, color: theme.text.muted,
  padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
  fontSize: 12, fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
};

const btnDanger = {
  background: 'none', border: `1px solid ${theme.accent.red}33`, color: theme.accent.red,
  padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

const btnOllama = { ...btnPrimary, background: 'linear-gradient(135deg, #059669, #047857)' };

const hintStyle = { fontSize: 11, color: theme.text.dim, marginTop: 6, lineHeight: '1.4' };

// --- localStorage helpers for synced models ---

function getCachedModels(provider) {
  try {
    const raw = localStorage.getItem(`ideabasin_models_${provider}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function setCachedModels(provider, models) {
  localStorage.setItem(`ideabasin_models_${provider}`, JSON.stringify(models));
}

// --- Main Component ---

export default function SettingsPanel({ onClose }) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [keys, setKeys] = useState({});
  const [keySaved, setKeySaved] = useState({});
  const [embeddedLoading, setEmbeddedLoading] = useState(false);
  // Per-provider synced model lists
  const [providerModels, setProviderModels] = useState(() => {
    const initial = {};
    for (const pid of Object.keys(PROVIDER_DEFS)) {
      initial[pid] = getCachedModels(pid);
    }
    return initial;
  });
  const [syncingProvider, setSyncingProvider] = useState(null);
  const [expandedModels, setExpandedModels] = useState({});
  const [addProviderType, setAddProviderType] = useState('');
  const [addProviderKey, setAddProviderKey] = useState('');
  const [chatPrompts, setChatPrompts] = useState({ assistantPrompt: '', researchPrompt: '', guidelines: '' });
  const [chatPromptsSaved, setChatPromptsSaved] = useState(false);
  const [waBotStatus, setWaBotStatus] = useState(null); // { status, qrDataUrl, groups }
  const [waGroupJid, setWaGroupJid] = useState('');
  const [waChatGroupJid, setWaChatGroupJid] = useState('');
  const [waConnecting, setWaConnecting] = useState(false);
  // WhatsApp aliases
  const [waAliases, setWaAliases] = useState([]);
  const [addAliasTag, setAddAliasTag] = useState('');
  const [addAliasProvider, setAddAliasProvider] = useState('');
  const [addAliasModel, setAddAliasModel] = useState('');
  // Morning Briefing
  const [briefingStatus, setBriefingStatus] = useState(null);
  const [briefingTime, setBriefingTime] = useState('07:00');
  const [briefingTimezone, setBriefingTimezone] = useState('Australia/Melbourne');
  const [briefingProvider, setBriefingProvider] = useState('claude-cli');
  const [briefingModel, setBriefingModel] = useState('');
  const [briefingSections, setBriefingSections] = useState({
    kbActivity: true, crossRefs: true, rssFeeds: true, braveSearch: true, randomConnection: true,
  });
  const [briefingRssFeeds, setBriefingRssFeeds] = useState([]);
  const [briefingBraveTopics, setBriefingBraveTopics] = useState([]);
  const [briefingWhatsapp, setBriefingWhatsapp] = useState(true);
  const [briefingArtifact, setBriefingArtifact] = useState(true);
  const [briefingEnabled, setBriefingEnabled] = useState(false);
  const [briefingTesting, setBriefingTesting] = useState(false);
  const [briefingTestResult, setBriefingTestResult] = useState(null);
  const [addRssName, setAddRssName] = useState('');
  const [addRssUrl, setAddRssUrl] = useState('');
  const [addBraveTopic, setAddBraveTopic] = useState('');
  const [memories, setMemories] = useState([]);
  // Collapsible sections — features + providers open by default
  const [collapsed, setCollapsed] = useState({ features: false, providers: false, local: true, brave: true, whatsapp: false, briefing: true, prompts: true, memory: true });

  useEffect(() => {
    (async () => {
      try {
        const [cfg, st] = await Promise.all([api.getConfig(), api.getConfigStatus()]);
        setConfig(cfg);
        setStatus(st);
        setOllamaUrl(cfg.ollama?.url || 'http://localhost:11434');
        setKeySaved(prev => ({ ...prev, brave: !!cfg.brave_search_api_key }));
        if (cfg.chat) {
          setChatPrompts({
            assistantPrompt: cfg.chat.assistantPrompt || '',
            researchPrompt: cfg.chat.researchPrompt || '',
            guidelines: cfg.chat.guidelines || '',
          });
        }
        if (cfg.whatsapp?.groupJid) setWaGroupJid(cfg.whatsapp.groupJid);
        if (cfg.whatsapp?.chatGroupJid) setWaChatGroupJid(cfg.whatsapp.chatGroupJid);
        if (cfg.whatsapp?.aliases?.length > 0) setWaAliases(cfg.whatsapp.aliases);
        // Briefing config
        if (cfg.briefing) {
          setBriefingEnabled(!!cfg.briefing.enabled);
          if (cfg.briefing.schedule) {
            // Parse "0 7 * * *" → "07:00"
            const parts = cfg.briefing.schedule.split(' ');
            if (parts.length >= 2) setBriefingTime(`${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`);
          }
          if (cfg.briefing.timezone) setBriefingTimezone(cfg.briefing.timezone);
          if (cfg.briefing.provider) setBriefingProvider(cfg.briefing.provider);
          if (cfg.briefing.model !== undefined) setBriefingModel(cfg.briefing.model);
          if (cfg.briefing.sections) setBriefingSections(cfg.briefing.sections);
          if (cfg.briefing.rssFeeds) setBriefingRssFeeds(cfg.briefing.rssFeeds);
          if (cfg.briefing.braveSearchTopics) setBriefingBraveTopics(cfg.briefing.braveSearchTopics);
          if (cfg.briefing.whatsappDelivery !== undefined) setBriefingWhatsapp(cfg.briefing.whatsappDelivery);
          if (cfg.briefing.artifactSave !== undefined) setBriefingArtifact(cfg.briefing.artifactSave);
        }
        // Fetch briefing status
        api.briefingStatus().then(setBriefingStatus).catch(() => {});
        // Auto-cache Ollama models from status
        if (st?.ollama?.reachable && st.ollama.models?.length > 0) {
          setProviderModels(prev => ({ ...prev, ollama: st.ollama.models }));
          setCachedModels('ollama', st.ollama.models);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    })();
    // Check all saved keys
    const savedState = {};
    for (const [id, def] of Object.entries(PROVIDER_DEFS)) {
      if (def.keyId) savedState[def.keyId] = cryptoManager.hasAPIKey(def.keyId);
    }
    savedState.brave = false;
    setKeySaved(prev => ({ ...prev, ...savedState }));
    // Load AI memories
    api.getMemories().then(r => setMemories(r.entries || [])).catch(() => {});
  }, []);

  // Poll WhatsApp bot status (when connecting or showing QR)
  useEffect(() => {
    let interval;
    const poll = async () => {
      try {
        const st = await api.whatsappStatus();
        setWaBotStatus(st);
        if (st.status === 'connected' && st.groups?.length > 0) setWaConnecting(false);
      } catch {}
    };
    poll();
    interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // --- Config save helpers ---

  const saveConfig = async (updates) => {
    setSaving(true);
    try {
      const updated = await api.saveConfig(updates);
      setConfig(updated);
      return updated;
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const saveFeature = (feature, provider, model) => {
    saveConfig({ features: { [feature]: { provider, model: model || '' } } });
  };

  // --- Provider management ---

  const configuredProviders = config?.configuredProviders || [];

  const addProvider = async (type) => {
    if (!type || configuredProviders.includes(type)) return;
    const def = PROVIDER_DEFS[type];
    if (def?.needsKey && addProviderKey) {
      await cryptoManager.setAPIKey(def.keyId, addProviderKey);
      setKeySaved(prev => ({ ...prev, [def.keyId]: true }));
    }
    await saveConfig({ configuredProviders: [...configuredProviders, type] });
    setAddProviderType('');
    setAddProviderKey('');
    // Auto-sync after adding
    if (type === 'ollama' || (def?.needsKey && addProviderKey)) {
      setTimeout(() => syncProvider(type), 100);
    }
  };

  const removeProvider = async (type) => {
    const def = PROVIDER_DEFS[type];
    if (!confirm(`Remove ${def?.label || type}? This will delete your API key and reset any features using this provider.`)) return;
    if (def?.keyId) {
      cryptoManager.removeAPIKey(def.keyId);
      setKeySaved(prev => ({ ...prev, [def.keyId]: false }));
    }
    // Clear synced models
    setProviderModels(prev => ({ ...prev, [type]: [] }));
    localStorage.removeItem(`ideabasin_models_${type}`);
    // Clear any features using this provider
    const features = { ...config?.features };
    for (const [feat, val] of Object.entries(features)) {
      if (val.provider === type) features[feat] = { provider: 'embedded', model: '' };
    }
    await saveConfig({
      configuredProviders: configuredProviders.filter(p => p !== type),
      features,
    });
  };

  const syncProvider = async (pid) => {
    setSyncingProvider(pid);
    try {
      const def = PROVIDER_DEFS[pid];
      let apiKey = null;
      if (def?.keyId) {
        apiKey = await cryptoManager.getAPIKey(def.keyId);
        // Fallback: try alternate key IDs (old settings may have stored under different name)
        if (!apiKey && pid === 'claude') apiKey = await cryptoManager.getAPIKey('claude');
        if (!apiKey && pid === 'claude') apiKey = await cryptoManager.getAPIKey('claude-api');
      }
      if (def?.needsKey && !apiKey) {
        alert(`No API key found for ${def.label}. Save your key first, then Sync.`);
        return;
      }
      const result = await api.syncModels(pid, apiKey);
      if (result.models) {
        setProviderModels(prev => ({ ...prev, [pid]: result.models }));
        setCachedModels(pid, result.models);
        if (pid === 'ollama') {
          setStatus(prev => ({
            ...prev,
            ollama: { reachable: true, models: result.models },
          }));
        }
      }
    } catch (err) {
      console.error(`Sync ${pid} failed:`, err);
      alert(`Sync failed for ${PROVIDER_DEFS[pid]?.label || pid}: ${err.message}`);
    } finally {
      setSyncingProvider(null);
    }
  };

  const saveApiKey = async (keyId) => {
    if (!keys[keyId]) return;
    await cryptoManager.setAPIKey(keyId, keys[keyId]);
    setKeys(prev => ({ ...prev, [keyId]: '' }));
    setKeySaved(prev => ({ ...prev, [keyId]: true }));
  };

  // Sync all API keys needed by a set of WhatsApp aliases to server config
  const syncAliasKeys = async (aliases) => {
    const keysToSync = {};
    for (const alias of aliases) {
      const def = PROVIDER_DEFS[alias.provider];
      if (def?.needsKey && def.keyId) {
        const key = await cryptoManager.getAPIKey(def.keyId);
        if (key) keysToSync[`${alias.provider}ApiKey`] = key;
      }
    }
    if (Object.keys(keysToSync).length > 0) {
      await saveConfig({ whatsapp: keysToSync });
    }
  };

  const saveOllamaUrl = async () => {
    await saveConfig({ ollama: { url: ollamaUrl } });
    syncProvider('ollama');
  };

  const saveBraveKey = async () => {
    if (!keys.brave) return;
    setSaving(true);
    try {
      await api.saveConfig({ brave_search_api_key: keys.brave });
      setKeys(prev => ({ ...prev, brave: '' }));
      setKeySaved(prev => ({ ...prev, brave: true }));
    } catch (err) {
      console.error('Failed to save Brave key:', err);
    } finally {
      setSaving(false);
    }
  };

  const removeBraveKey = async () => {
    await saveConfig({ brave_search_api_key: '' });
    setKeySaved(prev => ({ ...prev, brave: false }));
  };

  const preloadEmbedded = async () => {
    setEmbeddedLoading(true);
    try {
      const st = await api.getConfigStatus();
      setStatus(st);
    } catch (err) {
      console.error('Preload failed:', err);
    } finally {
      setEmbeddedLoading(false);
    }
  };

  // --- Build model options for feature dropdowns ---

  function buildModelOptions(featureType) {
    const groups = [];

    // Local tools first
    const localOpts = [
      { value: 'embedded:', label: 'Embedded (bge-micro-v2, offline)' },
    ];
    if (status?.claudeCli?.available) {
      localOpts.push({ value: 'claude-cli:', label: 'Claude CLI (local, no key)' });
    }
    if (featureType === 'tagging') {
      localOpts.unshift({ value: 'disabled:', label: 'Disabled' });
    }
    groups.push({ label: 'Local', options: localOpts });

    // Configured providers — synced models
    for (const pid of configuredProviders) {
      const def = PROVIDER_DEFS[pid];
      if (!def) continue;
      let models = providerModels[pid] || [];
      if (models.length === 0) continue;

      if (pid === 'ollama') {
        // Sort: embedding models first for embedding feature, chat models first otherwise
        if (featureType === 'embedding') {
          const embed = models.filter(m => m.name.includes('embed') || m.name.includes('nomic') || m.name.includes('minilm'));
          const other = models.filter(m => !embed.includes(m));
          models = [...embed, ...other];
        } else {
          const chat = models.filter(m => !m.name.includes('embed') && !m.name.includes('base'));
          const other = models.filter(m => !chat.includes(m));
          models = [...chat, ...other];
        }
        groups.push({
          label: def.label,
          options: models.map(m => ({
            value: `ollama:${m.name}`,
            label: `${m.name}${m.parameters ? `  (${m.parameters})` : ''}${m.size ? `  ${formatBytes(m.size)}` : ''}`,
          })),
        });
      } else {
        groups.push({
          label: def.label,
          options: models.map(m => ({
            value: `${pid}:${m.name}`,
            label: m.label || m.name,
          })),
        });
      }
    }

    return groups;
  }

  function featureValue(feature) {
    const f = config?.features?.[feature];
    if (!f?.provider) return 'embedded:';
    return `${f.provider}:${f.model || ''}`;
  }

  function handleFeatureChange(feature, encoded) {
    const [provider, ...rest] = encoded.split(':');
    const model = rest.join(':');
    saveFeature(feature, provider, model);
  }

  // --- Providers not yet added ---
  const availableToAdd = Object.keys(PROVIDER_DEFS).filter(p => !configuredProviders.includes(p));
  const addDef = addProviderType ? PROVIDER_DEFS[addProviderType] : null;

  if (!config) {
    return (
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 100,
      }} onClick={onClose}>
        <div style={{ color: theme.text.dim, fontSize: 14 }}>Loading settings...</div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
        borderRadius: 16, padding: window.innerWidth < 640 ? 16 : 28,
        width: 700, maxWidth: '95vw', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Settings</div>
          <span onClick={onClose} style={{
            fontSize: 18, color: theme.text.ghost, cursor: 'pointer', padding: '4px 8px',
          }} title="Close">✕</span>
        </div>

        {/* ─── Feature Assignment ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, features: !p.features }))} style={{ ...sectionTitleStyle, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.features ? '▸' : '▾'}</span> ◇ Feature Assignment
        </div>

        {!collapsed.features && ['scan', 'embedding', 'tagging'].map(feature => {
          const groups = buildModelOptions(feature);
          const current = featureValue(feature);
          return (
            <div key={feature} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, textTransform: 'capitalize' }}>
                  {feature}
                </span>
                <span style={{ fontSize: 11, color: theme.text.dim }}>
                  {feature === 'scan' && '— File classification'}
                  {feature === 'embedding' && '— Semantic search vectors'}
                  {feature === 'tagging' && '— Tags & summaries'}
                </span>
                <span style={{ marginLeft: 'auto' }}><StatusDot ok={
                  current.startsWith('embedded') ? (status?.embedded?.ready || status?.embedded?.cached) :
                  current.startsWith('claude-cli') ? status?.claudeCli?.available :
                  current.startsWith('ollama') ? status?.ollama?.reachable :
                  current.startsWith('disabled') ? true :
                  keySaved[PROVIDER_DEFS[current.split(':')[0]]?.keyId]
                } /></span>
              </div>
              <select
                value={current}
                onChange={e => handleFeatureChange(feature, e.target.value)}
                style={selectStyle}
              >
                {groups.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          );
        })}

        {/* ─── My Providers ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, providers: !p.providers }))} style={{ ...sectionTitleStyle, marginTop: 8, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.providers ? '▸' : '▾'}</span> ◎ My Providers
        </div>

        {!collapsed.providers && <>
        {/* Add Provider */}
        {availableToAdd.length > 0 && (
          <div style={{ ...cardStyle, borderStyle: 'dashed', background: 'transparent' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.text.secondary, marginBottom: 8 }}>
              + Add Provider
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={addProviderType} onChange={e => setAddProviderType(e.target.value)}
                style={{ ...selectStyle, width: 'auto', minWidth: 160 }}>
                <option value="">Select provider...</option>
                {availableToAdd.map(p => (
                  <option key={p} value={p}>{PROVIDER_DEFS[p].label}</option>
                ))}
              </select>
              {addDef?.needsKey && (
                <input type="password" value={addProviderKey}
                  onChange={e => setAddProviderKey(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addProvider(addProviderType)}
                  placeholder={addDef.keyPlaceholder}
                  style={{ ...inputStyle, minWidth: 140 }} />
              )}
              <button onClick={() => addProvider(addProviderType)}
                disabled={!addProviderType || (addDef?.needsKey && !addProviderKey)}
                style={(addProviderType && (!addDef?.needsKey || addProviderKey)) ? btnPrimary : btnSecondary}>
                Add
              </button>
            </div>
            {addDef?.keyUrl && (
              <div style={{ fontSize: 10, color: theme.text.ghost, marginTop: 6 }}>
                <a href={addDef.keyUrl} target="_blank" rel="noopener noreferrer" style={{ color: theme.accent.indigo }}>Get an API key</a>
              </div>
            )}
          </div>
        )}

        {configuredProviders.length === 0 && (
          <div style={{ fontSize: 12, color: theme.text.dim, marginBottom: 12 }}>
            No providers added yet. Use the form above to add one.
          </div>
        )}

        {/* Provider cards */}
        {configuredProviders.map(pid => {
          const def = PROVIDER_DEFS[pid];
          if (!def) return null;
          const models = providerModels[pid] || [];
          const isSyncing = syncingProvider === pid;
          const isOllama = pid === 'ollama';
          const hasKey = def.keyId ? keySaved[def.keyId] : true;

          return (
            <div key={pid} style={{
              ...cardStyle,
              ...(isOllama ? { borderColor: '#065f4633', background: 'linear-gradient(135deg, rgba(6,95,70,0.08), transparent)' } : {}),
            }}>
              {/* Header row: name + status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: isOllama ? '#34d399' : theme.text.primary }}>
                  {def.label}
                </span>
                {def.keyUrl && <a href={def.keyUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 20, color: theme.text.ghost, textDecoration: 'none', lineHeight: 1 }}
                  title={`Get ${def.label} API key`}>↗</a>}
                <StatusDot ok={isOllama ? status?.ollama?.reachable : hasKey} />
                <span style={{ fontSize: 11, color: theme.text.dim }}>
                  {models.length > 0 ? `${models.length} models` : 'Not synced'}
                </span>
                <span style={{ marginLeft: 'auto' }}><span onClick={() => removeProvider(pid)} style={{
                  fontSize: 11, color: theme.text.ghost, cursor: 'pointer', padding: '4px',
                }} title={`Remove ${def.label}`}>✕</span></span>
              </div>

              {/* Input + actions row */}
              <div style={{ display: 'flex', gap: 8 }}>
                {isOllama && (
                  <input type="text" value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveOllamaUrl()}
                    placeholder="http://localhost:11434" style={inputStyle} />
                )}
                {def.needsKey && (
                  <input type="password" value={keys[def.keyId] || ''}
                    onChange={e => setKeys(prev => ({ ...prev, [def.keyId]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && (isOllama ? saveOllamaUrl() : saveApiKey(def.keyId))}
                    placeholder={hasKey ? 'Key saved (enter new to replace)' : def.keyPlaceholder}
                    style={inputStyle} />
                )}
                {isOllama && (
                  <button onClick={saveOllamaUrl} style={btnSecondary}>Save</button>
                )}
                {def.needsKey && (
                  <button onClick={() => saveApiKey(def.keyId)}
                    disabled={!keys[def.keyId]}
                    style={keys[def.keyId] ? btnPrimary : btnSecondary}>Save</button>
                )}
                <button onClick={() => syncProvider(pid)} disabled={isSyncing}
                  style={btnPrimary}>
                  {isSyncing ? 'Syncing...' : 'Sync'}
                </button>
              </div>

              {/* Synced model list — expandable */}
              {models.length > 0 && (
                <>
                  <div onClick={() => setExpandedModels(prev => ({ ...prev, [pid]: !prev[pid] }))}
                    style={{ fontSize: 11, color: theme.text.dim, cursor: 'pointer', userSelect: 'none', marginTop: 4 }}>
                    {expandedModels[pid] ? '▾' : '▸'} {models.length} models
                  </div>
                  {expandedModels[pid] && (
                    <div style={{ fontSize: 10, color: theme.text.ghost, maxHeight: 120, overflowY: 'auto', lineHeight: '1.6', marginTop: 6, paddingLeft: 12 }}>
                      {models.map((m, i) => <div key={i}>{m.label || m.name}</div>)}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        </>}

        {/* ─── Local Tools ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, local: !p.local }))} style={{ ...sectionTitleStyle, marginTop: 12, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.local ? '▸' : '▾'}</span> ⊡ Local Tools
        </div>

        {!collapsed.local && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>Claude CLI</span>
              <StatusDot ok={status?.claudeCli?.available} loading={!status} />
            </div>
            <div style={{ fontSize: 11, color: status?.claudeCli?.available ? '#34d399' : theme.text.dim }}>
              {status?.claudeCli?.available ? 'Installed' : status ? 'Not found' : 'Checking...'}
            </div>
            <div style={{ fontSize: 10, color: theme.text.ghost, marginTop: 4 }}>
              No API key — uses Claude Code subscription
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>Embedded Model</span>
              <StatusDot ok={status?.embedded?.ready || status?.embedded?.cached} />
            </div>
            <div style={{ fontSize: 11, color: (status?.embedded?.ready || status?.embedded?.cached) ? '#34d399' : theme.text.dim }}>
              {status?.embedded?.ready ? 'Loaded' : status?.embedded?.cached ? 'Ready (loads on first use)' : 'Not downloaded'}
            </div>
            <div style={{ fontSize: 10, color: theme.text.ghost, marginTop: 4 }}>
              bge-micro-v2 (384-dim, ~25 MB)
            </div>
            {!status?.embedded?.ready && (
              <button onClick={preloadEmbedded} disabled={embeddedLoading}
                style={{ ...btnSecondary, marginTop: 8, fontSize: 11, padding: '6px 12px' }}>
                {embeddedLoading ? 'Loading...' : 'Pre-download'}
              </button>
            )}
          </div>
        </div>}

        {/* ─── Brave Search ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, brave: !p.brave }))} style={{ ...sectionTitleStyle, marginTop: 4, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.brave ? '▸' : '▾'}</span> ◌ Brave Search
        </div>
        {!collapsed.brave && <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>Brave Search API</span>
            <StatusDot ok={keySaved.brave} />
            <span style={{ fontSize: 10, color: theme.text.ghost }}>Chat web search</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="password" value={keys.brave || ''}
              onChange={e => setKeys(prev => ({ ...prev, brave: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && saveBraveKey()}
              placeholder={keySaved.brave ? 'Saved' : 'BSA-...  (optional)'}
              style={inputStyle} />
            <button onClick={saveBraveKey} disabled={!keys.brave}
              style={keys.brave ? btnPrimary : btnSecondary}>Save</button>
            {keySaved.brave && <button onClick={removeBraveKey} style={btnDanger}>Remove</button>}
          </div>
          <div style={{ fontSize: 10, color: theme.text.ghost, marginTop: 6 }}>
            {keySaved.brave ? 'Configured. Free tier: 2,000 queries/month.' : 'Optional — DuckDuckGo used as fallback.'}
            {' '}<a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer" style={{ color: theme.accent.indigo }}>Get a key</a>
          </div>
        </div>}

        {/* ─── WhatsApp Bot ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, whatsapp: !p.whatsapp }))} style={{ ...sectionTitleStyle, marginTop: 12, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.whatsapp ? '▸' : '▾'}</span> ◈ WhatsApp Bot
        </div>
        {!collapsed.whatsapp && <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#25D366' }}>WhatsApp Group Bot</span>
            <StatusDot ok={waBotStatus?.status === 'connected' && !!waGroupJid} />
            <span style={{ fontSize: 10, color: waBotStatus?.status === 'error' ? '#ef4444' : theme.text.ghost }}>
              {waBotStatus?.status === 'connected' ? (waGroupJid ? 'Active' : 'Connected — pick a group')
                : waBotStatus?.status === 'qr' ? 'Scan QR code'
                : waBotStatus?.status === 'error' ? 'Connection failed'
                : waBotStatus?.status === 'connecting' ? `Connecting...${waBotStatus.reconnectAttempts > 0 ? ` (attempt ${waBotStatus.reconnectAttempts})` : ''}`
                : 'Disconnected'}
            </span>
          </div>
          {waBotStatus?.lastError && (waBotStatus.status === 'error' || waBotStatus.status === 'connecting') && (
            <div style={{
              fontSize: 11, color: '#ef4444', background: '#ef444415',
              border: '1px solid #ef444430', borderRadius: 6, padding: '6px 10px',
              marginBottom: 10, lineHeight: 1.4,
            }}>
              {waBotStatus.lastError}
            </div>
          )}

          {/* WhatsApp Aliases */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.text.secondary, marginBottom: 8 }}>
              AI Aliases
            </div>
            {waAliases.length > 0 ? (
              <div style={{
                border: `1px solid ${theme.border.default}`, borderRadius: 8,
                overflow: 'hidden', marginBottom: 8,
              }}>
                {waAliases.map((a, i) => {
                  const def = WA_PROVIDER_DEFS[a.provider];
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', fontSize: 11,
                      borderBottom: i < waAliases.length - 1 ? `1px solid ${theme.border.default}` : 'none',
                      background: i % 2 === 0 ? 'transparent' : `${theme.bg.deep}44`,
                    }}>
                      <span style={{ color: '#25D366', fontWeight: 600, minWidth: 70 }}>@{a.tag}</span>
                      <span style={{ color: theme.text.dim, minWidth: 90 }}>{def?.label || a.provider}</span>
                      <span style={{ color: theme.text.ghost, flex: 1 }}>{a.model || '—'}</span>
                      <span onClick={() => {
                        const next = waAliases.filter((_, j) => j !== i);
                        setWaAliases(next);
                        saveConfig({ whatsapp: { aliases: next } });
                      }} style={{
                        color: theme.text.ghost, cursor: 'pointer', padding: '2px 4px',
                        fontSize: 13, lineHeight: 1,
                      }} title="Remove alias">✕</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: theme.text.dim, marginBottom: 8 }}>
                No aliases configured — using defaults (@claude, @gemini, @grok)
              </div>
            )}
            {/* Add alias form */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 12, color: '#25D366', fontWeight: 600 }}>@</span>
                <input type="text" value={addAliasTag}
                  onChange={e => setAddAliasTag(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="tag"
                  style={{ ...inputStyle, width: 70, padding: '5px 8px', fontSize: 11 }} />
              </div>
              <select value={addAliasProvider} onChange={e => { setAddAliasProvider(e.target.value); setAddAliasModel(''); }}
                style={{ ...selectStyle, width: 'auto', minWidth: 110, padding: '5px 8px', fontSize: 11 }}>
                <option value="">Provider...</option>
                {Object.entries(WA_PROVIDER_DEFS).map(([id, def]) => (
                  <option key={id} value={id}>{def.label}</option>
                ))}
              </select>
              {addAliasProvider && addAliasProvider !== 'claude-cli' && (providerModels[addAliasProvider]?.length > 0) ? (
                <select value={addAliasModel} onChange={e => setAddAliasModel(e.target.value)}
                  style={{ ...selectStyle, width: 'auto', minWidth: 160, padding: '5px 8px', fontSize: 11 }}>
                  <option value="">Default model</option>
                  {providerModels[addAliasProvider].map((m, i) => (
                    <option key={i} value={m.name}>{m.label || m.name}</option>
                  ))}
                </select>
              ) : addAliasProvider && addAliasProvider !== 'claude-cli' ? (
                <input type="text" value={addAliasModel}
                  onChange={e => setAddAliasModel(e.target.value)}
                  placeholder="model (optional)"
                  style={{ ...inputStyle, width: 140, padding: '5px 8px', fontSize: 11 }} />
              ) : null}
              <button onClick={async () => {
                const tag = addAliasTag.trim();
                if (!tag || !addAliasProvider) return;
                if (['save', 'basin', 'subbasin'].includes(tag)) { alert(`@${tag} is reserved`); return; }
                if (waAliases.some(a => a.tag === tag)) { alert(`@${tag} already exists`); return; }
                const next = [...waAliases, { tag, provider: addAliasProvider, model: addAliasModel }];
                setWaAliases(next);
                await saveConfig({ whatsapp: { aliases: next } });
                await syncAliasKeys(next);
                setAddAliasTag(''); setAddAliasProvider(''); setAddAliasModel('');
              }}
                disabled={!addAliasTag.trim() || !addAliasProvider}
                style={{
                  ...(addAliasTag.trim() && addAliasProvider ? btnPrimary : btnSecondary),
                  padding: '5px 12px', fontSize: 11,
                }}>
                Add
              </button>
            </div>
          </div>

          {/* QR Code display */}
          {waBotStatus?.status === 'qr' && waBotStatus.qrDataUrl && (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <img src={waBotStatus.qrDataUrl} alt="WhatsApp QR"
                style={{ width: 200, height: 200, borderRadius: 8, background: '#fff', padding: 8 }} />
              <div style={{ fontSize: 11, color: theme.text.dim, marginTop: 6 }}>
                {'Open WhatsApp > Linked Devices > Link a Device'}
              </div>
            </div>
          )}

          {/* Group picker — shown after connected */}
          {waBotStatus?.status === 'connected' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: theme.text.dim, marginBottom: 4 }}>Select group to monitor</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={waGroupJid} onChange={e => setWaGroupJid(e.target.value)} style={selectStyle}>
                  <option value="">Choose a group...</option>
                  {(waBotStatus.groups || []).map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button onClick={async () => {
                  try {
                    const result = await api.whatsappRefreshGroups();
                    setWaBotStatus(prev => ({ ...prev, groups: result.groups }));
                  } catch (err) { console.error(err); }
                }} style={btnSecondary} title="Refresh group list">↻</button>
                <button
                  onClick={async () => {
                    if (!waGroupJid) return;
                    // Sync all API keys needed by configured aliases
                    const aliasesToSync = waAliases.length > 0 ? waAliases : [
                      { provider: 'claude-cli' }, { provider: 'gemini' }, { provider: 'grok' },
                    ];
                    await syncAliasKeys(aliasesToSync);
                    await api.whatsappSelectGroup(waGroupJid);
                  }}
                  disabled={!waGroupJid}
                  style={waGroupJid ? btnPrimary : btnSecondary}>
                  Activate
                </button>
              </div>
            </div>
          )}

          {/* Chat Group picker — chat-only group (no capture/save) */}
          {waBotStatus?.status === 'connected' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: theme.text.dim, marginBottom: 4 }}>Chat-only group (no capture, no @save, no images)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={waChatGroupJid} onChange={e => setWaChatGroupJid(e.target.value)} style={selectStyle}>
                  <option value="">None</option>
                  {(waBotStatus.groups || []).map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    if (!waChatGroupJid) return;
                    const aliasesToSync = waAliases.length > 0 ? waAliases : [
                      { provider: 'claude-cli' }, { provider: 'gemini' }, { provider: 'grok' },
                    ];
                    await syncAliasKeys(aliasesToSync);
                    await api.whatsappSelectChatGroup(waChatGroupJid);
                  }}
                  disabled={!waChatGroupJid}
                  style={waChatGroupJid ? btnPrimary : btnSecondary}>
                  Activate
                </button>
              </div>
            </div>
          )}

          {/* Connected + group selected = show active state */}
          {waBotStatus?.status === 'connected' && waGroupJid && (
            <div style={{ fontSize: 11, color: '#34d399', marginBottom: 8 }}>
              Monitoring: {waBotStatus.groups?.find(g => g.id === waGroupJid)?.name || waGroupJid}
              {waChatGroupJid && (
                <span style={{ color: theme.text.dim }}> | Chat: {waBotStatus.groups?.find(g => g.id === waChatGroupJid)?.name || waChatGroupJid}</span>
              )}
            </div>
          )}

          {/* Connect / Disconnect / Re-pair buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {(!waBotStatus || waBotStatus.status === 'disconnected') && (
              <button onClick={async () => {
                setWaConnecting(true);
                try { await api.whatsappConnect(); } catch (err) { console.error(err); }
                setWaConnecting(false);
              }} disabled={waConnecting}
                style={{ ...btnPrimary, background: 'linear-gradient(135deg, #25D366, #128C7E)' }}>
                {waConnecting ? 'Connecting...' : 'Connect WhatsApp'}
              </button>
            )}
            {waBotStatus?.status === 'error' && (
              <button onClick={async () => {
                setWaConnecting(true);
                try { await api.whatsappRepair(); } catch (err) { console.error(err); }
                setWaConnecting(false);
              }} disabled={waConnecting}
                style={{ ...btnPrimary, background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                {waConnecting ? 'Re-pairing...' : 'Re-pair (new QR)'}
              </button>
            )}
            {waBotStatus && waBotStatus.status !== 'disconnected' && (
              <button onClick={async () => {
                await api.whatsappDisconnect();
                setWaGroupJid('');
              }} style={btnDanger}>
                Disconnect
              </button>
            )}
          </div>
          <div style={hintStyle}>
            Add aliases to configure which AI models are available via @mentions in WhatsApp.
            When no aliases are set, defaults are used (@claude, @gemini, @grok).
          </div>
        </div>}

        {/* ─── Morning Briefing ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, briefing: !p.briefing }))} style={{ ...sectionTitleStyle, marginTop: 12, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.briefing ? '▸' : '▾'}</span> &#9749; Morning Briefing
        </div>
        {!collapsed.briefing && <div style={cardStyle}>
          {/* Enable toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={briefingEnabled} onChange={async (e) => {
                const val = e.target.checked;
                setBriefingEnabled(val);
                await saveConfig({ briefing: { enabled: val } });
                api.briefingRestartScheduler().then(r => setBriefingStatus(r.status)).catch(() => {});
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary }}>Enable daily briefing</span>
            </label>
            {briefingStatus && (
              <span style={{ fontSize: 10, color: briefingStatus.enabled ? '#34d399' : theme.text.ghost, marginLeft: 'auto' }}>
                {briefingStatus.enabled ? 'Scheduler active' : 'Scheduler off'}
              </span>
            )}
          </div>

          {/* Schedule */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 60 }}>Schedule</span>
            <input type="time" value={briefingTime} onChange={e => setBriefingTime(e.target.value)}
              style={{ ...inputStyle, width: 100, padding: '5px 8px', fontSize: 11 }} />
            <select value={briefingTimezone} onChange={e => setBriefingTimezone(e.target.value)}
              style={{ ...selectStyle, width: 'auto', minWidth: 180, padding: '5px 8px', fontSize: 11 }}>
              {['Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane', 'Australia/Perth',
                'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Shanghai',
                'Pacific/Auckland', 'UTC'].map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <button onClick={async () => {
              const [hh, mm] = briefingTime.split(':');
              const schedule = `${parseInt(mm)} ${parseInt(hh)} * * *`;
              await saveConfig({ briefing: { schedule, timezone: briefingTimezone } });
              api.briefingRestartScheduler().then(r => setBriefingStatus(r.status)).catch(() => {});
            }} style={{ ...btnSecondary, padding: '5px 10px', fontSize: 11 }}>Set</button>
          </div>

          {/* Provider */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 60 }}>Provider</span>
            <select value={briefingProvider} onChange={async (e) => {
              setBriefingProvider(e.target.value);
              setBriefingModel('');
              await saveConfig({ briefing: { provider: e.target.value, model: '' } });
            }} style={{ ...selectStyle, width: 'auto', minWidth: 140, padding: '5px 8px', fontSize: 11 }}>
              {Object.entries(WA_PROVIDER_DEFS).map(([id, def]) => (
                <option key={id} value={id}>{def.label}</option>
              ))}
            </select>
            {briefingProvider && briefingProvider !== 'claude-cli' && (
              (providerModels[briefingProvider]?.length > 0) ? (
                <select value={briefingModel} onChange={async (e) => {
                  setBriefingModel(e.target.value);
                  await saveConfig({ briefing: { model: e.target.value } });
                }} style={{ ...selectStyle, width: 'auto', minWidth: 160, padding: '5px 8px', fontSize: 11 }}>
                  <option value="">Default model</option>
                  {providerModels[briefingProvider].map((m, i) => (
                    <option key={i} value={m.name}>{m.label || m.name}</option>
                  ))}
                </select>
              ) : (
                <input type="text" value={briefingModel} onChange={e => setBriefingModel(e.target.value)}
                  onBlur={async () => saveConfig({ briefing: { model: briefingModel } })}
                  placeholder="model (optional)"
                  style={{ ...inputStyle, width: 140, padding: '5px 8px', fontSize: 11 }} />
              )
            )}
          </div>

          {/* Sections */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, display: 'block', marginBottom: 6 }}>Sections</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
              {[
                ['kbActivity', 'KB Activity'],
                ['crossRefs', 'Cross-refs'],
                ['rssFeeds', 'RSS Feeds'],
                ['braveSearch', 'Web Search'],
                ['randomConnection', 'Random Connection'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: theme.text.primary }}>
                  <input type="checkbox" checked={briefingSections[key] !== false} onChange={async (e) => {
                    const next = { ...briefingSections, [key]: e.target.checked };
                    setBriefingSections(next);
                    await saveConfig({ briefing: { sections: next } });
                  }} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Delivery */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, display: 'block', marginBottom: 6 }}>Delivery</span>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: theme.text.primary }}>
                <input type="checkbox" checked={briefingWhatsapp} onChange={async (e) => {
                  setBriefingWhatsapp(e.target.checked);
                  await saveConfig({ briefing: { whatsappDelivery: e.target.checked } });
                }} />
                WhatsApp
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: theme.text.primary }}>
                <input type="checkbox" checked={briefingArtifact} onChange={async (e) => {
                  setBriefingArtifact(e.target.checked);
                  await saveConfig({ briefing: { artifactSave: e.target.checked } });
                }} />
                Save as Artifact
              </label>
            </div>
          </div>

          {/* RSS Feeds */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, display: 'block', marginBottom: 6 }}>RSS Feeds</span>
            {briefingRssFeeds.length > 0 && (
              <div style={{
                border: `1px solid ${theme.border.default}`, borderRadius: 8,
                overflow: 'hidden', marginBottom: 8,
              }}>
                {briefingRssFeeds.map((feed, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 10px', fontSize: 10,
                    borderBottom: i < briefingRssFeeds.length - 1 ? `1px solid ${theme.border.default}` : 'none',
                    background: i % 2 === 0 ? 'transparent' : `${theme.bg.deep}44`,
                  }}>
                    <span style={{ color: theme.accent.indigo, fontWeight: 600, minWidth: 80 }}>{feed.name}</span>
                    <span style={{ color: theme.text.ghost, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feed.url}</span>
                    <span onClick={() => {
                      const next = briefingRssFeeds.filter((_, j) => j !== i);
                      setBriefingRssFeeds(next);
                      saveConfig({ briefing: { rssFeeds: next } });
                    }} style={{ color: theme.text.ghost, cursor: 'pointer', padding: '2px 4px', fontSize: 12, lineHeight: 1 }} title="Remove feed">✕</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="text" value={addRssName} onChange={e => setAddRssName(e.target.value)}
                placeholder="Name" style={{ ...inputStyle, width: 90, padding: '4px 8px', fontSize: 10 }} />
              <input type="text" value={addRssUrl} onChange={e => setAddRssUrl(e.target.value)}
                placeholder="https://..." style={{ ...inputStyle, flex: 1, padding: '4px 8px', fontSize: 10 }} />
              <button onClick={async () => {
                if (!addRssUrl.trim()) return;
                const next = [...briefingRssFeeds, { url: addRssUrl.trim(), name: addRssName.trim() || addRssUrl.trim(), category: 'custom' }];
                setBriefingRssFeeds(next);
                await saveConfig({ briefing: { rssFeeds: next } });
                setAddRssName(''); setAddRssUrl('');
              }} disabled={!addRssUrl.trim()}
                style={{ ...(addRssUrl.trim() ? btnPrimary : btnSecondary), padding: '4px 10px', fontSize: 10 }}>Add</button>
            </div>
          </div>

          {/* Brave Topics */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, display: 'block', marginBottom: 6 }}>Brave Search Topics</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {briefingBraveTopics.map((topic, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: theme.bg.deep, border: `1px solid ${theme.border.default}`,
                  borderRadius: 12, padding: '2px 8px 2px 10px', fontSize: 10, color: theme.text.primary,
                }}>
                  {topic}
                  <span onClick={() => {
                    const next = briefingBraveTopics.filter((_, j) => j !== i);
                    setBriefingBraveTopics(next);
                    saveConfig({ briefing: { braveSearchTopics: next } });
                  }} style={{ cursor: 'pointer', color: theme.text.ghost, fontSize: 12, lineHeight: 1 }}>✕</span>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="text" value={addBraveTopic} onChange={e => setAddBraveTopic(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && addBraveTopic.trim()) {
                    const next = [...briefingBraveTopics, addBraveTopic.trim()];
                    setBriefingBraveTopics(next);
                    await saveConfig({ briefing: { braveSearchTopics: next } });
                    setAddBraveTopic('');
                  }
                }}
                placeholder="e.g. AI news, robotics"
                style={{ ...inputStyle, width: 200, padding: '4px 8px', fontSize: 10 }} />
              <button onClick={async () => {
                if (!addBraveTopic.trim()) return;
                const next = [...briefingBraveTopics, addBraveTopic.trim()];
                setBriefingBraveTopics(next);
                await saveConfig({ briefing: { braveSearchTopics: next } });
                setAddBraveTopic('');
              }} disabled={!addBraveTopic.trim()}
                style={{ ...(addBraveTopic.trim() ? btnPrimary : btnSecondary), padding: '4px 10px', fontSize: 10 }}>Add</button>
            </div>
            <div style={hintStyle}>Fallback topics when RSS feeds return fewer than 3 items.</div>
          </div>

          {/* Test Now + Status */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={async () => {
              setBriefingTesting(true);
              setBriefingTestResult(null);
              try {
                const result = await api.briefingTrigger();
                setBriefingTestResult({ ok: true, text: result.briefing });
                api.briefingStatus().then(setBriefingStatus).catch(() => {});
              } catch (err) {
                setBriefingTestResult({ ok: false, text: err.message });
              } finally {
                setBriefingTesting(false);
              }
            }} disabled={briefingTesting}
              style={{ ...btnPrimary, background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
              {briefingTesting ? 'Generating...' : 'Test Now'}
            </button>
            <button onClick={async () => {
              setBriefingTesting(true);
              try {
                const result = await api.briefingTestRss();
                setBriefingTestResult({ ok: true, text: `${result.count} RSS items found:\n${result.items.slice(0, 5).map(i => `- ${i.source}: ${i.title}`).join('\n')}` });
              } catch (err) {
                setBriefingTestResult({ ok: false, text: err.message });
              } finally {
                setBriefingTesting(false);
              }
            }} disabled={briefingTesting} style={btnSecondary}>
              Test RSS
            </button>
            {briefingStatus?.lastRun && (
              <span style={{ fontSize: 10, color: theme.text.ghost }}>
                Last: {new Date(briefingStatus.lastRun).toLocaleString()}
              </span>
            )}
          </div>

          {/* Test result */}
          {briefingTestResult && (
            <div style={{
              marginTop: 8, padding: 10, borderRadius: 8,
              background: briefingTestResult.ok ? `${theme.accent.green}11` : `${theme.accent.red}11`,
              border: `1px solid ${briefingTestResult.ok ? theme.accent.green : theme.accent.red}33`,
              fontSize: 11, color: theme.text.primary, whiteSpace: 'pre-wrap',
              maxHeight: 200, overflowY: 'auto', lineHeight: 1.5,
            }}>
              {briefingTestResult.text}
            </div>
          )}

          {briefingStatus?.lastError && (
            <div style={{ marginTop: 6, fontSize: 10, color: theme.accent.red }}>
              Error: {briefingStatus.lastError}
            </div>
          )}
        </div>}

        {/* ─── Chat Prompts ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, prompts: !p.prompts }))} style={{ ...sectionTitleStyle, marginTop: 12, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.prompts ? '▸' : '▾'}</span> {'\u270E'} Chat Prompts
        </div>

        {!collapsed.prompts && <div style={cardStyle}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary, marginBottom: 6 }}>
              Assistant Prompt
            </div>
            <textarea
              value={chatPrompts.assistantPrompt}
              onChange={e => { setChatPrompts(p => ({ ...p, assistantPrompt: e.target.value })); setChatPromptsSaved(false); }}
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.4, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary, marginBottom: 6 }}>
              Research Prompt
            </div>
            <textarea
              value={chatPrompts.researchPrompt}
              onChange={e => { setChatPrompts(p => ({ ...p, researchPrompt: e.target.value })); setChatPromptsSaved(false); }}
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.4, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary, marginBottom: 6 }}>
              Behavioral Guidelines
            </div>
            <textarea
              value={chatPrompts.guidelines}
              onChange={e => { setChatPrompts(p => ({ ...p, guidelines: e.target.value })); setChatPromptsSaved(false); }}
              rows={4}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.4, boxSizing: 'border-box' }}
            />
            <div style={hintStyle}>One guideline per line. Each line becomes a bullet point in the system prompt.</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={async () => {
              await saveConfig({ chat: chatPrompts });
              setChatPromptsSaved(true);
              setTimeout(() => setChatPromptsSaved(false), 2000);
            }} style={btnPrimary}>
              {chatPromptsSaved ? 'Saved!' : 'Save Prompts'}
            </button>
            <button onClick={() => {
              const defaults = {
                assistantPrompt: 'You are the Idea Basin assistant \u2014 a helpful AI embedded in a knowledge management app. You can search the knowledge base, browse nodes, create new nodes and resources, read local files, and open files.',
                researchPrompt: 'You are a research assistant embedded in a knowledge management app. Your focus is finding, synthesizing, and organizing information. Use search tools proactively, cite sources, and create artifact documents for substantial findings. Be thorough and analytical.',
                guidelines: 'Be concise and helpful. Use short paragraphs.\nWhen the user asks about something in their knowledge base, use the auto-retrieved context above first. If it\'s not sufficient, use search_knowledge for a more targeted query.\nWhen creating nodes or resources, confirm what you created and mention the ID.\nFor general conversation (greetings, opinions, coding help), respond directly without tools.\nIf you\'re unsure which node to use, call list_nodes first.',
              };
              setChatPrompts(defaults);
              setChatPromptsSaved(false);
            }} style={btnSecondary}>
              Reset to Defaults
            </button>
          </div>
        </div>}

        {/* ─── AI Memory ─── */}
        <div onClick={() => setCollapsed(p => ({ ...p, memory: !p.memory }))} style={{ ...sectionTitleStyle, marginTop: 12, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{collapsed.memory ? '▸' : '▾'}</span> {'\u{1F9E0}'} AI Memory
          <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 'auto' }}>{memories.length}/50</span>
        </div>

        {!collapsed.memory && <div style={cardStyle}>
          <div style={hintStyle}>Facts saved by AIs or via <b>@memory</b> in WhatsApp. These are injected into every AI conversation for continuity.</div>
          {memories.length === 0 && <div style={{ fontSize: 12, opacity: 0.5, textAlign: 'center', padding: 16 }}>No memories yet. Use @memory in WhatsApp or let AIs save facts automatically.</div>}
          {memories.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: m.source === 'ai' ? theme.accent.blue : theme.accent.green, color: '#fff', whiteSpace: 'nowrap', marginTop: 1 }}>
                {m.source === 'ai' ? 'AI' : 'You'}
              </span>
              <div style={{ flex: 1, fontSize: 12, color: theme.text.primary }}>{m.text}</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 9, opacity: 0.4 }}>{new Date(m.date).toLocaleDateString()}</span>
                <button onClick={async () => {
                  try {
                    await api.deleteMemory(m.id);
                    setMemories(prev => prev.filter(x => x.id !== m.id));
                  } catch (err) {
                    console.error('Delete memory failed:', err);
                  }
                }} style={{ ...btnSecondary, fontSize: 9, padding: '1px 6px' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>}

        {saving && (
          <div style={{ fontSize: 11, color: theme.accent.amber, textAlign: 'center', marginTop: 8 }}>
            Saving...
          </div>
        )}
      </div>
    </div>
  );
}
