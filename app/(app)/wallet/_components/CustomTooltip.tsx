// components/CustomTooltip.tsx
"use client";

import { useState, useRef, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";

interface CustomTooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  className?: string;
}

export function CustomTooltip({
  content,
  children,
  side = "top",
  delay = 200,
  className = "",
}: CustomTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const tooltipHeight = 32; // approximate
        const tooltipWidth = 200; // approximate

        let top = 0;
        let left = 0;

        switch (side) {
          case "top":
            top = rect.top - tooltipHeight - 8;
            left = rect.left + rect.width / 2;
            break;
          case "bottom":
            top = rect.bottom + 8;
            left = rect.left + rect.width / 2;
            break;
          case "left":
            top = rect.top + rect.height / 2;
            left = rect.left - 8;
            break;
          case "right":
            top = rect.top + rect.height / 2;
            left = rect.right + 8;
            break;
        }

        setCoords({ top, left });
        setIsVisible(true);
      }
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  // Close on scroll / resize
  useEffect(() => {
    const handleScroll = () => hideTooltip();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className="inline-flex"
      >
        {children}
      </div>

      {isVisible &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`
              fixed z-[9999] px-2.5 py-1.5 text-xs font-medium
              text-white bg-[#0B1E3F] rounded-md shadow-lg
              pointer-events-none select-none
              animate-in fade-in-0 zoom-in-95
              ${className}
            `}
            style={{
              top: coords.top,
              left: coords.left,
              transform:
                side === "top" || side === "bottom"
                  ? "translateX(-50%)"
                  : side === "left"
                  ? "translate(-100%, -50%)"
                  : "translateY(-50%)",
            }}
          >
            {content}

            {/* Arrow */}
            <div
              className={`
                absolute w-2 h-2 bg-[#0B1E3F] rotate-45
                ${
                  side === "top"
                    ? "bottom-[-4px] left-1/2 -translate-x-1/2"
                    : side === "bottom"
                    ? "top-[-4px] left-1/2 -translate-x-1/2"
                    : side === "left"
                    ? "right-[-4px] top-1/2 -translate-y-1/2"
                    : "left-[-4px] top-1/2 -translate-y-1/2"
                }
              `}
            />
          </div>,
          document.body
        )}
    </>
  );
}