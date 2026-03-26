import cron from 'node-cron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get as getConfig } from './config.js';
import { callProvider, getApiKey, sendToGroup } from './whatsapp-bot.js';
import { fetchRecentItems } from './rss-service.js';
import { performNewsSearch } from './web-search.js';

const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL || 'http://localhost:4000';
async function callModelService(prompt, system) {
  const resp = await fetch(`${MODEL_SERVICE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-cli-sonnet',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Model service error: ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}
import { getRecentActivity, getRecentCrossRefs, getActiveBasins, getKBStats, createResource } from '../db/queries.js';
import { ingest } from '../workers/ingest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEN_PATH = join(__dirname, '..', 'data', 'briefing-seen.json');
import { homedir } from 'os';
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || join(homedir(), 'idea-basin-artifacts');
const ARTIFACTS_NODE_ID = '00000000-0000-0000-0000-000000000080';

let cronJob = null;
const state = {
  running: false,
  lastRun: null,
  lastError: null,
  lastBriefing: null,
  lastDelivery: null,
};

// ── Seen items tracking ─────────────────────────────────────────────────

async function loadSeen() {
  try {
    const raw = await readFile(SEEN_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

async function saveSeen(items) {
  // Prune entries older than 7 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const pruned = items.filter(i => new Date(i.date) >= cutoff);
  await mkdir(dirname(SEEN_PATH), { recursive: true });
  await writeFile(SEEN_PATH, JSON.stringify({ items: pruned }, null, 2));
}

// ── System prompt ───────────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = `You are the Idea Basin Morning DJ — a quirky knowledge curator who picks
the 3-5 most interesting things from today's data. You're opinionated,
funny, and allergic to boring corporate-speak.

WhatsApp formatting: *bold*, _italic_, emojis as punctuation.
Keep the ENTIRE briefing under 2000 characters (URLs count toward this).

CRITICAL RULES — ACCURACY:
- ONLY discuss items from the data provided below. Do NOT invent, fabricate, or embellish.
- Your description of each item MUST match what its title and snippet actually say. Do not reinterpret, speculate about, or dramatise the content beyond what the source text states.
- If an item's snippet is vague, keep your description vague too. Say less rather than guess.
- Include the source URL for each item on its own line. The URL is in the [square brackets] in the feed data.

STYLE RULES:
- Pick ONLY 3-5 items. Quality over quantity. Skip boring ones.
- Never repeat items marked as "ALREADY COVERED"
- Have opinions about WHY something matters, but do not alter WHAT it says.
- Make connections between items
- One rabbit-hole suggestion at the end (must be from the provided data)

STRUCTURE:
1. One-line greeting with day/date (use the LOCAL DATE provided, not UTC)
2. 3-5 picks, each with: bold title, 1-2 sentence opinion, source URL on its own line
3. One closing thought`;

// ── Data gathering ──────────────────────────────────────────────────────

async function gatherData(cfg) {
  const sections = cfg.sections || {};
  const tasks = {};

  if (sections.kbActivity !== false) {
    tasks.activity = getRecentActivity(24).catch(e => { console.warn('[briefing] activity:', e.message); return []; });
    tasks.stats = getKBStats().catch(e => { console.warn('[briefing] stats:', e.message); return null; });
  }
  if (sections.crossRefs !== false) {
    tasks.crossRefs = getRecentCrossRefs(24).catch(e => { console.warn('[briefing] crossrefs:', e.message); return []; });
    tasks.basins = getActiveBasins(72).catch(e => { console.warn('[briefing] basins:', e.message); return []; });
  }
  if (sections.rssFeeds !== false && cfg.rssFeeds?.length > 0) {
    tasks.rss = fetchRecentItems(cfg.rssFeeds, 24).catch(e => { console.warn('[briefing] rss:', e.message); return []; });
  }

  const results = {};
  for (const [key, promise] of Object.entries(tasks)) {
    results[key] = await promise;
  }

  // Brave search — always-on for broader news coverage
  if (sections.braveSearch !== false) {
    try {
      const topics = (cfg.braveSearchTopics || []).join(', ') || 'AI, technology';
      const query = `${topics} news`;
      const { results: searchResults } = await performNewsSearch(query, 10);
      results.search = (searchResults || []).map(r => ({
        id: `brave:${r.url}`,
        title: r.title,
        link: r.url,
        snippet: r.snippet,
        source: 'Web Search',
        category: 'search',
      }));
    } catch (e) {
      console.warn('[briefing] brave search:', e.message);
      results.search = [];
    }
  }

  return results;
}

// ── Prompt assembly ─────────────────────────────────────────────────────

function assemblePrompt(data, seenItems, timezone) {
  const parts = [];

  // Local date for greeting
  const localDate = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: timezone || 'UTC',
  });
  parts.push(`=== LOCAL DATE ===`);
  parts.push(`Today is ${localDate}`);
  parts.push('');

  // Already covered
  if (seenItems.length > 0) {
    parts.push('=== ALREADY COVERED (skip these) ===');
    for (const item of seenItems) {
      parts.push(`- [${item.type}] ${item.summary} (${item.date})`);
    }
    parts.push('');
  }

  // KB activity
  if (data.activity?.length > 0) {
    parts.push('=== YOUR KB (last 24h) ===');
    for (const r of data.activity.slice(0, 15)) {
      const tags = Array.isArray(r.tags) ? r.tags.join(', ') : '';
      parts.push(`- [${r.id}] "${r.description?.substring(0, 100) || r.type}" in ${r.node_label}${tags ? ` [tags: ${tags}]` : ''}`);
    }
    parts.push('');
  }

  if (data.crossRefs?.length > 0) {
    parts.push('=== NEW CONNECTIONS ===');
    for (const cr of data.crossRefs) {
      parts.push(`- [crossref-${cr.id}] ${cr.source_label} ↔ ${cr.target_label}: ${cr.reason || 'shared themes'}`);
    }
    parts.push('');
  }

  if (data.basins?.length > 0) {
    parts.push('=== MOST ACTIVE BASINS (72h) ===');
    for (const b of data.basins) {
      parts.push(`- ${b.label}: ${b.recent_count} new items`);
    }
    parts.push('');
  }

  if (data.stats) {
    parts.push(`=== KB STATS ===`);
    parts.push(`Total: ${data.stats.total_nodes} nodes, ${data.stats.total_resources} resources, ${data.stats.total_crossrefs} cross-refs`);
    parts.push(`Last 24h: +${data.stats.resources_24h} resources, +${data.stats.crossrefs_24h} cross-refs`);
    parts.push('');
  }

  // RSS — split into HN (high-signal, ranked by engagement) and other feeds
  if (data.rss?.length > 0) {
    const hn = data.rss.filter(i => i.source === 'Hacker News (Top)');
    const other = data.rss.filter(i => i.source !== 'Hacker News (Top)');

    if (hn.length > 0) {
      // Sort HN by points (highest first) — points are in the snippet as "Points: NNN"
      hn.sort((a, b) => {
        const pa = parseInt((a.snippet.match(/Points:\s*(\d+)/) || [])[1]) || 0;
        const pb = parseInt((b.snippet.match(/Points:\s*(\d+)/) || [])[1]) || 0;
        return pb - pa;
      });
      parts.push('=== HACKER NEWS (sorted by engagement — top items are the biggest stories) ===');
      for (const item of hn.slice(0, 10)) {
        parts.push(`- [${item.link}] "${item.title}" — ${item.snippet}`);
      }
      parts.push('');
    }

    if (other.length > 0) {
      parts.push('=== OTHER RSS FEEDS ===');
      for (const item of other.slice(0, 15)) {
        parts.push(`- [${item.id}] (${item.source}) "${item.title}" — ${item.snippet}`);
      }
      parts.push('');
    }
  }

  // Web search
  if (data.search?.length > 0) {
    parts.push('=== WEB SEARCH ===');
    for (const item of data.search) {
      parts.push(`- [${item.id}] "${item.title}" — ${item.snippet}`);
    }
    parts.push('');
  }

  if (parts.length === 0) {
    parts.push('=== NO DATA TODAY ===');
    parts.push('Nothing new in the KB, no RSS items, no search results. Say something fun anyway.');
  }

  parts.push('');
  parts.push('Pick the 3-5 most interesting things and write the briefing.');
  parts.push('PRIORITY GUIDANCE: Web Search and HN items with many points represent mainstream breaking news — do not overlook them in favour of niche arXiv papers. Aim for a mix: at least 1-2 from Web Search/HN and 1-2 from RSS/KB. Some HN titles are cryptic — read the URL and snippet to understand the real story.');
  parts.push('Also output a JSON block at the very end on its own line: {"picked": ["id1", "id2", ...]}');
  parts.push('so I can track what you covered. Use the IDs from the items above.');

  return parts.join('\n');
}

// ── Response parsing ────────────────────────────────────────────────────

function parseResponse(text) {
  // Extract the picked items JSON from the end
  const jsonMatch = text.match(/\{"picked"\s*:\s*\[.*?\]\s*\}/s);
  let picked = [];
  let briefingText = text;

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      picked = Array.isArray(parsed.picked) ? parsed.picked : [];
    } catch {}
    // Remove the JSON block from the delivered text
    briefingText = text.replace(jsonMatch[0], '').trim();
  }

  return { briefingText, picked };
}

// ── Artifact saving ─────────────────────────────────────────────────────

async function saveBriefingArtifact(briefingText) {
  const today = new Date().toISOString().split('T')[0];
  const title = `Morning Briefing ${today}`;

  try {
    const dir = join(ARTIFACTS_DIR, 'Artifacts');
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${title}.md`);
    const { writeFile: wf } = await import('fs/promises');
    await wf(filePath, briefingText, 'utf-8');

    const resource = await createResource({
      node_id: ARTIFACTS_NODE_ID,
      url: `file://${filePath}`,
      type: 'research',
      why: `Artifact: ${title}`,
      content: briefingText,
      status: 'pending',
    });

    ingest(resource.id).catch(err => console.error('[briefing] Ingest failed:', err.message));
    return resource;
  } catch (err) {
    console.error('[briefing] Save artifact failed:', err.message);
    return null;
  }
}

// ── Main briefing generation ────────────────────────────────────────────

export async function generateBriefing() {
  if (state.running) {
    console.log('[briefing] Already running, skipping');
    return null;
  }

  state.running = true;
  console.log('[briefing] Starting briefing generation...');

  try {
    const cfg = await getConfig('briefing') || {};
    const seenItems = await loadSeen();

    // Gather all data
    const data = await gatherData(cfg);

    // Assemble prompt
    const userPrompt = assemblePrompt(data, seenItems, cfg.timezone);
    const systemPrompt = cfg.prompt || DEFAULT_SYSTEM_PROMPT;

    // Call AI provider
    const provider = cfg.provider || 'claude-cli';
    const model = cfg.model || '';
    const waCfg = await getConfig('whatsapp') || {};

    let response;
    if (provider === 'claude-cli') {
      response = await callModelService(userPrompt, systemPrompt);
    } else {
      const apiKey = getApiKey(provider, waCfg);
      response = await callProvider(provider, model, userPrompt, systemPrompt, apiKey, waCfg);
    }

    if (!response) {
      throw new Error('AI returned empty response');
    }

    // Parse response
    const { briefingText, picked } = parseResponse(response);

    // Deliver
    const deliveryResults = { whatsapp: null, artifact: null };

    if (cfg.whatsappDelivery !== false) {
      deliveryResults.whatsapp = await sendToGroup(briefingText).catch(err => {
        console.warn('[briefing] WhatsApp delivery failed:', err.message);
        return null;
      });
    }

    if (cfg.artifactSave !== false) {
      deliveryResults.artifact = await saveBriefingArtifact(briefingText).catch(err => {
        console.warn('[briefing] Artifact save failed:', err.message);
        return null;
      });
    }

    // Update seen items (deduplicate by ID)
    const today = new Date().toISOString().split('T')[0];
    const newSeen = picked.map(id => {
      const isUrl = id.startsWith('http');
      const isBrave = id.startsWith('brave:');
      return {
        id,
        type: isBrave ? 'search' : isUrl ? 'rss' : 'kb',
        date: today,
        summary: id.substring(0, 100),
      };
    });
    const existingIds = new Set(seenItems.map(i => i.id));
    const deduped = newSeen.filter(i => !existingIds.has(i.id));
    await saveSeen([...seenItems, ...deduped]);

    state.lastRun = new Date().toISOString();
    state.lastBriefing = briefingText;
    state.lastDelivery = {
      whatsapp: !!deliveryResults.whatsapp,
      artifact: !!deliveryResults.artifact,
    };

    // Surface delivery failures as warnings (not errors, since the briefing itself succeeded)
    const failures = [];
    if (cfg.whatsappDelivery !== false && !deliveryResults.whatsapp) failures.push('WhatsApp delivery failed');
    if (cfg.artifactSave !== false && !deliveryResults.artifact) failures.push('Artifact save failed');
    state.lastError = failures.length > 0 ? failures.join('; ') : null;

    console.log(`[briefing] Done. Picked ${picked.length} items. WA: ${!!deliveryResults.whatsapp}, Artifact: ${!!deliveryResults.artifact}`);
    return briefingText;
  } catch (err) {
    console.error('[briefing] Generation failed:', err.message);
    state.lastError = err.message;
    throw err;
  } finally {
    state.running = false;
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────

export async function startScheduler() {
  // Stop any existing job first
  stopScheduler();

  const cfg = await getConfig('briefing') || {};
  if (!cfg.enabled) {
    console.log('[briefing] Scheduler disabled');
    return;
  }

  const schedule = cfg.schedule || '0 7 * * *';
  const timezone = cfg.timezone || 'UTC';

  if (!cron.validate(schedule)) {
    console.error(`[briefing] Invalid cron schedule: ${schedule}`);
    return;
  }

  cronJob = cron.schedule(schedule, () => {
    generateBriefing().catch(err => {
      console.error('[briefing] Scheduled run failed:', err.message);
    });
  }, { timezone });

  console.log(`[briefing] Scheduler started: ${schedule} (${timezone})`);
}

export function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[briefing] Scheduler stopped');
  }
}

export async function triggerNow() {
  return generateBriefing();
}

export function getSchedulerStatus() {
  return {
    enabled: !!cronJob,
    running: state.running,
    lastRun: state.lastRun,
    lastDelivery: state.lastDelivery || null,
    lastError: state.lastError,
    lastBriefing: state.lastBriefing,
  };
}
