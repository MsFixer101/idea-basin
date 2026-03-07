import https from 'https';
import { URL } from 'url';
import { get as getConfig } from './config.js';

// In-memory cache with 30-min TTL
const searchCache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

/**
 * Performs news search via Brave News API. Returns actual headlines, not index pages.
 * Falls back to regular web search if Brave key not configured.
 */
export async function performNewsSearch(query, numResults = 10) {
  const cacheKey = `news:${query}-${numResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { results: cached.results, provider: cached.provider, cached: true };
  }

  const braveKey = await getBraveApiKey();
  if (braveKey) {
    try {
      const results = await performBraveNewsSearch(query, numResults, braveKey);
      if (results.length > 0) {
        searchCache.set(cacheKey, { results, provider: 'brave-news', timestamp: Date.now() });
        return { results, provider: 'brave-news', cached: false };
      }
    } catch (err) {
      console.warn('[News Search] Brave News failed:', err.message);
    }
  }

  // Fall back to regular web search
  return performSearch(query, numResults);
}

/**
 * Performs web search — tries Brave first (if API key configured), falls back to DuckDuckGo.
 */
export async function performSearch(query, numResults = 5) {
  const cacheKey = `${query}-${numResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { results: cached.results, provider: cached.provider, cached: true };
  }

  const braveKey = await getBraveApiKey();

  if (braveKey) {
    try {
      const results = await performBraveSearch(query, numResults, braveKey);
      if (results.length > 0) {
        searchCache.set(cacheKey, { results, provider: 'brave', timestamp: Date.now() });
        return { results, provider: 'brave', cached: false };
      }
    } catch (err) {
      console.warn('[Web Search] Brave failed, falling back to DuckDuckGo:', err.message);
    }
  }

  const results = await performDuckDuckGoSearch(query, numResults);
  searchCache.set(cacheKey, { results, provider: 'duckduckgo', timestamp: Date.now() });
  return { results, provider: 'duckduckgo', cached: false };
}

async function getBraveApiKey() {
  // Check config first, then env var
  const fromConfig = await getConfig('brave_search_api_key');
  return fromConfig || process.env.BRAVE_SEARCH_API_KEY || null;
}

function performBraveSearch(query, numResults, apiKey) {
  return new Promise((resolve, reject) => {
    const searchUrl = new URL('https://api.search.brave.com/res/v1/web/search');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('count', numResults.toString());

    const options = {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    };

    https.get(searchUrl.toString(), options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) {
            reject(new Error(`Brave API returned ${response.statusCode}`));
            return;
          }
          const json = JSON.parse(data);
          const results = (json.web?.results || []).slice(0, numResults).map(r => ({
            title: r.title || 'Untitled',
            url: r.url,
            snippet: r.description || r.snippet || 'No description available',
          }));
          resolve(results);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Brave News search — returns actual news headlines, not index pages.
 */
function performBraveNewsSearch(query, numResults, apiKey) {
  return new Promise((resolve, reject) => {
    const searchUrl = new URL('https://api.search.brave.com/res/v1/news/search');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('count', numResults.toString());
    searchUrl.searchParams.set('freshness', 'pd');

    const options = {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    };

    https.get(searchUrl.toString(), options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) {
            reject(new Error(`Brave News API returned ${response.statusCode}`));
            return;
          }
          const json = JSON.parse(data);
          const results = (json.results || []).slice(0, numResults).map(r => ({
            title: r.title || 'Untitled',
            url: r.url,
            snippet: r.description || 'No description available',
          }));
          resolve(results);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function performDuckDuckGoSearch(query, numResults) {
  return new Promise((resolve, reject) => {
    const postData = `q=${encodeURIComponent(query)}`;
    const options = {
      hostname: 'lite.duckduckgo.com',
      path: '/lite/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };

    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const results = parseDuckDuckGoLite(data, numResults);
          if (results.length === 0) {
            resolve([{
              title: 'DuckDuckGo Search',
              url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
              snippet: `Search results for "${query}" - parsing returned no results. Consider adding a Brave Search API key for reliable results.`,
            }]);
          } else {
            resolve(results);
          }
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function parseDuckDuckGoLite(html, maxResults = 5) {
  const results = [];

  // DuckDuckGo Lite: class='result-link' for titles, class='result-snippet' for descriptions
  // href uses double quotes, class uses single quotes
  const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]+class='result-link'[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
    const url = match[1];
    const title = stripTags(decodeHTMLEntities(match[2])).trim();

    if (!url.includes('duckduckgo.com') && title.length > 5) {
      // Snippet is in a separate <tr> after the link row
      const afterMatch = html.substring(match.index, match.index + 2000);
      const snippetMatch = afterMatch.match(/class='result-snippet'[\s\S]*?>([\s\S]*?)<\/td>/);
      const snippet = snippetMatch
        ? stripTags(decodeHTMLEntities(snippetMatch[1])).trim()
        : 'No description available';
      results.push({ title, url, snippet });
    }
  }

  // Fallback: look for any external links with meaningful text
  if (results.length === 0) {
    const fallbackRegex = /<a[^>]+href="(https?:\/\/(?!.*duckduckgo)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = fallbackRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = stripTags(decodeHTMLEntities(match[2])).trim();
      if (title.length > 10 && !url.includes('duck.co')) {
        results.push({ title, url, snippet: 'Web search result' });
      }
    }
  }

  return results;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

// Clean up expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}, 1000 * 60 * 10).unref();
