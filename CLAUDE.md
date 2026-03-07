# Idea Basin

Knowledge management app with AI-powered file classification, semantic search, and hierarchical node organization.

## Stack
- **Client:** React + Vite (`client/`), dev server proxies to backend
- **Server:** Node.js + Express (`server/`), port 3500
- **Database:** PostgreSQL + pgvector at `postgresql://localhost:5432/idea_basin`
- **Desktop:** Electron wrapper (`electron/`)

## Running
```bash
# Server (with auto-reload)
cd server && npm run dev

# Client (Vite dev server)
cd client && npm run dev

# Full Electron app
npm run dev  # from project root
```

## AI Provider System
Each AI feature is independently configurable via Settings (gear icon) or `server/data/config.json`:
- **Scan** (file classification): embedded / ollama / claude / openai
- **Embedding** (vector search): embedded (384-dim) / ollama (768-dim)
- **Tagging** (tags + summaries): disabled / ollama / claude / openai

Default is all-embedded (zero-config, offline). Provider logic lives in `server/services/ai-provider.js`.

## Database Schema
- `nodes` — hierarchical basins (parent_id tree)
- `resources` — belong to nodes, store content/URLs
- `chunks` — RAG retrieval, dual embedding columns:
  - `embedding vector(768)` for Ollama
  - `embedding_384 vector(384)` for embedded model
- `tags` / `resource_tags` — AI-generated content tags
- `cross_refs` — relationships between nodes (auto-detected from shared tags)

## Well-Known Nodes
These nodes have hardcoded UUIDs and are auto-created on startup (`ensureArtifactsNode()` / `ensureWhatsAppNode()` in `server/index.js`):
- **Root:** `00000000-0000-0000-0000-000000000001` — "Idea Basin", top of the tree
- **Artifacts:** `00000000-0000-0000-0000-000000000080` — stores chat-generated artifacts (referenced in `server/services/chat-tools.js` and `server/index.js`)
- **WhatsApp Captures:** `00000000-0000-0000-0000-000000000090` — stores resources captured via the WhatsApp bot (referenced in `server/services/whatsapp-bot.js` and `server/index.js`)

User-created nodes are dynamic. To see the current node tree, query `curl localhost:3500/api/nodes/root` (returns root with 2 levels of children) or browse in the UI.

## Key Conventions
- API keys are encrypted in browser localStorage (`crypto-manager.js`), never stored server-side
- Cloud API keys passed per-request via `x-api-key` header
- Server config at `server/data/config.json`, read/written by `server/services/config.js`
- Embedded model cached in `server/data/models/`
- All routes under `/api/` — config, nodes, resources, search, scan, crossrefs

## Mobile Access via Tailscale

The app is designed to work on mobile browsers over Tailscale (private mesh VPN). This avoids exposing the server to the public internet.

### Setup
1. Install Tailscale on both your Mac and phone — https://tailscale.com
2. Both devices join the same tailnet (same account)
3. Start the server on your Mac: `cd server && npm run dev`
4. On your phone's browser, navigate to `http://<mac-tailscale-ip>:3500`
   - Find your Mac's Tailscale IP: `tailscale ip -4` or check the Tailscale admin console
   - It will be a `100.x.y.z` address

### Why Tailscale
- **No port forwarding** — Tailscale creates a private WireGuard tunnel, nothing is exposed to the internet
- **No HTTPS needed** — traffic is encrypted end-to-end by WireGuard, so HTTP over Tailscale is secure
- **Works anywhere** — phone and Mac don't need to be on the same WiFi
- **Zero config firewall** — only your devices on your tailnet can reach the server

### Notes
- The Vite dev server (client) runs on a different port — for mobile, either build the client (`cd client && npm run build`) and serve it from Express, or proxy through Vite with `--host 0.0.0.0`
- For quickest mobile access: build the client, then serve everything from Express on port 3500
- API keys saved in localStorage are per-browser — you'll need to re-enter them on your phone's browser

## WhatsApp Bot

A Baileys-based WhatsApp bot that connects to a group chat and integrates with Idea Basin. Configured via Settings UI or `server/data/config.json` (`whatsapp` key).

### Key Files
- `server/services/whatsapp-bot.js` — bot logic, message handling, media download
- `server/services/gemini-client.js` — Gemini text + vision (`generate()`, `describeImage()`)
- `server/routes/whatsapp.js` — API: `/api/whatsapp/status`, `connect`, `disconnect`, `select-group`, `refresh-groups`

### Capabilities
- **AI chat:** `@<alias>` mention (e.g. `@claude`, `@qwen`, `@gemini`) → AI response with RAG context from knowledge base. Aliases are fully configurable in Settings.
- **URL capture:** Sharing a URL auto-summarizes it (uses `defaultProvider` alias) and saves to "WhatsApp Captures" node (UUID `...0090`), then offers placement into other basins
- **`@save <text>`:** Saves free-text as a searchable `note` resource in WhatsApp Captures
- **Image + caption:** Downloads image via Baileys `downloadMediaMessage`, saves to `server/uploads/<node-id>/`, gets AI description from Gemini Vision, creates a `file` resource. Images without captions are silently ignored.

### Architecture
- Uses Baileys v7 `ev.process()` pattern for all event handling
- Auth state persisted in `server/data/whatsapp-auth/`
- `sentByBot` map prevents self-reply loops
- Rate limiting: 10 requests/sender/minute
- Placement flow: bot replies with numbered node list, user replies with number to move resource
- Resources created via `createResource()` from `db/queries.js`, ingested via `workers/ingest.js` for chunking + embedding

### Config (`whatsapp` section)
- `enabled` — bot on/off
- `groupJid` — target WhatsApp group (full mode: capture, commands, AI chat)
- `chatGroupJid` — chat-only group (AI chat only, no capture/commands)
- `aliases` — array of `{ tag, provider, model }` objects. Empty = defaults (`@claude`/`@gemini`/`@grok`)
- `defaultProvider` — alias tag or provider used for URL auto-routing when no @mention
- API keys: `geminiApiKey`, `grokApiKey`, `claudeApiKey`, `openaiApiKey`, `deepseekApiKey`, `kimiApiKey`, `qwenApiKey` — synced from browser crypto-manager on group activation
- Supported providers: `claude-cli` (CLI, no key), `claude` (Anthropic API), `gemini`, `grok`, `ollama` (local), `openai`, `deepseek`, `kimi`, `qwen` (all via OpenAI-compatible API)

### Group Modes
The bot supports three WhatsApp groups simultaneously, each with different command sets:
- **Full** (`groupJid`): All commands — `@save`, `@basin`, `@subbasin`, `/basins`, `/morning`, URL capture, image capture, AI chat
- **Chat** (`chatGroupJid`): AI chat only — `@alias` mentions, no capture or management commands


## Querying the Live App

The server is typically running on port 3500. **Before working on features that involve nodes, resources, or the knowledge base, query the API to understand the current state.** Don't assume you know what nodes or data exist — always check.

### Useful Endpoints
```bash
# Server health + config
curl localhost:3500/api/health
curl localhost:3500/api/config
curl localhost:3500/api/config/status

# Node tree (root + 2 levels of children with resource counts)
curl localhost:3500/api/nodes/root

# Single node with full children + resources
curl localhost:3500/api/nodes/<node-id>

# Search the knowledge base (semantic search across all chunks)
curl 'localhost:3500/api/search?q=your+query'

# Resources for a specific node
curl localhost:3500/api/resources?node_id=<node-id>

# WhatsApp bot status
curl localhost:3500/api/whatsapp/status
```

Use `curl localhost:3500/api/nodes/root` as your starting point to discover the full node tree and understand what the user has organized.
