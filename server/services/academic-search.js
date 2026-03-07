import https from 'https';
import http from 'http';
import { load as loadCheerio } from 'cheerio';

// In-memory cache with 30-min TTL
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ── Semantic Scholar ──────────────────────────────────────────────────

export function searchSemanticScholar(query, { limit = 5, year } = {}) {
  const cacheKey = `ss:${query}:${limit}:${year || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
    url.searchParams.set('query', query);
    url.searchParams.set('fields', 'title,abstract,authors,year,citationCount,externalIds,url,publicationDate');
    url.searchParams.set('limit', String(Math.min(limit, 10)));
    if (year) url.searchParams.set('year', year);

    https.get(url.toString(), { headers: { 'User-Agent': 'IdeaBasin/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Semantic Scholar API returned ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          const json = JSON.parse(data);
          const papers = (json.data || []).map(p => ({
            title: p.title || 'Untitled',
            abstract: p.abstract || null,
            authors: (p.authors || []).map(a => a.name).join(', '),
            year: p.year,
            citations: p.citationCount || 0,
            url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
            doi: p.externalIds?.DOI || null,
            arxivId: p.externalIds?.ArXiv || null,
            source: 'semantic_scholar',
          }));
          setCache(cacheKey, papers);
          resolve(papers);
        } catch (err) {
          reject(new Error(`Failed to parse Semantic Scholar response: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ── arXiv ─────────────────────────────────────────────────────────────

export function searchArxiv(query, { limit = 5, year } = {}) {
  const cacheKey = `ax:${query}:${limit}:${year || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const url = new URL('http://export.arxiv.org/api/query');

    let searchQuery = `all:${query}`;
    if (year) {
      // Year can be "2024" or "2024-2026"
      const parts = year.split('-');
      const startYear = parts[0];
      const endYear = parts[1] || parts[0];
      searchQuery += ` AND submittedDate:[${startYear}0101 TO ${endYear}1231]`;
    }

    url.searchParams.set('search_query', searchQuery);
    url.searchParams.set('max_results', String(Math.min(limit, 10)));
    url.searchParams.set('sortBy', 'relevance');
    url.searchParams.set('sortOrder', 'descending');

    http.get(url.toString(), { headers: { 'User-Agent': 'IdeaBasin/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`arXiv API returned ${res.statusCode}`));
            return;
          }
          const $ = loadCheerio(data, { xmlMode: true });
          const papers = [];

          $('entry').each((_, el) => {
            const entry = $(el);
            const title = entry.find('title').text().replace(/\s+/g, ' ').trim();
            const abstract = entry.find('summary').text().replace(/\s+/g, ' ').trim();
            const authors = entry.find('author name').map((_, a) => $(a).text()).get().join(', ');
            const published = entry.find('published').text();
            const pubYear = published ? new Date(published).getFullYear() : null;
            const link = entry.find('link[type="text/html"]').attr('href')
              || entry.find('id').text();
            const idText = entry.find('id').text();
            const arxivId = idText.match(/(\d{4}\.\d{4,5})/)?.[1] || null;

            papers.push({
              title,
              abstract: abstract || null,
              authors,
              year: pubYear,
              citations: null, // arXiv doesn't provide citation counts
              url: link,
              doi: null,
              arxivId,
              source: 'arxiv',
            });
          });

          setCache(cacheKey, papers);
          resolve(papers);
        } catch (err) {
          reject(new Error(`Failed to parse arXiv response: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ── Unified entry point ───────────────────────────────────────────────

export async function searchPapers(query, { source = 'all', limit = 5, year } = {}) {
  if (source === 'semantic_scholar') {
    return searchSemanticScholar(query, { limit, year });
  }
  if (source === 'arxiv') {
    return searchArxiv(query, { limit, year });
  }

  // Default: both in parallel, deduplicated
  const [ssResult, axResult] = await Promise.allSettled([
    searchSemanticScholar(query, { limit, year }),
    searchArxiv(query, { limit, year }),
  ]);

  const papers = [];
  const seenTitles = new Set();

  for (const result of [ssResult, axResult]) {
    if (result.status === 'fulfilled') {
      for (const paper of result.value) {
        const key = paper.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seenTitles.has(key)) {
          seenTitles.add(key);
          papers.push(paper);
        }
      }
    }
  }

  // If both failed, report the errors
  if (papers.length === 0) {
    const errors = [ssResult, axResult]
      .filter(r => r.status === 'rejected')
      .map(r => r.reason.message);
    if (errors.length > 0) {
      throw new Error(`Paper search failed: ${errors.join('; ')}`);
    }
  }

  return papers;
}

// Clean up expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}, 1000 * 60 * 10).unref();
