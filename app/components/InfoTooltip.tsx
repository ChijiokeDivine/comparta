// app/components/InfoTooltip.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";

/**
 * A small "ⓘ" icon that reveals a short popover on hover/click/focus.
 * Used wherever a card would otherwise need an extra paragraph of
 * explanatory text — keeps the default view minimal (per the redesign
 * that introduced this: no separate pages, tooltips instead of prose).
 */
export default function InfoTooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label="More info"
        className="text-[#7C8CA6] hover:text-[#2A5CE6] transition-colors"
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 rounded-lg bg-[#0B1E3F] px-3 py-2 text-[11px] leading-relaxed text-white shadow-lg"
        >
          {children}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#0B1E3F]" />
        </div>
      )}
    </span>
  );
}
