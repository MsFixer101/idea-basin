import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = join(__dirname, '..', 'data', 'whatsapp-memory.json');
const MAX_ENTRIES = 50;

let cache = null;

async function load() {
  try {
    const raw = await readFile(MEMORY_PATH, 'utf-8');
    cache = JSON.parse(raw);
    if (!Array.isArray(cache.entries)) cache.entries = [];
  } catch {
    cache = { entries: [] };
  }
  return cache;
}

async function persist() {
  await writeFile(MEMORY_PATH, JSON.stringify(cache, null, 2));
}

export async function getMemories() {
  if (!cache) await load();
  return cache.entries;
}

export async function saveMemory(text, source = 'user') {
  if (!cache) await load();
  const entry = {
    id: `m_${Date.now()}_${randomBytes(2).toString('hex')}`,
    text: text.trim(),
    date: new Date().toISOString(),
    source,
  };
  cache.entries.push(entry);
  // Evict oldest if over limit
  if (cache.entries.length > MAX_ENTRIES) {
    cache.entries = cache.entries.slice(-MAX_ENTRIES);
  }
  await persist();
  return entry;
}

export async function deleteMemory(id) {
  if (!cache) await load();
  const before = cache.entries.length;
  cache.entries = cache.entries.filter(e => e.id !== id);
  if (cache.entries.length < before) {
    await persist();
    return true;
  }
  return false;
}
