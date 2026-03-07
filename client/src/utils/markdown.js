import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for GFM (tables, strikethrough, etc.)
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Convert markdown text to sanitized HTML.
 * Uses `marked` for parsing + DOMPurify to prevent XSS.
 *
 * @param {string} text  — raw markdown
 * @param {object} [opts]
 * @param {string} [opts.fontSize='10px']  — base font size (kept for API compat, not used by marked)
 * @param {string} [opts.linkColor='#22d3ee']
 */
export function renderMarkdown(text, opts = {}) {
  if (!text) return '';
  return DOMPurify.sanitize(marked.parse(text));
}

/**
 * Inline CSS for the markdown container — inject as a <style> or use in a style block.
 * Parameterised so ChatDrawer (small) and ArtifactViewer (large) can use different sizes.
 */
export function markdownStyles(cls, opts = {}) {
  const fs = opts.fontSize || '10px';
  const lh = opts.lineHeight || '1.5';
  const link = opts.linkColor || '#22d3ee';
  const base = parseFloat(fs);
  const unit = fs.replace(/[\d.]/g, '') || 'px';

  return `
    .${cls} { font-size: ${fs}; line-height: ${lh}; }
    .${cls} h1 { font-size: ${base + 4}${unit}; font-weight: 700; margin: 12px 0 4px; }
    .${cls} h2 { font-size: ${base + 3}${unit}; font-weight: 700; margin: 10px 0 4px; }
    .${cls} h3 { font-size: ${base + 2}${unit}; font-weight: 700; margin: 8px 0 4px; }
    .${cls} h4 { font-size: ${base + 1}${unit}; font-weight: 700; margin: 6px 0 4px; }
    .${cls} strong { font-weight: 700; }
    .${cls} em { font-style: italic; }
    .${cls} a { color: ${link}; text-decoration: none; }
    .${cls} a:hover { text-decoration: underline; }
    .${cls} pre { background: #0f0a1a; padding: 10px; border-radius: 4px; overflow-x: auto; margin: 6px 0; }
    .${cls} pre code { font-size: ${base}${unit}; }
    .${cls} code { background: #1e1545; padding: 1px 4px; border-radius: 3px; font-size: ${base}${unit}; }
    .${cls} ul, .${cls} ol { padding-left: 20px; margin: 4px 0; }
    .${cls} li { margin: 2px 0; }
    .${cls} blockquote { border-left: 3px solid #4c3f7a; padding-left: 10px; margin: 6px 0; color: #94a3b8; }
    .${cls} hr { border: none; border-top: 1px solid #1e1545; margin: 10px 0; }
    .${cls} table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    .${cls} th, .${cls} td { border: 1px solid #2e2565; padding: 5px 10px; text-align: left; }
    .${cls} th { background: #1e1545; font-weight: 700; }
    .${cls} tr:nth-child(even) { background: #0f0a1a; }
    .${cls} img { max-width: 100%; border-radius: 4px; }
    .${cls} p { margin: 4px 0; }
  `;
}
