import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../styles/theme.js';

const ITEM_STYLE = {
  padding: '6px 12px',
  fontSize: 11,
  color: theme.text.secondary,
  cursor: 'pointer',
  borderRadius: 4,
  whiteSpace: 'nowrap',
};

function MenuItem({ label, color, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ ...ITEM_STYLE, ...(color ? { color } : {}) }}
      onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >{label}</div>
  );
}

export default function ContextMenu({ x, y, node, onClose, onOpen, onAddChild, onRename, onTogglePrivate, onDelete }) {
  const ref = useRef(null);

  useEffect(() => {
    const dismiss = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const escHandler = (e) => { if (e.key === 'Escape') onClose(); };
    // Use both mousedown and click — mousedown catches most cases,
    // click catches cases where mousedown is stopped by D3 drag
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('click', dismiss, true);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('click', dismiss, true);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose]);

  // If no node, this is a right-click on empty space
  const items = node ? [
    { label: 'Open', action: () => { onOpen(node); onClose(); } },
    { label: 'Add sub-basin', action: () => { onAddChild(node); onClose(); } },
    { label: 'Rename', action: () => { onRename(node); onClose(); } },
    {
      label: node.private ? '🔓 Make public' : '🔒 Make private',
      color: node.private ? '#fbbf24' : undefined,
      action: () => { onTogglePrivate(node); onClose(); },
    },
    { label: 'Delete', color: '#f87171', action: () => { onDelete(node); onClose(); } },
  ] : [
    { label: 'Create new basin', action: () => { onAddChild(null); onClose(); } },
  ];

  return createPortal(
    <div ref={ref} style={{
      position: 'fixed', left: x, top: y, zIndex: 200,
      background: theme.bg.card, border: `1px solid ${theme.border.default}`,
      borderRadius: 6, padding: 4, minWidth: 150,
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    }}>
      {items.map((item, i) => (
        <MenuItem key={i} label={item.label} color={item.color} onClick={item.action} />
      ))}
    </div>,
    document.body
  );
}
