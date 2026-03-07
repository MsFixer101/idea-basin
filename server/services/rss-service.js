import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 10_000,
  headers: { 'User-Agent': 'IdeaBasin/1.0' },
});

// In-memory cache: url → { items, fetchedAt }
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch recent items from a list of RSS feeds.
 * @param {Array<{ url, name, category }>} feeds
 * @param {number} maxAgeHours — only return items published within this many hours
 * @returns {Promise<Array<{ id, title, link, snippet, published, source, category }>>}
 */
export async function fetchRecentItems(feeds, maxAgeHours = 24) {
  if (!feeds || feeds.length === 0) return [];

  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const results = await Promise.allSettled(
    feeds.map(feed => fetchFeed(feed, cutoff))
  );

  const items = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    }
  }

  // Sort by published date descending
  items.sort((a, b) => new Date(b.published) - new Date(a.published));
  return items;
}

async function fetchFeed(feed, cutoff) {
  const { url, name, category } = feed;

  // Check cache
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.items.filter(i => new Date(i.published).getTime() > cutoff);
  }

  try {
    const parsed = await parser.parseURL(url);
    const items = (parsed.items || []).map(item => ({
      id: item.link || item.guid || item.title,
      title: (item.title || '').trim(),
      link: item.link || '',
      snippet: truncate(stripHtml(item.contentSnippet || item.content || item.summary || ''), 200),
      published: item.isoDate || item.pubDate || new Date().toISOString(),
      source: name || parsed.title || url,
      category: category || 'general',
    }));

    cache.set(url, { items, fetchedAt: Date.now() });
    return items.filter(i => new Date(i.published).getTime() > cutoff);
  } catch (err) {
    console.warn(`[rss] Failed to fetch ${name || url}: ${err.message}`);
    return [];
  }
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

// Clean expired cache entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [url, entry] of cache) {
    if (now - entry.fetchedAt > CACHE_TTL) cache.delete(url);
  }
}, 15 * 60 * 1000).unref();
