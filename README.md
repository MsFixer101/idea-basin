# Idea Basin

A desktop knowledge management app that organises ideas, research, and resources into a visual graph — not a file system.

## What It Is

A **mind map with memory**. You navigate a tree of "basins" (topic nodes), each containing resources (links, files, notes, code) and sub-basins. The graph in the centre shows spatial relationships; the side panel shows detail and context. Resources can live in multiple basins simultaneously — those cross-references *are* the insight.

**Core principle:** Connections are data. Redundancy is signal. A paper appearing in three basins means the user recognises it bridges three domains. That's knowledge, not mess.

## Stack

- **Desktop:** Electron (native file drag-and-drop, local file access)
- **Frontend:** React 18 + Vite, D3.js force-directed graph, inline JS styling
- **Backend:** Node.js + Express (port 3500), REST API + streaming chat with tool use
- **Database:** PostgreSQL + pgvector — hierarchical nodes, resources, dual-embedding RAG chunks (384-dim embedded / 768-dim Ollama), AI-generated tags, cross-references
- **AI:** Configurable per-feature — embedded offline model (bge-micro-v2), Ollama, Claude API, OpenAI API. Keys encrypted in browser localStorage, never stored server-side
- **Mobile:** Tailscale private mesh VPN — no port forwarding or HTTPS needed

## WhatsApp Integration

A Baileys-based bot connects to a WhatsApp group, turning it into a collaborative capture and query interface for the knowledge base.

- **AI chat:** `@gemini`, `@grok`, `@claude`, `@kimi` + question — responds with RAG context from the knowledge base
- **URL capture:** Share a link — auto-summarised and saved, with basin placement flow
- **Notes:** `@save <text>` — saves searchable notes
- **Images:** Send an image with a caption — saved with Gemini Vision description
- **Basin management:** `@basin <name>` creates top-level basins, `@subbasin <parent> > <name>` nests them, `/basins` and `/subbasins` list the tree
- **Multi-provider:** Configurable aliases per AI (Gemini, Grok, Claude, Kimi, Ollama, OpenAI, DeepSeek, Qwen) with independent model selection

## Roadmap

**Daily Briefing** — A scheduled morning digest (7am push via WhatsApp) summarising new captures, recent activity across basins, and AI-surfaced connections.

---

## Quick Start

```bash
# Start the server (serves API + built client on port 3500)
cd server && node index.js

# If you need to rebuild the client after changes:
cd client && npm run build
```

Open `http://localhost:3500` in your browser. For mobile access via Tailscale, see the [Mobile Access](#mobile-access) section.

---

## The Graph

The main view is a force-directed graph showing nodes as circles. The root node ("Idea Basin") contains top-level project nodes (Projects, Research, Ideas, etc.). Each node can contain child nodes and resources.

**Navigating:**
- **Click a circle** to select it — opens the side panel with details and resources
- **Double-click** to drill down into that node (makes it the new center)
- **Expand arrow** on a node reveals its children inline without drilling down (up to 3 levels deep)
- **Breadcrumb** at the top shows your current path — click any segment to jump back
- **Up button** (bottom-left) goes up one level

**Visual cues:**
- Circle size reflects child count
- Small dots on circles indicate resource types (color-coded)
- Connected lines show parent-child relationships

---

## The Chat (Primary Workflow)

The chat button (bottom-left, purple sparkle icon) opens a Claude-powered assistant that can both answer questions AND take actions in the basin.

### What the chat can do

| Command | What happens |
|---------|-------------|
| "List my nodes" | Shows full knowledge base structure |
| "Search for machine learning" | Semantic search across all chunked content |
| "Create a node under Research called X" | Creates a new sub-basin |
| "Save this as a resource" + pasted text | Writes a .md file to disk, adds it as a resource, chunks and embeds it |
| "What do I have about compression?" | Searches the knowledge base and summarises findings |
| "Open the file at /Users/..." | Opens a local file in the default app |

### The main use case: paste and save

This is the fastest way to get content into the basin:

1. Open the chat
2. Paste your text (artifact, research notes, code, anything)
3. Tell Claude what to do with it:
   - *"Create a sub-basin under Research called Interpretability, and save this artifact there"*
   - *"Add this to the Research node as a research note"*
   - *"Save this as Mechanistic-Interpretability-Notes under Research"*

Claude will:
- Create the node if needed (`create_node`)
- Write the content as a `.md` file to `~/idea-basin-artifacts/<node-name>/` (`save_resource`)
- Add it as a resource linked to the node
- Trigger ingestion (chunking + embedding) so it becomes searchable

### Paste file paths

You can paste local file paths directly:

- **In the side panel:** Paste a file path (e.g. `/Users/you/docs/SPEC.md`) — the file is imported as a resource, content is read and embedded for search. Images are copied to uploads.
- **In the chat:** Paste a file path — it appears as an attachment chip. When you send your message, the AI sees the full file content and can discuss it.
- **Multiple paths:** Paste multiple paths (one per line) — all are imported.

### Chat tools reference

The chat has access to these tools:
- `search_knowledge` — semantic search across all embedded content
- `list_nodes` — show all nodes with resource counts
- `get_node` — get details about a specific node
- `create_node` — create a new node under a parent
- `add_resource` — add a quick note/link (content stays in DB only)
- `save_resource` — save content as a .md file on disk AND add as resource (use this for anything substantial)
- `read_file` — read a local file
- `open_file` — open a file in the default app

**Tip:** Use `save_resource` (not `add_resource`) when pasting text you want to keep as a readable file. Just say "save this" and Claude will use the right tool.

---

## Adding Content (Without Chat)

### Via the UI

1. **Select a node** by clicking its circle in the graph
2. The side panel shows the node's resources
3. Click **"+ Add resource"** at the bottom of the panel
4. Choose a mode:
   - **URL** — paste a link. If you paste plain text here instead, it auto-detects and saves it as a research note
   - **File Path** — point to a local file (e.g. `/Users/you/research/paper.pdf`)
   - **Note / Idea** — dump raw text directly
5. Click **"Pour it in"**

### Via Scan

The Scan feature classifies files from a directory into your existing nodes.

1. Click **Scan** in the top bar
2. Enter a directory path (e.g. `/Users/you/research/`)
3. The scanner reads files and matches them to nodes using AI (embedded cosine similarity by default, or LLM classification if configured)
4. Review suggestions — each file shows its suggested node and confidence
5. Select files to ingest and click **Ingest**
6. After ingestion, if 3+ files land in the same node, auto-grouping kicks in and suggests sub-basins

---

## Nodes

Nodes are the organisational containers — think of them as basins that hold related resources.

**Creating nodes:**
- Click **"+ Node"** in the top bar to add a child of the current view
- Or use **"+ Add sub-basin"** in the side panel to add a child of the selected node
- Or tell the chat: *"Create a node under Projects called API Redesign"*

**Each node has:**
- A label and optional description
- A color (for the graph circle)
- A "why" field (why does this matter?)
- Child nodes (sub-basins)
- Resources (files, notes, links, code)

---

## Sub-Basin Auto-Grouping

When a node accumulates many resources (3+), you can ask Claude to suggest topical sub-basins.

1. Select a node with 3+ resources
2. Click **"Suggest sub-basins"** (cyan button in the side panel)
3. Claude analyses the resources and proposes groups (e.g. "7 Chatterbox files could be grouped under Chatterbox TTS Integration")
4. Review the suggestions — each shows the group name, description, and which resources would move
5. Toggle groups on/off with checkboxes
6. Click **"Create N sub-basins"** to apply

This also detects cross-references between groups that share themes.

---

## Search

Semantic search is available via:
- The chat: *"Search for information about memory architectures"*
- The API: `GET /api/search?q=memory+architectures&limit=5`

Search works by embedding your query and finding the closest chunks in the vector database. Results include the matching content, similarity score, source node, and resource metadata.

**Embedding providers:**
- **Embedded** (default): 384-dim vectors via bge-micro-v2, works offline
- **Ollama**: 768-dim vectors via nomic-embed-text, requires Ollama running

See `readme_ai.md` for full AI provider configuration.

---

## Cross-References

Cross-references link nodes that share themes. They're created:
- Automatically during sub-basin grouping (Claude identifies shared themes)
- Automatically from shared tags between nodes (when tagging is enabled)
- Via the API: `POST /api/crossrefs` with `source_node_id`, `target_node_id`, and `reason`

View suggested cross-references: `GET /api/crossrefs/suggested`

---

## Settings

Click the gear icon in the top bar. Settings covers:

- **AI Providers** — configure scan, embedding, and tagging providers independently
- **Ollama** — connection status and available models
- **Embedded Model** — cache status and model info
- **Claude CLI** — availability check (used by Chat and Sub-basin Grouping)
- **API Keys** — encrypted in browser localStorage, never stored on the server
- **WhatsApp Bot** — connect/disconnect, select group, configure AI aliases

---

## Mobile Access

The app works on mobile browsers via [Tailscale](https://tailscale.com) (private mesh VPN).

### Setup

1. Install Tailscale on your Mac and phone
2. Sign in with the same account on both
3. Start the server: `cd server && node index.js`
4. Find your Mac's Tailscale IP: `tailscale ip -4` (returns a `100.x.y.z` address)
5. On your phone: `http://100.x.y.z:3500`

### Why Tailscale

- Works anywhere (not just home WiFi)
- Encrypted end-to-end (HTTP is fine over Tailscale)
- No port forwarding or public exposure
- Only your devices can access it

### Using Idea Basin on mobile

The primary workflow on mobile is through the **chat**. Tap the purple sparkle button (bottom-right on mobile) to open it.

**Saving content from claude.ai (or any source):**

1. On your phone, copy the text you want to save (e.g. an artifact from claude.ai)
2. Open Idea Basin in your browser (`http://100.x.y.z:3500`)
3. Tap the chat button (purple sparkle, bottom-right)
4. Paste your text into the chat box and tell Claude what to do with it:
   - *"Create a sub-basin under Research called Interpretability and save this"*
   - *"Add this to the Research node"*
5. Claude creates the node, writes a .md file to your Mac's disk, adds it as a resource, and chunks it for search

The chat input is a multi-line text area — it handles large pasted content.

**Navigating on mobile:**

- The graph fills the screen. Tap a circle to open the node panel (covers full width)
- Tap **"Back to graph"** at the top of the panel to return to the graph view
- The breadcrumb at the top still works for jumping between levels
- Buttons in the top bar stack to fit the mobile width

**Adding content via the UI on mobile:**

1. Tap a node circle to open its panel
2. Tap **"+ Add resource"**
3. Switch to the **"Note / Idea"** tab for pasting text, or stay on **"URL"** for links
4. If you paste plain text into the URL field by accident, it auto-detects and saves it as a research note

### Mobile notes

- Build the client first (`cd client && npm run build`) — mobile serves the built files from Express
- API keys are per-browser — re-enter them on your phone
- File paths in Scan reference your Mac's filesystem
- Inputs use 16px font to prevent iOS Safari auto-zoom

---

## File Layout

```
idea-basin/
  client/                 # React + Vite frontend
    src/
      components/         # Graph, NodePanel, ChatDrawer, ScanModal, etc.
      hooks/              # useApi, useChat, useMobile
      styles/             # theme.js (colors, resource types)
    dist/                 # Built client (served by Express)
  server/
    index.js              # Express server entry point
    db/                   # PostgreSQL pool + queries
    routes/               # API routes (nodes, resources, search, chat, scan, config, crossrefs)
    services/             # AI providers, embedder, scanner, tagger, claude-cli, whatsapp-bot
    data/                 # config.json, cached models, whatsapp-auth
  electron/               # Desktop wrapper
  idea-basin-artifacts/   # Saved .md files from chat (~/idea-basin-artifacts/)
```

---

## Troubleshooting

**Chat text turns red**
- Red text = an error from Claude CLI. Usually means the server needs a restart, or Claude CLI timed out on a very large prompt.
- Fix: restart the server (`kill $(lsof -ti:3500); cd server && node index.js`)

**Server not picking up changes**
- The running server doesn't hot-reload route changes. Kill and restart it.

**Mobile: input zooms in and locks**
- Already fixed: inputs use 16px font on mobile and viewport is locked to prevent iOS auto-zoom.

**Search returns nothing**
- Content needs to be ingested (chunked + embedded) first. Check resource status — it should say "ingested", not "pending".
- If you switched embedding providers, existing chunks may be in the other dimension column.

**Scan returns low confidence matches**
- Add more descriptive text to node descriptions and "why" fields. The embedded classifier matches file content against node descriptions using cosine similarity.

See `readme_ai.md` for AI provider setup and configuration details.
