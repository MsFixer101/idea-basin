import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { RESOURCE_TYPES } from '../styles/theme.js';

const BASE_RADIUS = [40, 28, 20];
const MAX_RADIUS  = [70, 50, 35];
const FONT_SIZE = ['13px', '10px', '8px'];

// Dynamic radius: scales logarithmically with resource count
function nodeRadius(d) {
  const base = BASE_RADIUS[d.depth] ?? 20;
  const max  = MAX_RADIUS[d.depth]  ?? 35;
  const count = d.resource_count || 0;
  if (count === 0) return base;
  const t = Math.min(Math.log(count + 1) / Math.log(250), 1);
  return base + (max - base) * t;
}

function glowRadius(d) {
  return nodeRadius(d) * 1.25;
}

export default function Graph({
  nodes,
  links,
  onSelect,
  onExpand,
  onDrillDown,
  onReparent,
  onContextMenu,
  containerRef,
}) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const posCache = useRef({});
  const zoomRef = useRef(null);
  const initialized = useRef(false);
  const clickTimerRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = containerRef.current.clientWidth || 700;
    const height = containerRef.current.clientHeight || 500;
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const cx = width / 2;
    const cy = height / 2;

    // ── One-time setup ──
    if (!initialized.current) {
      initialized.current = true;

      const defs = svg.append('defs');
      const radGrad = defs.append('radialGradient').attr('id', 'basin-glow');
      radGrad.append('stop').attr('offset', '0%').attr('stop-color', '#1e1b4b').attr('stop-opacity', 0.5);
      radGrad.append('stop').attr('offset', '50%').attr('stop-color', '#0f0a1a').attr('stop-opacity', 0.15);
      radGrad.append('stop').attr('offset', '100%').attr('stop-color', 'transparent');

      // Zoom container — everything inside moves together on scroll/pinch
      const world = svg.append('g').attr('class', 'zoom-container');

      const bg = world.append('g').attr('class', 'basin-bg');
      bg.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', Math.min(width, height) * 0.42)
        .attr('fill', 'url(#basin-glow)');

      const spiralGroup = bg.append('g').attr('opacity', 0.05);
      for (let i = 0; i < 3; i++) {
        const points = [];
        for (let t = 0; t < Math.PI * 4; t += 0.1) {
          const r = 15 + t * (Math.min(width, height) * 0.08) + i * 12;
          points.push([cx + r * Math.cos(t + i * 2.1), cy + r * Math.sin(t + i * 2.1)]);
        }
        spiralGroup.append('path')
          .datum(points)
          .attr('d', d3.line().curve(d3.curveBasisOpen))
          .attr('fill', 'none').attr('stroke', '#818cf8').attr('stroke-width', 1);
      }

      world.append('g').attr('class', 'link-layer');
      world.append('g').attr('class', 'node-layer');

      // Scroll wheel / trackpad zoom + pan
      const zoom = d3.zoom()
        .scaleExtent([0.3, 4])
        .on('zoom', (event) => {
          svg.select('.zoom-container').attr('transform', event.transform);
        });
      svg.call(zoom);
      // Prevent double-click-to-zoom (we use dblclick for drill-down)
      svg.on('dblclick.zoom', null);
      zoomRef.current = zoom;

      // Drag-to-reparent styles
      const style = document.createElement('style');
      style.textContent = `
        .node-group.drag-dim { opacity: 0.25 !important; transition: opacity 0.15s; }
        .node-group.drop-target { opacity: 1 !important; }
        .node-group.drop-target > circle:nth-child(2) {
          stroke-width: 2.5 !important;
          filter: drop-shadow(0 0 10px currentColor);
        }
      `;
      document.head.appendChild(style);
    }

    if (!nodes || nodes.length === 0) {
      svg.select('.link-layer').selectAll('*').remove();
      svg.select('.node-layer').selectAll('*').remove();
      return;
    }

    // ── Focus: which depth-0 node is expanded? ──
    const focusedId = nodes.find(n => n.depth === 0 && n.expanded)?.id || null;
    const focusedSubtree = new Set();
    if (focusedId) {
      focusedSubtree.add(focusedId);
      for (const n of nodes) {
        if (n.parentId === focusedId) focusedSubtree.add(n.id);
        if (n.depth === 2 && focusedSubtree.has(n.parentId)) focusedSubtree.add(n.id);
      }
    }

    // Unfocused nodes are dimmed but still visible and clickable
    const nodeOpacity = (d) => {
      if (!focusedId) return 1;
      return focusedSubtree.has(d.id) ? 1 : 0.45;
    };

    // ── Simulation data — preserve positions, new nodes bloom from parent ──
    const d3Nodes = nodes.map((n, idx) => {
      const cached = posCache.current[n.id];
      const parentCached = posCache.current[n.parentId];

      let x, y;
      if (cached) {
        x = cached.x;
        y = cached.y;
      } else if (parentCached) {
        // Bloom: new children start at parent, radially offset
        const siblings = nodes.filter(s => s.parentId === n.parentId && !posCache.current[s.id]);
        const sibIdx = siblings.indexOf(n);
        const sibCount = siblings.length || 1;
        const angle = (sibIdx / sibCount) * Math.PI * 2 - Math.PI / 2;
        x = parentCached.x + Math.cos(angle) * 6;
        y = parentCached.y + Math.sin(angle) * 6;
      } else {
        // First render: spread around center
        const angle = (idx / Math.max(nodes.length, 1)) * Math.PI * 2;
        const dist = 80 + Math.random() * 60;
        x = cx + Math.cos(angle) * dist;
        y = cy + Math.sin(angle) * dist;
      }

      return { ...n, x, y };
    });

    const d3Links = links.map(l => ({ ...l }));

    // ── Simulation — gentle, no fighting ──
    if (simRef.current) simRef.current.stop();

    const isFirstRender = Object.keys(posCache.current).length === 0;

    const simulation = d3.forceSimulation(d3Nodes)
      .alpha(isFirstRender ? 0.5 : 0.2)
      .alphaDecay(0.02)
      .velocityDecay(0.5)
      .force('charge', d3.forceManyBody()
        .strength(d => d.depth === 0 ? -400 : d.depth === 1 ? -200 : -80))
      .force('collision', d3.forceCollide()
        .radius(d => nodeRadius(d) + 18)
        .strength(0.6))
      .force('link', d3.forceLink(d3Links)
        .id(d => d.id)
        .distance(d => {
          const src = typeof d.source === 'object' ? d.source : null;
          const srcDepth = src?.depth ?? 0;
          return srcDepth === 0 ? 160 : srcDepth === 1 ? 100 : 60;
        })
        .strength(0.4))
      .force('x', d3.forceX(cx).strength(d => {
        const count = d.resource_count || 0;
        return count === 0 ? 0.005 : 0.01 + Math.min(count / 200, 0.04);
      }))
      .force('y', d3.forceY(cy).strength(d => {
        const count = d.resource_count || 0;
        return count === 0 ? 0.005 : 0.01 + Math.min(count / 200, 0.04);
      }));

    simRef.current = simulation;

    // ── Links ──
    const linkLayer = svg.select('.link-layer');
    const linkKey = d => `${d.source.id ?? d.source}-${d.target.id ?? d.target}`;
    const linkSel = linkLayer.selectAll('line').data(d3Links, linkKey);

    linkSel.exit().transition().duration(300).attr('stroke-opacity', 0).remove();

    const linkEnter = linkSel.enter().append('line')
      .attr('stroke', '#2e2565')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0);

    linkEnter.transition().duration(500).attr('stroke-opacity', 0.3);

    const allLinks = linkEnter.merge(linkSel);

    // ── Nodes ──
    const nodeLayer = svg.select('.node-layer');
    const nodeSel = nodeLayer.selectAll('g.node-group').data(d3Nodes, d => d.id);

    // EXIT — shrink back to parent
    nodeSel.exit().each(function (d) {
      const el = d3.select(this);
      const pp = posCache.current[d.parentId];
      el.transition().duration(400).ease(d3.easeCubicIn)
        .attr('transform', `translate(${pp ? pp.x : d.x},${pp ? pp.y : d.y}) scale(0.1)`)
        .attr('opacity', 0)
        .remove();
    });

    // ENTER — fade in at position
    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')
      .attr('opacity', 0)
      .attr('transform', d => `translate(${d.x},${d.y})`);

    buildNodeContent(nodeEnter);
    // Wire expand click on newly entered nodes
    nodeEnter.each(function (d) {
      d3.select(this).selectAll('rect.expand-indicator')
        .on('click', function (e) {
          e.stopPropagation();
          onExpand(d.id, d.expanded);
        });
    });
    nodeEnter.transition().duration(500).ease(d3.easeCubicOut).attr('opacity', nodeOpacity);

    // UPDATE — refresh expand indicator, set opacity directly (no transition fighting)
    nodeSel.each(function (d) {
      const g = d3.select(this);
      g.selectAll('.expand-indicator').remove();
      if (d.child_count > 0) {
        const r = nodeRadius(d);
        // Clickable expand/collapse hit area
        g.append('rect')
          .attr('class', 'expand-indicator')
          .attr('x', -20).attr('y', r + 2)
          .attr('width', 40).attr('height', 18)
          .attr('fill', 'transparent')
          .style('cursor', 'pointer')
          .on('click', function (e) {
            e.stopPropagation();
            onExpand(d.id, d.expanded);
          });
        g.append('text')
          .attr('class', 'expand-indicator')
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('y', r + 11)
          .attr('font-size', '10px').attr('fill', d.color).attr('opacity', 0.6)
          .attr('font-family', "'JetBrains Mono', monospace")
          .style('pointer-events', 'none')
          .text(d.expanded ? '\u25B4' : `+${d.child_count}`);
      }
    });
    nodeSel.transition().duration(300).attr('opacity', nodeOpacity);

    const allNodes = nodeEnter.merge(nodeSel);

    // Drag (with reparent detection)
    // Drag-to-reparent: stop simulation only when actual dragging occurs
    // (not on click). D3 drag 'start' fires on mousedown before we know
    // if it's a click or drag, so we defer simulation.stop() to first 'drag' event.
    let dragTarget = null;
    let actuallyDragging = false;
    allNodes.call(
      d3.drag()
        .on('start', (e, d) => {
          d.fx = d.x; d.fy = d.y;
          actuallyDragging = false;
        })
        .on('drag', (e, d) => {
          if (!actuallyDragging) {
            actuallyDragging = true;
            simulation.stop();
            allNodes.filter(n => n.id !== d.id).classed('drag-dim', true);
          }
          d.fx = e.x; d.fy = e.y;
          d.x = e.x; d.y = e.y;
          posCache.current[d.id] = { x: e.x, y: e.y };
          // Manually move dragged node (sim is stopped, no ticks)
          allNodes.filter(n => n.id === d.id)
            .attr('transform', `translate(${e.x},${e.y})`);
          // Update connected links
          allLinks
            .attr('x1', l => l.source.x).attr('y1', l => l.source.y)
            .attr('x2', l => l.target.x).attr('y2', l => l.target.y);
          // Find nearest node within drop radius
          let nearest = null;
          let nearestDist = Infinity;
          allNodes.each(function (n) {
            if (n.id === d.id) return;
            const dx = e.x - n.x, dy = e.y - n.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const dropRadius = nodeRadius(n) + 30;
            if (dist < dropRadius && dist < nearestDist) {
              nearest = n;
              nearestDist = dist;
            }
          });
          // Update drop target highlight
          if (nearest !== dragTarget) {
            allNodes.classed('drop-target', false);
            if (nearest) {
              allNodes.filter(n => n.id === nearest.id)
                .classed('drop-target', true).classed('drag-dim', false);
            }
            dragTarget = nearest;
          }
        })
        .on('end', (e, d) => {
          d.fx = null; d.fy = null;
          if (actuallyDragging) {
            allNodes.classed('drag-dim', false).classed('drop-target', false);
            // Check for valid reparent
            if (dragTarget && onReparent) {
              const srcId = d.id, tgtId = dragTarget.id;
              if (srcId !== tgtId && d.id !== dragTarget.parentId) {
                onReparent(srcId, tgtId, d.label, dragTarget.label);
              }
            }
            dragTarget = null;
            // Restart simulation to settle layout
            simulation.alpha(0.3).restart();
          } else {
            // Was just a click — don't disturb the simulation
            if (!e.active) simulation.alphaTarget(0);
          }
          actuallyDragging = false;
        })
    );

    // Click on circle — select AND auto-expand children
    // Uses a timer so double-click can cancel the single-click action
    allNodes.on('click', (e, d) => {
      e.stopPropagation();
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onSelect(d._raw);
        // Auto-expand: show children inline on single click
        if (d.child_count > 0 && !d.expanded) {
          onExpand(d.id, false);
        }
      }, 250);
    });

    // Double-click — drill down, or navigate up if clicking the center root
    allNodes.on('dblclick', (e, d) => {
      e.stopPropagation();
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      if (d._isViewRoot && d.parentId) {
        onDrillDown(d.parentId); // Navigate up
      } else if (d.child_count > 0) {
        onDrillDown(d.id);
      }
    });

    // Right-click — context menu
    if (onContextMenu) {
      allNodes.on('contextmenu', (e, d) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu({ x: e.clientX, y: e.clientY, node: d._raw });
      });
      svg.on('contextmenu', (e) => {
        // Only fire for empty space — node right-clicks handled above with stopPropagation
        e.preventDefault();
        onContextMenu({ x: e.clientX, y: e.clientY, node: null });
      });
    }

    // ── Tick ──
    simulation.on('tick', () => {
      allNodes.attr('transform', d => {
        posCache.current[d.id] = { x: d.x, y: d.y };
        return `translate(${d.x},${d.y})`;
      });
      allLinks
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    });

    return () => simulation.stop();
  }, [nodes, links]);

  useEffect(() => {
    return () => { initialized.current = false; posCache.current = {}; zoomRef.current = null; };
  }, []);

  return <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

function buildNodeContent(selection) {
  selection.append('circle')
    .attr('r', d => glowRadius(d))
    .attr('fill', 'none')
    .attr('stroke', d => d.color)
    .attr('stroke-width', d => d.depth === 0 ? 1.5 : 1)
    .attr('stroke-opacity', 0.12);

  selection.append('circle')
    .attr('r', d => nodeRadius(d))
    .attr('fill', d => {
      const c = d3.color(d.color);
      if (c) { c.opacity = d.depth === 0 ? 0.12 : 0.08; return c + ''; }
      return 'rgba(129,140,248,0.1)';
    })
    .attr('stroke', d => d.color)
    .attr('stroke-width', d => d.depth === 0 ? 1.5 : 1);

  selection.filter(d => d.child_count > 0).each(function (d) {
    const g = d3.select(this);
    const r = nodeRadius(d);
    g.append('rect')
      .attr('class', 'expand-indicator')
      .attr('x', -20).attr('y', r + 2)
      .attr('width', 40).attr('height', 18)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer');
    g.append('text')
      .attr('class', 'expand-indicator')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('y', r + 11)
      .attr('font-size', '10px').attr('fill', d.color).attr('opacity', 0.6)
      .attr('font-family', "'JetBrains Mono', monospace")
      .style('pointer-events', 'none')
      .text(d.expanded ? '\u25B4' : `+${d.child_count}`);
  });

  selection.each(function (d) {
    const types = d.resource_types;
    if (!types || types.length === 0) return;
    const g = d3.select(this);
    const r = nodeRadius(d);
    types.forEach((t, idx) => {
      const rt = RESOURCE_TYPES[t.type];
      if (!rt) return;
      const angle = (idx / types.length) * Math.PI * 2 - Math.PI / 2;
      const orbitR = r + (d.depth === 0 ? 16 : 10);
      g.append('text')
        .attr('x', Math.cos(angle) * orbitR).attr('y', Math.sin(angle) * orbitR)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', d.depth === 0 ? '12px' : '9px').attr('opacity', 0.7)
        .text(rt.icon);
      if (t.count > 1) {
        g.append('text')
          .attr('x', Math.cos(angle) * orbitR + 8).attr('y', Math.sin(angle) * orbitR - 6)
          .attr('text-anchor', 'middle')
          .attr('font-size', '7px').attr('fill', rt.color).attr('font-weight', '700')
          .attr('font-family', "'JetBrains Mono', monospace")
          .text(t.count);
      }
    });
  });

  selection.each(function (d) {
    const g = d3.select(this);
    const labelEl = g.append('text')
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('fill', d.depth === 0 ? '#f1f5f9' : d.depth === 1 ? '#cbd5e1' : '#94a3b8')
      .attr('font-size', FONT_SIZE[d.depth] || '8px')
      .attr('font-weight', d.depth === 0 ? '700' : d.depth === 1 ? '600' : '500')
      .attr('font-family', "'JetBrains Mono', monospace");

    const maxChars = d.depth === 0 ? 20 : d.depth === 1 ? 14 : 12;
    const text = d.label.length > maxChars ? d.label.substring(0, maxChars - 1) + '\u2026' : d.label;
    const words = text.split(' ');
    if (words.length > 1) {
      words.forEach((w, i) => {
        labelEl.append('tspan')
          .attr('x', 0).attr('dy', i === 0 ? `${-(words.length - 1) * 0.35}em` : '1.1em')
          .text(w);
      });
    } else {
      labelEl.text(text);
    }
  });
}
