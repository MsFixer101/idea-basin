import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { theme } from './styles/theme.js';
import { api } from './hooks/useApi.js';
import { useMobile } from './hooks/useMobile.js';
import Graph from './components/Graph.jsx';
import Breadcrumb from './components/Breadcrumb.jsx';
import NodePanel from './components/NodePanel.jsx';
import AddNodeModal from './components/AddNodeModal.jsx';
import ScanModal from './components/ScanModal.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ChatDrawer from './components/ChatDrawer.jsx';
import ConfirmMoveModal from './components/ConfirmMoveModal.jsx';
import SearchBar from './components/SearchBar.jsx';

export default function App() {
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [currentNode, setCurrentNode] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [selectedResources, setSelectedResources] = useState([]);
  const [selectedCrossRefs, setSelectedCrossRefs] = useState([]);
  const [alsoInMap, setAlsoInMap] = useState({});
  const [showAddNode, setShowAddNode] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMoveConfirm, setShowMoveConfirm] = useState(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const pendingSelectRef = useRef(null);
  const mobile = useMobile();

  // Track which nodes are expanded and their loaded children
  // { [nodeId]: { children: [...], depth: number } }
  const [expanded, setExpanded] = useState({});

  // Load root on mount
  useEffect(() => {
    (async () => {
      try {
        const root = await api.getRootNode();
        setCurrentNodeId(root.id);
        setCurrentNode(root);
        setBreadcrumb([{ id: root.id, label: root.label }]);
      } catch (err) {
        console.error('Failed to load root:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load node data when currentNodeId changes (drill-down)
  useEffect(() => {
    if (!currentNodeId) return;
    (async () => {
      try {
        const [node, path] = await Promise.all([
          api.getNodeDeep(currentNodeId),
          api.getNodeTree(currentNodeId),
        ]);
        setCurrentNode(node);
        setBreadcrumb(path);
        // Auto-select a child if queued (e.g. from cross-ref navigation)
        const pending = pendingSelectRef.current;
        if (pending) {
          pendingSelectRef.current = null;
          const target = node.children?.find(c => c.id === pending);
          setSelectedChild(target || null);
        } else {
          setSelectedChild(null);
        }
        setSelectedResources([]);
        setSelectedCrossRefs([]);
        setExpanded({}); // reset expanded state on drill-down
      } catch (err) {
        console.error('Failed to load node:', err);
      }
    })();
  }, [currentNodeId]);

  // Expose refresh for Electron capture window
  useEffect(() => {
    window.__ideaBasinRefresh = async (savedNodeId) => {
      if (!currentNodeId) return;
      try {
        const node = await api.getNodeDeep(currentNodeId);
        setCurrentNode(node);
        // Auto-select the node that was saved to so the panel opens
        if (savedNodeId) {
          const target = node.children?.find(c => c.id === savedNodeId);
          if (target) setSelectedChild(target);
        }
      } catch (err) {
        console.error('External refresh failed:', err);
      }
    };
    return () => { delete window.__ideaBasinRefresh; };
  }, [currentNodeId]);

  // Build flat nodes + links arrays from currentNode.children + expanded state
  const { nodes: graphNodes, links: graphLinks } = useMemo(() => {
    if (!currentNode?.children) return { nodes: [], links: [] };

    const nodes = [];
    const links = [];
    const isDrilledDown = !!currentNode.parent_id;
    const depthOffset = isDrilledDown ? 1 : 0;

    // When drilled down, show current node as center root
    if (isDrilledDown) {
      nodes.push({
        id: currentNode.id,
        label: currentNode.label,
        color: currentNode.color || '#818cf8',
        depth: 0,
        parentId: currentNode.parent_id,
        child_count: currentNode.children.length,
        resource_count: parseInt(currentNode.resource_count) || 0,
        resource_types: currentNode.resource_types || [],
        expanded: true,
        _isViewRoot: true,
        _raw: currentNode,
      });
    }

    // Direct children of current node
    for (const child of currentNode.children) {
      const isExpanded = !!expanded[child.id];
      nodes.push({
        id: child.id,
        label: child.label,
        color: child.color || '#818cf8',
        depth: 0 + depthOffset,
        parentId: currentNode.id,
        child_count: parseInt(child.child_count) || child.children?.length || 0,
        resource_count: parseInt(child.resource_count) || 0,
        resource_types: child.resource_types || [],
        expanded: isExpanded,
        _raw: child,
      });

      if (isDrilledDown) {
        links.push({ source: currentNode.id, target: child.id });
      }

      // Expanded children
      if (isExpanded && expanded[child.id]?.children) {
        for (const grandchild of expanded[child.id].children) {
          const gcDepth = 1 + depthOffset;
          if (gcDepth > 2) continue;
          const isGcExpanded = !!expanded[grandchild.id];
          nodes.push({
            id: grandchild.id,
            label: grandchild.label,
            color: grandchild.color || child.color || '#818cf8',
            depth: gcDepth,
            parentId: child.id,
            child_count: parseInt(grandchild.child_count) || grandchild.children?.length || 0,
            resource_count: parseInt(grandchild.resource_count) || 0,
            resource_types: grandchild.resource_types || [],
            expanded: isGcExpanded,
            _raw: grandchild,
          });
          links.push({ source: child.id, target: grandchild.id });

          // Expanded grandchildren (only if depth allows)
          if (gcDepth < 2 && isGcExpanded && expanded[grandchild.id]?.children) {
            for (const ggchild of expanded[grandchild.id].children) {
              nodes.push({
                id: ggchild.id,
                label: ggchild.label,
                color: ggchild.color || grandchild.color || '#818cf8',
                depth: gcDepth + 1,
                parentId: grandchild.id,
                child_count: parseInt(ggchild.child_count) || 0,
                resource_count: parseInt(ggchild.resource_count) || 0,
                resource_types: ggchild.resource_types || [],
                expanded: false,
                _raw: ggchild,
              });
              links.push({ source: grandchild.id, target: ggchild.id });
            }
          }
        }
      }
    }

    return { nodes, links };
  }, [currentNode, expanded]);

  // Handle expand/collapse
  const handleExpand = useCallback(async (nodeId, isCurrentlyExpanded) => {
    if (isCurrentlyExpanded) {
      // Collapse: remove this node and any of its expanded children
      setExpanded(prev => {
        const next = { ...prev };
        const entry = next[nodeId];
        if (entry?.children) {
          for (const child of entry.children) {
            delete next[child.id];
          }
        }
        delete next[nodeId];
        return next;
      });
    } else {
      // Expand: fetch children, merge into state
      try {
        const node = await api.getNodeDeep(nodeId);
        if (node?.children) {
          setExpanded(prev => ({
            ...prev,
            [nodeId]: { children: node.children },
          }));
        }
      } catch (err) {
        console.error('Failed to expand node:', err);
      }
    }
  }, []);

  const handleNavigate = useCallback((nodeId) => {
    setCurrentNodeId(nodeId);
    setSelectedChild(null);
  }, []);

  // Navigate to a node and open its panel (used by cross-ref links)
  const handleNavigateToPanel = useCallback(async (nodeId) => {
    try {
      const node = await api.getNode(nodeId);
      if (node.parent_id) {
        if (node.parent_id === currentNodeId) {
          // Already viewing the parent — just select the child directly
          const target = currentNode?.children?.find(c => c.id === nodeId);
          if (target) setSelectedChild(target);
        } else {
          pendingSelectRef.current = nodeId;
          setCurrentNodeId(node.parent_id);
        }
      } else {
        // Root node — just navigate to it
        setCurrentNodeId(nodeId);
      }
    } catch (err) {
      console.error('Failed to navigate to panel:', err);
      setCurrentNodeId(nodeId);
    }
  }, [currentNodeId, currentNode]);

  const handleSelect = useCallback((node) => {
    setSelectedChild(node);
  }, []);

  const handleDrillDown = useCallback((nodeId) => {
    setCurrentNodeId(nodeId);
    setSelectedChild(null);
  }, []);

  // Load resources, cross-refs, and also-in when a child is selected
  useEffect(() => {
    if (!selectedChild) { setSelectedResources([]); setSelectedCrossRefs([]); setAlsoInMap({}); return; }
    (async () => {
      try {
        const [resources, crossRefs, alsoInRows] = await Promise.all([
          api.getNodeResources(selectedChild.id),
          api.getNodeCrossRefs(selectedChild.id),
          api.getAlsoIn(selectedChild.id),
        ]);
        setSelectedResources(resources);
        setSelectedCrossRefs(crossRefs);
        // Build lookup: { resourceId: [{id, label, color}] }
        const map = {};
        for (const row of alsoInRows) {
          if (!map[row.resource_id]) map[row.resource_id] = [];
          map[row.resource_id].push({ id: row.other_node_id, label: row.label, color: row.color });
        }
        setAlsoInMap(map);
      } catch (err) {
        console.error('Failed to load resources:', err);
      }
    })();
  }, [selectedChild]);

  const handleAddNode = useCallback(async ({ label, color }) => {
    try {
      await api.createNode({ parent_id: currentNodeId, label, color });
      const node = await api.getNodeDeep(currentNodeId);
      setCurrentNode(node);
    } catch (err) {
      console.error('Failed to create node:', err);
    }
  }, [currentNodeId]);

  const handleAddChildNode = useCallback(async ({ parent_id, label, color }) => {
    try {
      await api.createNode({ parent_id, label, color });
      // Refresh the current graph
      const node = await api.getNodeDeep(currentNodeId);
      setCurrentNode(node);
      // If this node was expanded, refresh its children too
      if (expanded[parent_id]) {
        const updated = await api.getNodeDeep(parent_id);
        if (updated?.children) {
          setExpanded(prev => ({
            ...prev,
            [parent_id]: { children: updated.children },
          }));
        }
      }
      // Refresh the selected child to update child_count
      if (selectedChild?.id === parent_id) {
        const fresh = await api.getNodeDeep(parent_id);
        setSelectedChild(prev => ({ ...prev, child_count: fresh?.children?.length || 0 }));
      }
    } catch (err) {
      console.error('Failed to create child node:', err);
    }
  }, [currentNodeId, expanded, selectedChild]);

  const handleCreateCrossRef = useCallback(async ({ target_node_id, reason }) => {
    if (!selectedChild) return;
    try {
      await api.createCrossRef({ source_node_id: selectedChild.id, target_node_id, reason });
      const crossRefs = await api.getNodeCrossRefs(selectedChild.id);
      setSelectedCrossRefs(crossRefs);
    } catch (err) {
      console.error('Failed to create cross-ref:', err);
    }
  }, [selectedChild]);

  const handleDeleteCrossRef = useCallback(async (id) => {
    try {
      await api.deleteCrossRef(id);
      if (selectedChild) {
        const crossRefs = await api.getNodeCrossRefs(selectedChild.id);
        setSelectedCrossRefs(crossRefs);
      }
    } catch (err) {
      console.error('Failed to delete cross-ref:', err);
    }
  }, [selectedChild]);

  const handleAddResource = useCallback(async (data) => {
    try {
      await api.createResource(data);
      if (selectedChild) {
        const resources = await api.getNodeResources(selectedChild.id);
        setSelectedResources(resources);
        const node = await api.getNodeDeep(currentNodeId);
        setCurrentNode(node);
      }
    } catch (err) {
      console.error('Failed to create resource:', err);
    }
  }, [selectedChild, currentNodeId]);

  const handleDeleteNode = useCallback(async (nodeId) => {
    try {
      await api.deleteNode(nodeId);
      // Fetch fresh data BEFORE updating any UI state
      const node = await api.getNodeDeep(currentNodeId);
      // Update everything in one batch
      setCurrentNode(node);
      setExpanded(prev => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setSelectedChild(null);
      setSelectedResources([]);
    } catch (err) {
      console.error('Failed to delete node:', err);
    }
  }, [currentNodeId]);

  const handleMergeNodes = useCallback(async (sourceId, targetId) => {
    try {
      await api.mergeNodes(sourceId, targetId);
      // Merged node inherits parent's color
      if (currentNode?.color) {
        await api.updateNode(targetId, { color: currentNode.color });
      }
      // Fetch fresh data BEFORE updating any UI state
      const node = await api.getNodeDeep(currentNodeId);
      // Update everything in one batch
      setCurrentNode(node);
      setExpanded(prev => {
        const next = { ...prev };
        delete next[sourceId];
        if (next[targetId]) {
          delete next[targetId];
        }
        return next;
      });
      setSelectedChild(null);
      setSelectedResources([]);
    } catch (err) {
      console.error('Failed to merge nodes:', err);
    }
  }, [currentNodeId]);

  const handleReparent = useCallback((sourceId, targetId, sourceLabel, targetLabel) => {
    setShowMoveConfirm({ sourceId, targetId, sourceLabel, targetLabel });
  }, []);

  const confirmReparent = useCallback(async () => {
    if (!showMoveConfirm) return;
    const { sourceId, targetId } = showMoveConfirm;
    setShowMoveConfirm(null);
    try {
      await api.updateNode(sourceId, { parent_id: targetId });
      const node = await api.getNodeDeep(currentNodeId);
      setCurrentNode(node);
      setExpanded({});
      setSelectedChild(null);
      setSelectedResources([]);
    } catch (err) {
      console.error('Failed to reparent node:', err);
    }
  }, [showMoveConfirm, currentNodeId]);

  // Poll for ingesting resources
  useEffect(() => {
    const ingesting = selectedResources.filter(r => r.status === 'pending' || r.status === 'ingesting');
    if (ingesting.length === 0 || !selectedChild) return;
    const interval = setInterval(async () => {
      try {
        const resources = await api.getNodeResources(selectedChild.id);
        setSelectedResources(resources);
        if (!resources.some(r => r.status === 'pending' || r.status === 'ingesting')) clearInterval(interval);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedResources, selectedChild]);

  if (loading) {
    return (
      <div style={{
        width: '100%', height: '100vh', background: theme.bg.deep,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: theme.text.dim, fontFamily: theme.font, fontSize: 14,
      }}>Loading...</div>
    );
  }

  return (
    <div style={{
      width: '100%', height: '100vh', background: theme.bg.deep, color: theme.text.primary,
      fontFamily: theme.font, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
    }}>
      {/* Electron drag region + traffic light spacing */}
      <div style={{
        height: 38, flexShrink: 0, WebkitAppRegion: 'drag',
        background: theme.bg.surface, borderBottom: `1px solid ${theme.border.subtle}`,
      }} />

      {/* Top Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: mobile ? 'wrap' : 'nowrap', gap: mobile ? 8 : 0,
        padding: mobile ? '8px 10px' : '10px 16px',
        borderBottom: `1px solid ${theme.border.subtle}`, background: theme.bg.surface,
        flexShrink: 0,
      }}>
        <Breadcrumb path={breadcrumb} onNavigate={handleNavigate} />
        <SearchBar onNavigate={handleNavigate} />
        <div style={{ display: 'flex', gap: 6, ...(mobile ? { width: '100%' } : {}) }}>
          <button onClick={() => setShowScan(true)} style={{
            background: theme.bg.card, border: `1px solid ${theme.border.default}`, color: '#f59e0b',
            padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            ...(mobile ? { flex: 1 } : {}),
          }}>Scan</button>
          <button onClick={() => window.ideaBasin?.capture()} title="Quick Capture (Print Screen)" style={{
            background: theme.bg.card, border: `1px solid ${theme.border.default}`, color: '#94a3b8',
            padding: '0px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 24, fontFamily: 'inherit',
            ...(mobile ? { flex: 1 } : {}),
          }}>{'\u2702\uFE0F'}</button>
          <button onClick={() => setShowSettings(true)} style={{
            background: theme.bg.card, border: `1px solid ${theme.border.default}`, color: theme.text.muted,
            padding: '0px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 22, fontFamily: 'inherit',
            ...(mobile ? { flex: 1 } : {}),
          }}>{'\u2699'}</button>
          <button onClick={() => setShowAddNode(true)} style={{
            background: theme.bg.card, border: `1px solid ${theme.border.default}`, color: '#a78bfa',
            padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            ...(mobile ? { flex: 1 } : {}),
          }}>+ Node</button>
          <button style={{
            background: selectedChild ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : theme.bg.card,
            border: 'none', color: selectedChild ? '#fff' : theme.text.dim,
            padding: '5px 12px', borderRadius: 6,
            cursor: selectedChild ? 'pointer' : 'default',
            fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
            ...(mobile ? { flex: 1 } : {}),
          }}>+ Resource</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Graph */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative' }}>
          <Graph
            nodes={graphNodes}
            links={graphLinks}
            onSelect={handleSelect}
            onExpand={handleExpand}
            onDrillDown={handleDrillDown}
            onReparent={handleReparent}
            containerRef={containerRef}
          />

          {graphNodes.length === 0 && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)', textAlign: 'center', color: theme.text.dim,
            }}>
              <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.2 }}>◎</div>
              <div style={{ fontSize: 13 }}>Empty basin</div>
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.5 }}>Add nodes or drop resources</div>
            </div>
          )}

          {currentNode?.parent_id && (
            <button onClick={() => {
              const parentIdx = breadcrumb.length - 2;
              if (parentIdx >= 0) handleNavigate(breadcrumb[parentIdx].id);
            }} style={{
              position: 'absolute', bottom: 80, left: 16, background: theme.bg.card,
              border: `1px solid ${theme.border.default}`, color: '#a78bfa',
              padding: mobile ? '10px 18px' : '6px 14px',
              borderRadius: 8, cursor: 'pointer', fontSize: mobile ? 13 : 11, fontFamily: 'inherit',
            }}>◂ Up</button>
          )}
        </div>

        {/* Right Panel — overlays graph, never shifts layout */}
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: mobile ? '100%' : 360,
          transform: selectedChild ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          borderLeft: mobile ? 'none' : `1px solid ${theme.border.subtle}`,
          background: theme.bg.surface, zIndex: 10,
          overflowY: 'auto',
        }}>
          {selectedChild && (
            mobile ? (
              <div onClick={() => setSelectedChild(null)} style={{
                position: 'sticky', top: 0, zIndex: 11,
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 14px',
                background: theme.bg.surface,
                borderBottom: `1px solid ${theme.border.subtle}`,
                cursor: 'pointer',
              }}>
                <span style={{ fontSize: 16, color: theme.accent.purpleLight }}>&#9666;</span>
                <span style={{ fontSize: 12, color: theme.text.muted }}>Back to graph</span>
              </div>
            ) : (
              <button onClick={() => setSelectedChild(null)} style={{
                position: 'sticky', top: 0, right: 0, zIndex: 11, float: 'right',
                background: theme.bg.card, border: `1px solid ${theme.border.default}`,
                color: theme.text.muted, padding: '4px 10px', borderRadius: 6,
                cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', margin: '10px 10px 0 0',
              }}>✕</button>
            )
          )}
          <NodePanel
            node={selectedChild}
            resources={selectedResources}
            crossRefs={selectedCrossRefs}
            alsoInMap={alsoInMap}
            onAddResource={handleAddResource}
            onAddChildNode={handleAddChildNode}
            onCreateCrossRef={handleCreateCrossRef}
            onDeleteCrossRef={handleDeleteCrossRef}
            onDelete={handleDeleteNode}
            onMerge={handleMergeNodes}
            onNavigate={handleNavigate}
            onNavigateToPanel={handleNavigateToPanel}
            siblings={currentNode?.children || []}
            onRefresh={async () => {
              try {
                const node = await api.getNodeDeep(currentNodeId);
                setCurrentNode(node);
                if (selectedChild) {
                  const resources = await api.getNodeResources(selectedChild.id);
                  setSelectedResources(resources);
                  // Refresh child data (resource count may have changed)
                  const fresh = await api.getNodeDeep(selectedChild.id);
                  if (fresh) {
                    setSelectedChild(prev => ({
                      ...prev,
                      child_count: fresh.children?.length || 0,
                      resource_count: parseInt(fresh.resource_count) || 0,
                    }));
                  }
                }
              } catch (err) {
                console.error('Failed to refresh:', err);
              }
            }}
          />
        </div>
      </div>

      {/* Add Node Modal */}
      {showAddNode && (
        <AddNodeModal
          parentLabel={currentNode?.label || 'Root'}
          onAdd={handleAddNode}
          onClose={() => setShowAddNode(false)}
        />
      )}

      {showScan && (
        <ScanModal onClose={() => setShowScan(false)} />
      )}

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      <ChatDrawer />

      {showMoveConfirm && (
        <ConfirmMoveModal
          sourceLabel={showMoveConfirm.sourceLabel}
          targetLabel={showMoveConfirm.targetLabel}
          onConfirm={confirmReparent}
          onCancel={() => setShowMoveConfirm(null)}
        />
      )}
    </div>
  );
}
