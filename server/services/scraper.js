import * as cheerio from 'cheerio';

// URLs that require authentication — detect early and give clear feedback
const AUTH_PATTERNS = [
  { pattern: /docs\.google\.com/, name: 'Google Docs' },
  { pattern: /drive\.google\.com/, name: 'Google Drive' },
  { pattern: /notion\.so/, name: 'Notion' },
  { pattern: /confluence/, name: 'Confluence' },
  { pattern: /figma\.com/, name: 'Figma' },
  { pattern: /miro\.com/, name: 'Miro' },
];

export function checkAuthWalled(url) {
  for (const { pattern, name } of AUTH_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return null;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function scrape(url) {
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';

    // PDF handling
    if (contentType.includes('pdf') || url.endsWith('.pdf')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      return data.text;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract title for fallback
    const title = $('title').text().trim();

    // Extract meta description
    const metaDesc = $('meta[name="description"]').attr('content')
      || $('meta[property="og:description"]').attr('content')
      || '';

    // Remove noise
    $('script, style, nav, footer, header, aside, iframe, .sidebar, .nav, .footer, .header, .ad, .ads, .cookie, .popup, .modal').remove();

    // Try article/main content first
    let text = $('article').text() || $('main').text() || $('[role="main"]').text();
    if (!text || text.trim().length < 100) {
      text = $('body').text();
    }

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    // If body text is too short, use title + meta as fallback
    if (text.length < 50 && (title || metaDesc)) {
      text = [title, metaDesc, text].filter(Boolean).join('\n\n');
    }

    return text || null;
  } catch (err) {
    console.error(`[scraper] Failed for ${url}:`, err.message);
    return null;
  }
}

// ── Thumbnail extraction ──────────────────────────────────────────────

export function extractYouTubeThumbnail(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

export async function extractOgImage(url) {
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = await response.text();
    const $ = cheerio.load(html);
    const ogImage = $('meta[property="og:image"]').attr('content')
      || $('meta[name="twitter:image"]').attr('content');
    return ogImage || null;
  } catch {
    return null;
  }
}

export function extractThumbnailUrl(url) {
  // YouTube: predictable URL, no fetch needed
  const ytThumb = extractYouTubeThumbnail(url);
  if (ytThumb) return ytThumb;
  return null;
}

export async function scrapeYouTube(url) {
  // Try transcript first
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const transcript = await YoutubeTranscript.fetchTranscript(url);
    if (transcript && transcript.length > 0) {
      return transcript.map(t => t.text).join(' ');
    }
  } catch (err) {
    console.log(`[scraper] YouTube transcript not available: ${err.message}`);
  }

  // Fallback: scrape the page for title, description, and metadata
  console.log('[scraper] Falling back to YouTube page scrape');
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('meta[name="title"]').attr('content')
      || $('meta[property="og:title"]').attr('content')
      || $('title').text();
    const description = $('meta[name="description"]').attr('content')
      || $('meta[property="og:description"]').attr('content')
      || '';
    const channel = $('link[itemprop="name"]').attr('content') || '';

    const parts = [
      title ? `Title: ${title}` : null,
      channel ? `Channel: ${channel}` : null,
      description ? `Description: ${description}` : null,
      '(No transcript available — metadata only)',
    ].filter(Boolean);

    const text = parts.join('\n');
    return text.length > 30 ? text : null;
  } catch (err) {
    console.error(`[scraper] YouTube page scrape failed:`, err.message);
    return null;
  }
}

export async function scrapeGitHub(url) {
  try {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return scrape(url);
    const [, owner, repo] = match;

    // Try raw README
    for (const branch of ['main', 'master']) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
      const response = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) return await response.text();
    }

    // Fallback: scrape the repo page
    return scrape(url);
  } catch (err) {
    return scrape(url);
  }
}

// arxiv: try abstract page for cleaner text
export async function scrapeArxiv(url) {
  try {
    // Convert /pdf/ or /html/ to /abs/ for clean abstract
    const absUrl = url.replace(/\/(pdf|html)\//, '/abs/');
    const response = await fetch(absUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('h1.title').text().replace('Title:', '').trim();
    const authors = $('div.authors').text().replace('Authors:', '').trim();
    const abstract = $('blockquote.abstract').text().replace('Abstract:', '').trim();

    if (abstract) {
      return `${title}\n\nAuthors: ${authors}\n\nAbstract: ${abstract}`;
    }

    // If abs page didn't work, try the original URL
    return scrape(url);
  } catch (err) {
    return scrape(url);
  }
}
