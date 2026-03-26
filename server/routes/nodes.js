import { Router } from 'express';
import * as db from '../db/queries.js';

const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL || 'http://localhost:4000';
async function callModelService(prompt, system) {
  const resp = await fetch(`${MODEL_SERVICE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-cli-sonnet',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Model service error: ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateId(req, res, next) {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid node ID format' });
  }
  next();
}

// GET /api/nodes/recent — get most recent resources across all nodes
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const resources = await db.getRecentResources(Math.min(limit, 50));
    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/root — get root node (3 levels deep)
router.get('/root', async (req, res) => {
  try {
    const root = await db.getRootNode();
    if (!root) return res.status(404).json({ error: 'No root node found' });
    const data = await db.getNodeDeep(root.id, 3);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id/deep — get node with 3 levels of children
router.get('/:id/deep', validateId, async (req, res) => {
  try {
    const data = await db.getNodeDeep(req.params.id, 3);
    if (!data) return res.status(404).json({ error: 'Node not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id — get node with children
router.get('/:id', validateId, async (req, res) => {
  try {
    const data = await db.getNodeWithChildren(req.params.id);
    if (!data) return res.status(404).json({ error: 'Node not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id/tree — get breadcrumb path
router.get('/:id/tree', validateId, async (req, res) => {
  try {
    const path = await db.getNodeTree(req.params.id);
    res.json(path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id/resources — get resources for a node
router.get('/:id/resources', validateId, async (req, res) => {
  try {
    const resources = await db.getResourcesForNode(req.params.id);
    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id/also-in — get "also in" data for resources
router.get('/:id/also-in', validateId, async (req, res) => {
  try {
    const rows = await db.getAlsoInForResources(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id/crossrefs — get cross-references
router.get('/:id/crossrefs', validateId, async (req, res) => {
  try {
    const refs = await db.getCrossRefs(req.params.id);
    res.json(refs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nodes/:id/suggest-groups — AI-powered sub-basin suggestions
router.post('/:id/suggest-groups', validateId, async (req, res) => {
  try {
    const resources = await db.getResourcesForNode(req.params.id);
    if (resources.length < 3) {
      return res.status(400).json({ error: 'Need at least 3 resources to suggest groups' });
    }

    // Build compact summaries (max 50)
    const summaries = resources.slice(0, 50).map(r => ({
      id: r.id,
      name: r.url ? r.url.split('/').pop() : r.description?.slice(0, 60) || 'untitled',
      description: (r.description || '').slice(0, 120),
      tags: r.tags || [],
      why: (r.why || '').slice(0, 80),
    }));

    const systemPrompt = `You are a knowledge organizer. Given resources in a knowledge basin, identify topical clusters that should become sub-basins, and connections between those clusters.

Rules:
- 3+ resources per group, max 10 groups.
- Each resource in exactly 1 group (resources that don't fit any group are left ungrouped).
- Short label (2-4 words), one-sentence description per group.
- Also identify cross-references: thematic links between groups where ideas overlap.
- Return ONLY valid JSON. No explanation, no markdown fences.

Format:
{
  "groups": [{ "label": "...", "description": "...", "resource_ids": ["uuid", ...] }],
  "cross_refs": [{ "from": "Group Label A", "to": "Group Label B", "reason": "shared theme" }]
}
If no meaningful groups exist, return { "groups": [], "cross_refs": [] }`;

    const prompt = `Here are the resources in this basin:\n\n${JSON.stringify(summaries, null, 2)}\n\nIdentify topical clusters.`;

    const raw = await callModelService(prompt, systemPrompt);

    // Parse JSON from response (strip any markdown fences)
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(502).json({ error: 'Failed to parse AI response', raw: jsonStr.slice(0, 500) });
    }

    // Validate: only real resource IDs, 3+ per group
    const validIds = new Set(resources.map(r => r.id));
    const groups = (parsed.groups || [])
      .map(g => ({
        ...g,
        resource_ids: (g.resource_ids || []).filter(id => validIds.has(id)),
      }))
      .filter(g => g.resource_ids.length >= 3);

    // Enrich groups with resource details
    const resourceMap = Object.fromEntries(resources.map(r => [r.id, r]));
    for (const g of groups) {
      g.resources = g.resource_ids.map(id => ({
        id,
        name: resourceMap[id]?.url?.split('/').pop() || resourceMap[id]?.description?.slice(0, 60) || 'untitled',
      }));
    }

    res.json({ groups, cross_refs: parsed.cross_refs || [] });
  } catch (err) {
    console.error('suggest-groups error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nodes/:id/apply-groups — create sub-basins and move resources
router.post('/:id/apply-groups', validateId, async (req, res) => {
  try {
    const { groups, cross_refs } = req.body;
    if (!groups || !Array.isArray(groups)) {
      return res.status(400).json({ error: 'groups array required' });
    }

    const parentId = req.params.id;
    const results = [];
    const labelToNodeId = {};

    for (const group of groups) {
      try {
        // Create sub-basin node
        const node = await db.createNode({
          parent_id: parentId,
          label: group.label,
          description: group.description,
        });
        labelToNodeId[group.label] = node.id;

        // Move resources into the new node
        let moved = 0;
        for (const rid of (group.resource_ids || [])) {
          try {
            await db.updateResource(rid, { node_id: node.id });
            moved++;
          } catch { /* skip invalid resource */ }
        }

        results.push({ label: group.label, node_id: node.id, status: 'created', moved });
      } catch (err) {
        results.push({ label: group.label, status: 'error', error: err.message });
      }
    }

    // Create cross-references between newly created nodes
    let crossRefsCreated = 0;
    if (cross_refs && Array.isArray(cross_refs)) {
      for (const ref of cross_refs) {
        const sourceId = labelToNodeId[ref.from];
        const targetId = labelToNodeId[ref.to];
        if (sourceId && targetId) {
          try {
            await db.createCrossRef({
              source_node_id: sourceId,
              target_node_id: targetId,
              reason: ref.reason,
              auto_detected: true,
            });
            crossRefsCreated++;
          } catch { /* skip duplicate or invalid */ }
        }
      }
    }

    res.json({ results, cross_refs_created: crossRefsCreated });
  } catch (err) {
    console.error('apply-groups error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nodes — create node
router.post('/', async (req, res) => {
  try {
    const { parent_id, label, description, why, color } = req.body;
    if (!parent_id || !label) return res.status(400).json({ error: 'parent_id and label required' });
    const node = await db.createNode({ parent_id, label, description, why, color });
    res.status(201).json(node);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/nodes/:id — update node
router.patch('/:id', validateId, async (req, res) => {
  try {
    const node = await db.updateNode(req.params.id, req.body);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    res.json(node);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nodes/:id/merge — merge source node into target
router.post('/:id/merge', validateId, async (req, res) => {
  try {
    const { target_id } = req.body;
    if (!target_id) return res.status(400).json({ error: 'target_id required' });
    if (!UUID_RE.test(target_id)) return res.status(400).json({ error: 'Invalid target_id format' });
    if (req.params.id === target_id) return res.status(400).json({ error: 'Cannot merge a node into itself' });
    const result = await db.mergeNodes(req.params.id, target_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/nodes/:id — delete node (reparents children to parent by default)
router.delete('/:id', validateId, async (req, res) => {
  try {
    const cascade = req.query.cascade === 'true';
    await db.deleteNode(req.params.id, { reparent: !cascade });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
