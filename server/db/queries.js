import pool from './pool.js';

// ── Nodes ───────────────────────────────────────────────────────────────

export async function getNode(id) {
  const { rows } = await pool.query('SELECT * FROM nodes WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getNodeWithChildren(id) {
  const node = await getNode(id);
  if (!node) return null;

  const { rows: children } = await pool.query(
    `SELECT n.*,
       (SELECT count(*) FROM nodes c WHERE c.parent_id = n.id) as child_count,
       (SELECT count(*) FROM resources r WHERE r.node_id = n.id) as resource_count
     FROM nodes n WHERE n.parent_id = $1 ORDER BY n.sort_order, n.created_at`,
    [id]
  );

  return { ...node, children };
}

// 3-level deep hierarchy for graph view
export async function getNodeDeep(id, depth = 3) {
  const node = await getNode(id);
  if (!node) return null;

  // Get resource type counts for this node
  const { rows: typeCounts } = await pool.query(
    `SELECT type, count(*)::int as count FROM resources WHERE node_id = $1 GROUP BY type`,
    [id]
  );

  async function loadChildren(parentId, currentDepth) {
    if (currentDepth >= depth) return [];

    const { rows: children } = await pool.query(
      `SELECT n.*,
         (SELECT count(*)::int FROM nodes c WHERE c.parent_id = n.id) as child_count,
         (SELECT count(*)::int FROM resources r WHERE r.node_id = n.id) as resource_count
       FROM nodes n WHERE n.parent_id = $1 ORDER BY n.sort_order, n.created_at`,
      [parentId]
    );

    for (const child of children) {
      // Get resource type counts
      const { rows: childTypes } = await pool.query(
        `SELECT type, count(*)::int as count FROM resources WHERE node_id = $1 GROUP BY type`,
        [child.id]
      );
      child.resource_types = childTypes;
      child.children = await loadChildren(child.id, currentDepth + 1);
    }

    return children;
  }

  node.resource_types = typeCounts;
  node.children = await loadChildren(id, 0);
  return node;
}

export async function getNodeTree(id, path = []) {
  const node = await getNode(id);
  if (!node) return path;
  const result = [...path, { id: node.id, label: node.label }];
  if (node.parent_id) return getNodeTree(node.parent_id, result);
  return result.reverse();
}

export async function getRootNode() {
  const { rows } = await pool.query('SELECT * FROM nodes WHERE parent_id IS NULL LIMIT 1');
  return rows[0] || null;
}

export async function createNode({ parent_id, label, description, why, color }) {
  const { rows } = await pool.query(
    `INSERT INTO nodes (parent_id, label, description, why, color)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [parent_id, label, description || null, why || null, color || '#c084fc']
  );
  return rows[0];
}

export async function updateNode(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (['label', 'description', 'why', 'color', 'parent_id', 'sort_order', 'private'].includes(key)) {
      const col = key === 'private' ? '"private"' : key;
      sets.push(`${col} = $${i++}`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return getNode(id);
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE nodes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0];
}

export async function deleteNode(id, { reparent = true } = {}) {
  const node = await getNode(id);
  if (!node) return;
  if (!node.parent_id) throw new Error('Cannot delete root node');

  if (reparent) {
    // Move children up to parent
    await pool.query('UPDATE nodes SET parent_id = $1 WHERE parent_id = $2', [node.parent_id, id]);
    // Move resources up to parent
    await pool.query('UPDATE resources SET node_id = $1 WHERE node_id = $2', [node.parent_id, id]);
  } else {
    // Cascade: delete resources (chunks cascade via FK), then child nodes recursively
    await pool.query('DELETE FROM chunks WHERE resource_id IN (SELECT id FROM resources WHERE node_id = $1)', [id]);
    await pool.query('DELETE FROM resources WHERE node_id = $1', [id]);
    // Recursive delete children
    const { rows: children } = await pool.query('SELECT id FROM nodes WHERE parent_id = $1', [id]);
    for (const child of children) {
      await deleteNode(child.id, { reparent: false });
    }
  }

  // Clean up cross-refs
  await pool.query('DELETE FROM cross_refs WHERE source_node_id = $1 OR target_node_id = $1', [id]);
  await pool.query('DELETE FROM nodes WHERE id = $1', [id]);
}

export async function mergeNodes(sourceId, targetId) {
  const source = await getNode(sourceId);
  const target = await getNode(targetId);
  if (!source || !target) throw new Error('Source or target node not found');
  if (sourceId === targetId) throw new Error('Cannot merge a node into itself');

  // Move all children from source to target
  await pool.query('UPDATE nodes SET parent_id = $1 WHERE parent_id = $2', [targetId, sourceId]);
  // Move all resources from source to target
  await pool.query('UPDATE resources SET node_id = $1 WHERE node_id = $2', [targetId, sourceId]);
  // Move cross-refs
  await pool.query(
    'UPDATE cross_refs SET source_node_id = $1 WHERE source_node_id = $2 AND target_node_id != $1',
    [targetId, sourceId]
  );
  await pool.query(
    'UPDATE cross_refs SET target_node_id = $1 WHERE target_node_id = $2 AND source_node_id != $1',
    [targetId, sourceId]
  );
  // Delete orphaned cross-refs (self-refs after merge)
  await pool.query('DELETE FROM cross_refs WHERE source_node_id = target_node_id');
  // Delete the source node
  await pool.query('DELETE FROM nodes WHERE id = $1', [sourceId]);

  return target;
}

// ── Resources ───────────────────────────────────────────────────────────

export async function getResourcesForNode(nodeId) {
  const { rows: resources } = await pool.query(
    `SELECT r.*,
       COALESCE(
         (SELECT json_agg(t.name ORDER BY t.name) FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.resource_id = r.id),
         '[]'::json
       ) as tags
     FROM resources r WHERE r.node_id = $1 ORDER BY r.created_at DESC`,
    [nodeId]
  );
  return resources;
}

export async function getResource(id) {
  const { rows } = await pool.query(
    `SELECT r.*,
       COALESCE(
         (SELECT json_agg(t.name ORDER BY t.name) FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.resource_id = r.id),
         '[]'::json
       ) as tags
     FROM resources r WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function createResource({ node_id, url, type, why, description, content, status, thumbnail_url }) {
  const { rows } = await pool.query(
    `INSERT INTO resources (node_id, url, type, why, description, content, status, thumbnail_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [node_id, url || null, type, why || null, description || null, content || null, status || 'pending', thumbnail_url || null]
  );
  return rows[0];
}

export async function updateResource(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (['node_id', 'url', 'type', 'why', 'description', 'raw_content', 'content', 'status', 'thumbnail_url'].includes(key)) {
      sets.push(`${key} = $${i++}`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return getResource(id);
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE resources SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0];
}

export async function deleteResource(id) {
  await pool.query('DELETE FROM resources WHERE id = $1', [id]);
}

// ── Tags ────────────────────────────────────────────────────────────────

export async function setResourceTags(resourceId, tagNames) {
  await pool.query('DELETE FROM resource_tags WHERE resource_id = $1', [resourceId]);
  for (const name of tagNames) {
    const { rows } = await pool.query(
      `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [name.toLowerCase().trim()]
    );
    await pool.query(
      'INSERT INTO resource_tags (resource_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [resourceId, rows[0].id]
    );
  }
}

// ── Chunks ──────────────────────────────────────────────────────────────

export async function createChunk({ resource_id, content, embedding, chunk_index, token_count }) {
  const embStr = embedding ? `[${embedding.join(',')}]` : null;
  // Route to correct column based on vector dimension
  const is384 = embedding && embedding.length === 384;
  const { rows } = await pool.query(
    `INSERT INTO chunks (resource_id, content, embedding, embedding_384, chunk_index, token_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [resource_id, content, is384 ? null : embStr, is384 ? embStr : null, chunk_index, token_count || null]
  );
  return rows[0];
}

export async function searchChunks(embedding, limit = 10, nodeId = null) {
  const embStr = `[${embedding.join(',')}]`;
  // Pick the correct column based on query vector dimension
  const col = embedding.length === 384 ? 'embedding_384' : 'embedding';

  let query, params;
  if (nodeId) {
    query = `
      SELECT c.id, c.content, c.chunk_index,
        1 - (c.${col} <=> $1::vector) as similarity,
        r.id as resource_id, r.url, r.type, r.why, r.description as resource_description,
        n.id as node_id, n.label as node_label, n.color as node_color
      FROM chunks c
      JOIN resources r ON r.id = c.resource_id
      JOIN nodes n ON n.id = r.node_id
      WHERE c.${col} IS NOT NULL AND r.node_id = $3
      ORDER BY c.${col} <=> $1::vector
      LIMIT $2`;
    params = [embStr, limit, nodeId];
  } else {
    query = `
      SELECT c.id, c.content, c.chunk_index,
        1 - (c.${col} <=> $1::vector) as similarity,
        r.id as resource_id, r.url, r.type, r.why, r.description as resource_description,
        n.id as node_id, n.label as node_label, n.color as node_color
      FROM chunks c
      JOIN resources r ON r.id = c.resource_id
      JOIN nodes n ON n.id = r.node_id
      WHERE c.${col} IS NOT NULL
      ORDER by c.${col} <=> $1::vector
      LIMIT $2`;
    params = [embStr, limit];
  }
  const { rows } = await pool.query(query, params);
  return rows;
}

// ── Also-in (resources shared across nodes) ────────────────────────────

export async function getAlsoInForResources(nodeId) {
  const { rows } = await pool.query(
    `SELECT r.id as resource_id, n.id as other_node_id, n.label, n.color
     FROM resources r
     JOIN resources r2 ON r2.url = r.url AND r2.id != r.id
     JOIN nodes n ON n.id = r2.node_id
     WHERE r.node_id = $1 AND r.url IS NOT NULL AND r.url != '' AND r2.node_id != $1`,
    [nodeId]
  );
  return rows;
}

// ── Cross-refs ──────────────────────────────────────────────────────────

export async function getCrossRefs(nodeId) {
  const { rows } = await pool.query(
    `SELECT cr.*,
       sn.label as source_label, sn.color as source_color,
       tn.label as target_label, tn.color as target_color,
       (SELECT count(DISTINCT t.id)::int
        FROM resource_tags rt1
        JOIN resource_tags rt2 ON rt1.tag_id = rt2.tag_id
        JOIN resources res1 ON res1.id = rt1.resource_id
        JOIN resources res2 ON res2.id = rt2.resource_id
        JOIN tags t ON t.id = rt1.tag_id
        WHERE res1.node_id = cr.source_node_id AND res2.node_id = cr.target_node_id
       ) as shared_tag_count,
       (SELECT count(DISTINCT r1.url)::int
        FROM resources r1
        JOIN resources r2 ON r1.url = r2.url AND r1.id != r2.id
        WHERE r1.node_id = cr.source_node_id AND r2.node_id = cr.target_node_id
          AND r1.url IS NOT NULL AND r1.url != ''
       ) as shared_resource_count
     FROM cross_refs cr
     JOIN nodes sn ON sn.id = cr.source_node_id
     JOIN nodes tn ON tn.id = cr.target_node_id
     WHERE cr.source_node_id = $1 OR cr.target_node_id = $1
     ORDER BY cr.created_at DESC`,
    [nodeId]
  );
  return rows;
}

export async function deleteCrossRef(id) {
  await pool.query('DELETE FROM cross_refs WHERE id = $1', [id]);
}

export async function createCrossRef({ source_node_id, target_node_id, reason, auto_detected }) {
  const { rows } = await pool.query(
    `INSERT INTO cross_refs (source_node_id, target_node_id, reason, auto_detected)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [source_node_id, target_node_id, reason || null, auto_detected || false]
  );
  return rows[0];
}

// ── Recent resources ────────────────────────────────────────────────────

export async function getRecentResources(limit = 10) {
  const { rows } = await pool.query(
    `SELECT r.*,
       n.label as node_label, n.color as node_color,
       COALESCE(
         (SELECT json_agg(t.name ORDER BY t.name) FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.resource_id = r.id),
         '[]'::json
       ) as tags
     FROM resources r
     JOIN nodes n ON n.id = r.node_id
     ORDER BY r.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// ── Briefing queries ─────────────────────────────────────────────────

export async function getRecentActivity(hours = 24) {
  const { rows } = await pool.query(
    `SELECT r.id, r.type, r.url, r.description, r.created_at,
       n.id as node_id, n.label as node_label, n.color as node_color,
       COALESCE(
         (SELECT json_agg(t.name ORDER BY t.name) FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.resource_id = r.id),
         '[]'::json
       ) as tags
     FROM resources r
     JOIN nodes n ON n.id = r.node_id
     WHERE r.created_at > NOW() - make_interval(hours => $1)
       AND COALESCE(n.private, false) = false
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [hours]
  );
  return rows;
}

export async function getRecentCrossRefs(hours = 24) {
  const { rows } = await pool.query(
    `SELECT cr.id, cr.reason, cr.auto_detected, cr.created_at,
       sn.label as source_label, sn.color as source_color,
       tn.label as target_label, tn.color as target_color
     FROM cross_refs cr
     JOIN nodes sn ON sn.id = cr.source_node_id
     JOIN nodes tn ON tn.id = cr.target_node_id
     WHERE cr.created_at > NOW() - make_interval(hours => $1)
     ORDER BY cr.created_at DESC
     LIMIT 20`,
    [hours]
  );
  return rows;
}

export async function getActiveBasins(hours = 72) {
  const { rows } = await pool.query(
    `SELECT n.id, n.label, n.color, count(r.id)::int as recent_count
     FROM nodes n
     JOIN resources r ON r.node_id = n.id
     WHERE r.created_at > NOW() - make_interval(hours => $1)
       AND COALESCE(n.private, false) = false
     GROUP BY n.id, n.label, n.color
     ORDER BY recent_count DESC
     LIMIT 10`,
    [hours]
  );
  return rows;
}

export async function getKBStats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM nodes) as total_nodes,
      (SELECT count(*)::int FROM resources) as total_resources,
      (SELECT count(*)::int FROM cross_refs) as total_crossrefs,
      (SELECT count(*)::int FROM resources WHERE created_at > NOW() - interval '24 hours') as resources_24h,
      (SELECT count(*)::int FROM cross_refs WHERE created_at > NOW() - interval '24 hours') as crossrefs_24h
  `);
  return rows[0];
}

export async function getPrivateNodeIds() {
  const { rows } = await pool.query('SELECT id FROM nodes WHERE private = true');
  return new Set(rows.map(r => r.id));
}

export async function getSuggestedCrossRefs() {
  const { rows } = await pool.query(`
    SELECT DISTINCT r1.node_id as source_node_id, r2.node_id as target_node_id,
      n1.label as source_label, n2.label as target_label,
      count(DISTINCT t.name) as shared_tags,
      array_agg(DISTINCT t.name) as tag_names
    FROM resource_tags rt1
    JOIN resource_tags rt2 ON rt1.tag_id = rt2.tag_id AND rt1.resource_id != rt2.resource_id
    JOIN resources r1 ON r1.id = rt1.resource_id
    JOIN resources r2 ON r2.id = rt2.resource_id
    JOIN tags t ON t.id = rt1.tag_id
    JOIN nodes n1 ON n1.id = r1.node_id
    JOIN nodes n2 ON n2.id = r2.node_id
    WHERE r1.node_id != r2.node_id
      AND r1.node_id < r2.node_id
      AND NOT EXISTS (
        SELECT 1 FROM cross_refs cr
        WHERE (cr.source_node_id = r1.node_id AND cr.target_node_id = r2.node_id)
           OR (cr.source_node_id = r2.node_id AND cr.target_node_id = r1.node_id)
      )
    GROUP BY r1.node_id, r2.node_id, n1.label, n2.label
    HAVING count(DISTINCT t.name) >= 3
    ORDER BY shared_tags DESC
  `);
  return rows;
}
