import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  };

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="min-w-40 bg-[#1c1c1c] border border-white/12 rounded-xl shadow-2xl py-1 overflow-hidden"
    >
      {items.map((item, i) => {
        // Render dividers as a plain HR
        if (item.disabled && item.label.startsWith('──')) {
          return <div key={i} className="my-1 border-t border-white/10 mx-2" />;
        }
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              item.disabled
                ? 'text-white/25 cursor-default'
                : item.variant === 'danger'
                  ? 'text-red-400 hover:bg-white/8'
                  : 'text-white/80 hover:bg-white/8'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
