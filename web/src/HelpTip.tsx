// 「?」说明按钮：鼠标悬停显示，点击固定；内容渲染到 body，避免被滚动容器裁切
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Pos { left: number; top: number; maxH: number; above: boolean }

const WIDTH = 380;
const MARGIN = 10;

export function HelpTip({ children, label = '说明', wide }: { children: React.ReactNode; label?: string; wide?: boolean }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const width = wide ? 460 : WIDTH;

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const left = Math.min(Math.max(MARGIN, b.left - 14), window.innerWidth - width - MARGIN);
    const below = window.innerHeight - b.bottom - MARGIN;
    const aboveSpace = b.top - MARGIN;
    const above = below < 260 && aboveSpace > below;
    setPos({ left, top: above ? b.top - 6 : b.bottom + 6, maxH: Math.max(160, (above ? aboveSpace : below) - 8), above });
  };

  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
  };
  const showSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { place(); setOpen(true); }, 160);
  };
  const hideSoon = () => {
    window.clearTimeout(timer.current);
    if (!pinned) timer.current = window.setTimeout(() => setOpen(false), 180);
  };

  // 内容变化后重新计算位置（如展开「详细说明」）
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && ((popRef.current?.contains(t as Node) ?? false) || (btnRef.current?.contains(t as Node) ?? false));
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onScroll = (e: Event) => { if (!inside(e.target)) close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`help-btn ${open ? 'open' : ''}`}
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={showSoon}
        onMouseLeave={hideSoon}
        onClick={(e) => {
          e.stopPropagation();
          if (pinned) { close(); return; }
          window.clearTimeout(timer.current);
          place();
          setOpen(true);
          setPinned(true);
        }}
      >?</button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className={`help-pop ${pos.above ? 'above' : ''}`}
          style={{ left: pos.left, top: pos.top, maxHeight: pos.maxH, width }}
          role="dialog"
          onMouseEnter={() => window.clearTimeout(timer.current)}
          onMouseLeave={hideSoon}
          onMouseDown={() => setPinned(true)}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
