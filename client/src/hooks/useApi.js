const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  // Nodes
  getRootNode: () => request('/nodes/root'),
  getNode: (id) => request(`/nodes/${id}`),
  getNodeDeep: (id) => request(`/nodes/${id}/deep`),
  getNodeTree: (id) => request(`/nodes/${id}/tree`),
  getNodeResources: (id) => request(`/nodes/${id}/resources`),
  getNodeCrossRefs: (id) => request(`/nodes/${id}/crossrefs`),
  getAlsoIn: (id) => request(`/nodes/${id}/also-in`),
  getRecent: (limit) => request(`/nodes/recent${limit ? `?limit=${limit}` : ''}`),
  suggestGroups: (nodeId) => request(`/nodes/${nodeId}/suggest-groups`, { method: 'POST' }),
  applyGroups: (nodeId, data) => request(`/nodes/${nodeId}/apply-groups`, { method: 'POST', body: JSON.stringify(data) }),
  createNode: (data) => request('/nodes', { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (id, data) => request(`/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteNode: (id, cascade = false) => request(`/nodes/${id}?cascade=${cascade}`, { method: 'DELETE' }),
  mergeNodes: (sourceId, targetId) => request(`/nodes/${sourceId}/merge`, { method: 'POST', body: JSON.stringify({ target_id: targetId }) }),

  // Resources
  createResource: (data) => request('/resources', { method: 'POST', body: JSON.stringify(data) }),
  getResource: (id) => request(`/resources/${id}`),
  updateResource: (id, data) => request(`/resources/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteResource: (id) => request(`/resources/${id}`, { method: 'DELETE' }),
  importFilePath: (path, nodeId) => request('/resources/import-path', { method: 'POST', body: JSON.stringify({ path, node_id: nodeId }) }),

  // Search
  search: (q, nodeId) => request(`/search?q=${encodeURIComponent(q)}${nodeId ? `&node=${nodeId}` : ''}`),

  // Cross-refs
  createCrossRef: (data) => request('/crossrefs', { method: 'POST', body: JSON.stringify(data) }),
  deleteCrossRef: (id) => request(`/crossrefs/${id}`, { method: 'DELETE' }),
  getSuggestedCrossRefs: () => request('/crossrefs/suggested'),

  // Config
  getConfig: () => request('/config'),
  saveConfig: (data) => request('/config', { method: 'POST', body: JSON.stringify(data) }),
  getConfigStatus: () => request('/config/status'),
  syncModels: (provider, apiKey) => request('/config/sync-models', { method: 'POST', body: JSON.stringify({ provider, apiKey }) }),

  // WhatsApp
  whatsappStatus: () => request('/whatsapp/status'),
  whatsappConnect: () => request('/whatsapp/connect', { method: 'POST' }),
  whatsappDisconnect: () => request('/whatsapp/disconnect', { method: 'POST' }),
  whatsappRepair: () => request('/whatsapp/repair', { method: 'POST' }),
  whatsappRefreshGroups: () => request('/whatsapp/refresh-groups', { method: 'POST' }),
  whatsappSelectGroup: (groupJid) => request('/whatsapp/select-group', { method: 'POST', body: JSON.stringify({ groupJid }) }),
  whatsappSelectChatGroup: (groupJid) => request('/whatsapp/select-chat-group', { method: 'POST', body: JSON.stringify({ groupJid }) }),
  whatsappSelectBlogGroup: (groupJid) => request('/whatsapp/select-blog-group', { method: 'POST', body: JSON.stringify({ groupJid }) }),

  // Memory
  getMemories: () => request('/memory'),
  deleteMemory: (id) => request(`/memory/${id}`, { method: 'DELETE' }),

  // Briefing
  briefingStatus: () => request('/briefing/status'),
  briefingTrigger: () => request('/briefing/trigger', { method: 'POST' }),
  briefingTestRss: (feeds) => request('/briefing/test-rss', { method: 'POST', body: JSON.stringify({ feeds }) }),
  briefingRestartScheduler: () => request('/briefing/restart-scheduler', { method: 'POST' }),
};
