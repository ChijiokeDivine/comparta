"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

export type TocItem = { id: string; title: string };

type Props = {
  title: string;
  version: string;
  publishedAt: string; // ISO
  htmlContent: string;
  toc: TocItem[];
};

export function TermsClient({ title, version, publishedAt, htmlContent, toc }: Props) {
  const [activeId, setActiveId] = useState<string>(toc[0]?.id ?? "");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sections = toc
      .map((t) => document.getElementById(t.id))
      .filter(Boolean) as HTMLElement[];

    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Prefer the top-most intersecting section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [toc]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  };

  const formattedDate = new Date(publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-white text-[#0B1E4B]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-[#E8ECF2] bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/img5.png" alt="Comparta" height={28} width={90} priority />
          </Link>
          <nav className="flex items-center gap-6 text-[13px] font-semibold">
            <Link href="/privacy" className="text-[#3E4A6B] hover:text-[#0B1E4B]">
              Privacy
            </Link>
            <Link href="/login" className="text-[#3E4A6B] hover:text-[#0B1E4B]">
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-[#0B1E4B] px-4 py-2 text-white hover:bg-[#16295c] transition-colors"
            >
              Open account
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
        {/* Page header */}
        <div className="mb-10 max-w-3xl">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#2A5CE6]">
            Legal
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-[#0B1E4B] sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-[14px] text-[#3E4A6B]">
            Version <span className="font-medium text-[#0B1E4B]">{version}</span>
            <span className="mx-2 text-[#C5CAD6]">·</span>
            Effective {formattedDate}
          </p>
        </div>

        <div className="flex flex-col gap-10 lg:flex-row lg:gap-14">
          {/* Sticky sidebar TOC */}
          <aside className="lg:w-56 lg:flex-shrink-0">
            <div className="lg:sticky lg:top-24">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#7C8CA6]">
                On this page
              </p>
              <nav
                className="max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 scrollbar-thin"
                aria-label="Table of contents"
              >
                <ul className="space-y-0.5 border-l border-[#E8ECF2]">
                  {toc.map((item) => {
                    const isActive = activeId === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => scrollTo(item.id)}
                          className={`
                            block w-full border-l-2 py-1.5 pl-3 text-left text-[13px] leading-snug transition-colors
                            ${
                              isActive
                                ? "border-[#2A5CE6] font-semibold text-[#0B1E4B]"
                                : "border-transparent text-[#3E4A6B] hover:border-[#C5CAD6] hover:text-[#0B1E4B]"
                            }
                          `}
                        >
                          {item.title.replace(/^\d+\.\s*/, "")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </aside>

          {/* Main content */}
          <article
            ref={contentRef}
            className="min-w-0 flex-1 prose-legal"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </div>
      </div>


    </div>
  );
}