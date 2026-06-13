import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface DropdownOption {
  value: string;
  label: ReactNode;
}

interface Props {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** Styling for the trigger button (colors, padding). */
  triggerClassName?: string;
  align?: 'left' | 'right';
  title?: string;
  minWidth?: string;
}

// Dark, glass-styled dropdown that matches the app UI (native <select> popups
// render OS-white and are unreadable on the dark theme).
export default function Dropdown({
  value, options, onChange, triggerClassName = '', align = 'left', title, minWidth,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        title={title}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 cursor-pointer transition-all ${triggerClassName}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 glass rounded-lg p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ minWidth: minWidth ?? '100%' }}
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`flex items-center w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap ${
                o.value === value
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
