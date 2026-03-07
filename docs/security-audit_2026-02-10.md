# Security Audit Report: Idea Basin

**Date:** 2026-02-10
**Scope:** Full codebase review
**Method:** Automated review of server, client, and Electron code

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 5 |
| Medium | 7 |
| Low | 6 |
| Info | 3 |

---

## Critical

### 1a. Shell injection in `search_files` via `execSync`
**File:** `server/services/chat-tools.js:354-357`

```js
const cmd = `find "${directory}" -maxdepth 5 -iname "${pattern}" ...`;
const output = execSync(cmd, ...);
```

`directory` and `pattern` are interpolated directly into a shell command string. Although `directory` is checked to start with `/Users/`, a value like `/Users/you"; rm -rf / #` breaks out of the quotes. The `pattern` field has no validation at all.

**Attack vector:** The AI chat determines tool arguments from conversation. A prompt injection attack (e.g., malicious content in a scraped page stored in the knowledge base) could trick the AI into calling `search_files` with a crafted directory or pattern.

**Fix:** Replace `execSync(cmd)` with `execFileSync('find', [directory, '-maxdepth', '5', '-iname', pattern, ...])` using argument arrays. Never use string interpolation for shell commands.

---

## High

### 1b. Shell command construction in `claude-cli.js`
**File:** `server/services/claude-cli.js:24-25`

```js
const cmd = `cat "${promptFile}" | claude --print --system-prompt "$(cat '${systemFile}')" 2>&1`;
exec(cmd, ...);
```

Uses `exec()` (shell-based) with `$(cat '...')` command substitution. Temp file paths are `Date.now()`-based so not directly user-controlled, but the pattern is fragile and dangerous.

**Fix:** Use `execFile()` with argument arrays instead of `exec()` with string interpolation.

### 3a. XSS via unsanitized markdown rendering
**Files:** `client/src/utils/markdown.js:20`, `client/src/components/NodePanel.jsx:171`, `client/src/components/ChatDrawer.jsx:175,393,449`

```js
export function renderMarkdown(text) {
  return marked.parse(text);  // no sanitization
}
```

`marked` passes through raw HTML by default. Content containing `<script>` tags or `<img onerror=...>` is rendered as-is via `dangerouslySetInnerHTML`. Content sources include AI responses (manipulable via prompt injection), scraped web pages, and user notes.

**Fix:** Install `dompurify` and sanitize: `return DOMPurify.sanitize(marked.parse(text))`.

### 3b. Popout window renders arbitrary HTML
**File:** `electron/main.js:216`

The popout window loads arbitrary HTML from the renderer process via `data:` URL. While `nodeIntegration: false` and `contextIsolation: true` mitigate RCE, scripts in the content still execute and can make network requests or exfiltrate displayed data.

**Fix:** Sanitize HTML before loading in the popout window (same DOMPurify fix as 3a).

### 4a. No authentication on any endpoint
**File:** `server/index.js` (all routes)

Zero authentication or authorization on any API endpoint. The server binds to `0.0.0.0:3500` (Express default), accessible on all network interfaces. Any device on the same LAN can read all data, delete nodes, read files under `/Users/`, modify config, and trigger chat tool calls.

**Fix (minimum):** Bind to localhost only: `app.listen(PORT, '127.0.0.1', ...)`. For Tailscale mobile access, add a bearer token middleware or basic auth.

### 11a. Prompt injection can trigger powerful tool calls
**File:** `server/services/chat-tools.js` (system-wide)

The chat AI has access to 16 tools including `read_file`, `search_files`, `save_resource`, `create_artifact`, and `fetch_url` — with no human confirmation for any operation. Malicious content in the knowledge base (via scraped pages) or encountered during web search could inject instructions into the AI's context.

**Fix:** Consider adding confirmation prompts for destructive operations, or restricting certain tools (file read, file write) to require explicit user invocation.

---

## Medium

### 1c. JS injection via `executeJavaScript` in Electron
**File:** `electron/main.js:191`

```js
await mainWindow.webContents.executeJavaScript(`window.__ideaBasinRefresh('${nodeId}')`);
```

`nodeId` comes from IPC and is not validated. A single quote in the value would inject arbitrary JavaScript.

**Fix:** Validate `nodeId` matches UUID format (`/^[0-9a-f-]{36}$/i`) before interpolation.

### 2a. Path traversal in `read_file` / `open_file`
**File:** `server/services/chat-tools.js:208,417`

```js
if (!path.startsWith('/Users/')) return { error: 'Path must be under /Users/' };
```

Does not prevent `..` sequences. `/Users/../etc/passwd` passes the check but resolves outside `/Users/`.

**Fix:** Use `path.resolve()` then verify the resolved path still starts with the allowed prefix:
```js
const resolved = path.resolve(userPath);
if (!resolved.startsWith('/Users/you/')) return { error: 'Access denied' };
```

### 4b. Config endpoint exposes full configuration
**File:** `server/routes/config.js:8-14`

`GET /api/config` returns entire config. `POST /api/config` allows overwriting any config value with no auth.

**Fix:** Bind to localhost (see 4a) or add authentication.

### 5a. `fetch_url` is an open SSRF proxy
**File:** `server/services/chat-tools.js:293-346`

Only checks `url.startsWith('http')`. Can probe internal network, cloud metadata endpoints (`169.254.169.254`), etc.

**Fix:** Block private/reserved IP ranges and localhost URLs. Consider a URL allowlist for known domains.

### 6a. CORS allows all origins
**File:** `server/index.js:32`

```js
app.use(cors());
```

Any website can make requests to `localhost:3500` and read responses. Combined with no auth, any malicious webpage gives full control.

**Fix:** `app.use(cors({ origin: ['http://localhost:3500', 'http://localhost:5173'] }))` or use a function to also allow Tailscale IPs.

### 6b. No CSRF protection
All state-changing operations use simple JSON POST/PATCH/DELETE with no CSRF tokens. Moot given open CORS, but would matter if CORS were fixed.

### 8a. Column name interpolation in SQL
**File:** `server/db/queries.js:254`

```js
const col = embedding.length === 384 ? 'embedding_384' : 'embedding';
query = `SELECT ... c.${col} ...`;
```

Currently only produces `'embedding_384'` or `'embedding'` (not exploitable), but the pattern is fragile.

---

## Low

### 2c. No path restriction on `/api/scan`
**File:** `server/routes/scan.js:15`

`scanDirectory` accepts any path from `req.body.path` with no restriction to `/Users/` or any directory.

### 2d. Upload subdirectory not validated as UUID
**File:** `server/index.js:58`

`node_id` used directly as subdirectory name without UUID validation. A crafted value could create directories outside the uploads folder.

### 5b. Ollama URL configurable to arbitrary endpoint
**File:** `server/services/ai-provider.js:26`, `server/routes/config.js:89`

Since `POST /api/config` has no auth, Ollama URL could be changed to an attacker-controlled endpoint, causing the server to send knowledge base content there.

### 7a. API key prefix logged to console
**File:** `server/routes/config.js:105`

First 8 characters of Claude API key logged: `console.log(...key starts with "${apiKey.slice(0, 8)}...")`.

### 8c. No UUID validation on route parameters
All route files pass `req.params.id` to database without UUID format validation. PostgreSQL rejects invalid UUIDs, but this causes 500s instead of 400s.

### 9a. No file type validation on upload
**File:** `server/index.js:48-70`

Upload endpoint accepts any base64-encoded data. Filename is sanitized, but no validation of extension, MIME type, or content. An HTML file could be uploaded and served via `express.static`, leading to stored XSS.

---

## Info (No Action Required)

### 7b. `.gitignore` is properly configured
Correctly covers `.env`, `server/data/config.json`, `server/uploads/`, `server/data/models/`, `node_modules/`.

### 8d. SQL queries are properly parameterized
All standard queries use `pg`'s `$1, $2, ...` parameterized syntax. No SQL injection in standard patterns.

### 9b. Upload size limit is enforced
10MB limit on file uploads and JSON body parsing.

### 10b. Dependencies are mostly current
Express 4.21, pg 8.13, marked 17.0, React 19, Vite 6, Electron 33.

---

## Dependency Concerns

### 10a. `pdf-parse` v1.1.1 is unmaintained
Last release 2018. Known issues with executing arbitrary JS in crafted PDFs via `eval`. Consider replacing with a maintained alternative.

### 10c. Unused `puppeteer` dependency
Listed in `server/package.json` but not imported anywhere. 300MB+ dependency that downloads Chromium. Should be removed.

---

## Priority Fix Order

1. **Critical:** Shell injection in `search_files` — use `execFileSync` with argument arrays
2. **High:** XSS — install DOMPurify, sanitize all markdown output
3. **High:** Auth — bind to `127.0.0.1` at minimum; add bearer token for Tailscale
4. **Medium:** CORS — restrict to known origins
5. **Medium:** Path traversal — `path.resolve()` + prefix check after resolution
6. **Medium:** Electron `executeJavaScript` — validate UUID format
7. **Low:** Remove unused `puppeteer`, evaluate `pdf-parse` replacement
