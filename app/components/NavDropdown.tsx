"use client";

import Link from "next/link";
import { useState } from "react";
import type { MarketingNavSection } from "./navLinks";

const COLUMN_CLASSES: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

/**
 * Desktop marketing nav dropdown. Renders one `MARKETING_NAV` section.
 *
 * Items without an `href` are `comingSoon` and render as a disabled row, so
 * we never ship a link that goes nowhere.
 */
export function NavDropdown({ section }: { section: MarketingNavSection }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuClass =
    section.columns === 1
      ? "nav-dropdown-menu nav-dropdown-menu--compact"
      : "nav-dropdown-menu";

  return (
    <div
      className="relative group"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 text-[16px] md:text-[14px] font-medium text-[#FFFFFF] hover:text-[#FFFFFF]"
      >
        {section.label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="transition-transform duration-300 group-hover:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div className={menuClass} role="menu" aria-label={section.label}>
        <div className={`grid gap-6 ${COLUMN_CLASSES[section.columns]}`}>
          {section.items.map(({ label, href, icon: Icon, comingSoon }) => {
            const content = (
              <>
                <div className="w-9 h-9 rounded-full bg-[#ffffff] flex items-center justify-center flex-shrink-0">
                  <Icon size={20} color="#0B1E3F" strokeWidth={2} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-[#0B1E3F]">
                      {label}
                    </span>
                    {comingSoon && (
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[#2A5CE6] text-white uppercase tracking-wider">
                        Soon
                      </span>
                    )}
                  </div>
                </div>
              </>
            );

            if (!href) {
              return (
                <div
                  key={label}
                  aria-disabled="true"
                  className="nav-dropdown-item flex items-center gap-3 px-4 rounded-lg cursor-default opacity-60"
                >
                  {content}
                </div>
              );
            }

            return (
              <Link
                key={label}
                href={href}
                role="menuitem"
                className="nav-dropdown-item flex items-center gap-3 px-4 rounded-lg hover:bg-[#F2F4F8] transition-colors"
              >
                {content}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
