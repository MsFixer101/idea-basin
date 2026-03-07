# Security Hardening Report

**Date:** 2026-03-07
**Context:** Pre-release security review for public GitHub publication

---

## Summary

A comprehensive security review was performed prior to open-sourcing. All critical and high-severity issues from the [initial audit](security-audit_2026-02-10.md) have been addressed.

| Severity | Original Count | Fixed | Remaining |
|----------|---------------|-------|-----------|
| Critical | 1 | 1 | 0 |
| High | 5 | 5 | 0 |
| Medium | 7 | 5 | 2 |
| Low | 6 | 1 | 5 |

---

## Fixes Applied

### Critical

**1a. Shell injection in `search_files` via `execSync`** — FIXED
- `execSync()` with string interpolation replaced with `execFileSync()` using argument arrays
- No user input is ever passed through a shell interpreter

### High

**1b. Shell command construction in `claude-cli.js`** — FIXED
- Rewrote to use `execFile()` with argument arrays and `--system-prompt-file` flag
- Prompt sent via stdin instead of shell pipe with `cat`

**3a. XSS via unsanitized markdown rendering** — FIXED
- Added `dompurify` dependency to client
- All `marked.parse()` output now sanitized through `DOMPurify.sanitize()`

**3b. Popout window renders arbitrary HTML** — MITIGATED
- Content is now sanitized at the `renderMarkdown()` level before reaching the popout window

**4a. No authentication on any endpoint** — MITIGATED
- CORS restricted to localhost and Tailscale IPs (`100.x.x.x`)
- App is designed for local/private network use; documented in SECURITY.md
- Full auth is out of scope for a local-first tool, but CORS prevents drive-by attacks from malicious websites

**11a. Prompt injection can trigger powerful tool calls** — MITIGATED
- Path traversal fixed in `read_file` and `open_file` (see 2a below)
- Shell injection fixed (see 1a, 1b above)
- SSRF blocked in `fetch_url` (see 5a below)
- Residual risk: AI tool calls are inherent to the architecture; documented in SECURITY.md

### Medium

**1c. JS injection via `executeJavaScript` in Electron** — FIXED
- `nodeId` validated against UUID regex before interpolation

**2a. Path traversal in `read_file` / `open_file`** — FIXED
- Both tools now use `path.resolve()` before checking the `/Users/` prefix
- `../` sequences are resolved before validation, preventing traversal

**5a. `fetch_url` is an open SSRF proxy** — FIXED
- Added blocklist for private/reserved IP ranges: `localhost`, `127.0.0.1`, `::1`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.169.254`, `metadata.google.internal`
- URL scheme validated to require `http://` or `https://` (not just `http` prefix)

**6a. CORS allows all origins** — FIXED
- Restricted to `localhost`, `127.0.0.1`, and Tailscale IPs (`100.x.x.x`)

**2a (search_files). Path traversal in directory arg** — FIXED
- `path.resolve()` applied before prefix check

### Remaining (accepted risk for local-first app)

**6b. No CSRF protection** — Accepted
- Mitigated by CORS restrictions; tokens would add complexity without meaningful security gain for a local app

**8a. Column name interpolation in SQL** — Accepted
- Only produces `'embedding_384'` or `'embedding'` from internal logic; not user-controlled

### Low (unchanged)

Low-severity items (scan path restriction, upload subdirectory validation, Ollama URL config, API key prefix logging, UUID validation on routes) remain as-is. These are defense-in-depth concerns appropriate for a local-first app that are not exploitable under normal usage.

---

## Other Hardening

| Change | Details |
|--------|---------|
| Hardcoded paths removed | Hardcoded user paths replaced with `os.homedir()` + `ARTIFACTS_DIR` env var |
| Python path portable | Hardcoded `/opt/homebrew/bin/python3.11` replaced with `PYTHON_PATH` env var (defaults to `python3`) |
| `.gitignore` expanded | Added `whatsapp-auth/`, `briefing-seen.json`, `Idea Basin.app/`, `*.log` |
| LICENSE added | MIT License |
| SECURITY.md added | Vulnerability disclosure policy |
| CONTRIBUTING.md added | Setup and contribution guide |

---

## Dependency Notes

- **`pdf-parse` v1.1.1** — Unmaintained (last release 2018). Known `eval` issues with crafted PDFs. Consider replacing with a maintained alternative.
- **`puppeteer`** — Listed in server/package.json but appears unused. 300MB+ dependency. Should be removed.
- **`dompurify`** — Added as XSS sanitizer for markdown rendering.

---

## Architecture Note

Idea Basin is designed as a **local-first application**. It runs on your machine or over a private network (Tailscale). It is **not intended for public internet deployment** without additional hardening (authentication, rate limiting, HTTPS).
