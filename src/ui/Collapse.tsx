// Folding panels down to their title bar: the big panels and the info windows each get a small
// chevron that hides everything but their header, so they stay on screen without covering the world.
import { useState } from 'preact/hooks';

const KEY = 'bandwick.collapsed.';

function load(id: string) {
  try {
    return localStorage.getItem(KEY + id) === '1';
  } catch {
    return false;
  }
}
function save(id: string, v: boolean) {
  try {
    if (v) localStorage.setItem(KEY + id, '1');
    else localStorage.removeItem(KEY + id);
  } catch {
    /* storage blocked: it just won't be remembered */
  }
}

/** Whether a panel is folded. Give an id to remember it between visits. */
export function useCollapsed(id?: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => (id ? load(id) : false));
  return [v, (next: boolean) => {
    setV(next);
    if (id) save(id, next);
  }];
}

/** The chevron that folds and unfolds a panel. */
export function CollapseBtn({ collapsed, onToggle, what }: { collapsed: boolean; onToggle: (v: boolean) => void; what: string }) {
  const label = collapsed ? `Expand ${what}` : `Collapse ${what}`;
  return (
    <button class="btn icon small collapse-btn" aria-expanded={!collapsed} onClick={() => onToggle(!collapsed)} title={label} aria-label={label}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={collapsed ? 'M4 6.5l4 4 4-4' : 'M4 9.5l4-4 4 4'} />
      </svg>
    </button>
  );
}
