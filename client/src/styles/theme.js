export const theme = {
  bg: {
    deep: '#0f0a1a',
    surface: '#0d0819',
    card: '#1e1545',
    input: '#0f0a1a',
    hover: '#2e2565',
    item: '#13102a',
  },
  text: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    muted: '#64748b',
    dim: '#4c3f7a',
    ghost: '#3b3565',
  },
  accent: {
    purple: '#7c3aed',
    purpleLight: '#c084fc',
    amber: '#fbbf24',
    cyan: '#22d3ee',
    green: '#4ade80',
    orange: '#f97316',
    pink: '#f472b6',
    red: '#ef4444',
    indigo: '#818cf8',
  },
  border: {
    subtle: '#1e1545',
    default: '#2e2565',
    active: '#7c3aed',
  },
  font: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  radius: { sm: '4px', md: '6px', lg: '10px', xl: '16px', pill: '20px' },
};

export const RESOURCE_TYPES = {
  idea:     { icon: '\u{1F4A1}', label: 'Idea',     color: '#fbbf24' },
  note:     { icon: '\u{1F4DC}', label: 'Note',     color: '#a78bfa' },
  research: { icon: '\u{1F50D}', label: 'Research', color: '#22d3ee' },
  video:    { icon: '\u25B6',    label: 'Video',    color: '#f472b6' },
  code:     { icon: '\u2328',    label: 'Code',     color: '#4ade80' },
  link:     { icon: '\u{1F517}', label: 'Link',     color: '#818cf8' },
  file:     { icon: '\u{1F4F7}', label: 'File',     color: '#94a3b8' },
};

export const NODE_COLORS = [
  '#c084fc', '#22d3ee', '#f97316', '#4ade80',
  '#fbbf24', '#f472b6', '#ef4444', '#818cf8',
];

export function detectType(url) {
  if (!url) return 'idea';
  const u = url.toLowerCase();
  if (/arxiv|doi\.org|scholar|ieee|acm\.org|\.pdf$/i.test(u)) return 'research';
  if (/youtube|youtu\.be|vimeo|loom/i.test(u)) return 'video';
  if (/github|gitlab|codepen|gist|huggingface/i.test(u)) return 'code';
  return 'link';
}
