// Hover tooltips for the stats on the cards and panels. Anything with a `data-tip` attribute shows its
// text in a small box beside the pointer after a short pause. One box serves the whole page, and it
// re-reads the text whenever the page redraws, so a tip on a changing number stays current.
import { useEffect, useRef, useState } from 'preact/hooks';

const DELAY = 280;
const GAP = 14;

export function Tooltip() {
  const [at, setAt] = useState<{ el: HTMLElement; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let timer = 0;
    let cur: HTMLElement | null = null;
    let x = 0, y = 0;
    const hide = () => { clearTimeout(timer); cur = null; setAt(null); };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      x = e.clientX; y = e.clientY;
      if (el === cur) return;
      clearTimeout(timer);
      cur = el;
      setAt(null);
      if (el) timer = window.setTimeout(() => cur === el && setAt({ el, x, y }), DELAY);
    };
    const move = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      if (cur) setAt((a) => (a && a.el === cur ? { el: cur, x, y } : a));
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('wheel', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  const text = at && at.el.isConnected ? at.el.getAttribute('data-tip') : null;

  // keep the box on screen: right of and below the pointer, flipped where it would run off the edge
  useEffect(() => {
    if (!text || !at || !box.current) { setPos(null); return; }
    const r = box.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = at.x + GAP, top = at.y + GAP;
    if (left + r.width > vw - 8) left = Math.max(8, at.x - GAP - r.width);
    if (top + r.height > vh - 8) top = Math.max(8, at.y - GAP - r.height);
    if (!pos || pos.left !== left || pos.top !== top) setPos({ left, top });
  });

  if (!text) return null;
  return (
    <div ref={box} class="hover-tip" role="tooltip"
      style={{ left: `${pos?.left ?? -9999}px`, top: `${pos?.top ?? -9999}px` }}>
      {text}
    </div>
  );
}
