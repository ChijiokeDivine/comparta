"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Header } from "../components/Header";

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
        <div className="relative overflow-hidden">
            {/* Shared background image */}
            <Image
              src="/logan-voss-Pgoz3GyEcHE-unsplash.jpg"
              alt=""
              fill
              priority
              className="object-cover"
            />
            {/* Overlay */}
            <div className="absolute inset-0 bg-black/60" />

            <Header />

            {/* Hero section with background image */}
            <section className="relative"  >

            <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-center px-4 pt-5 md:pb-20 pb-36  text-center sm:px-6 md:h-[85vh] h-[60vh]">
                <h1 className="text-[40px] font-normal leading-[1.05] text-[#FFFFFF] sm:text-[64px] md:text-[65px] lg:text-[70px] xl:text-[74px] pt-4  md:pt-5">
                {title}

                </h1>
                <p className="mt-3 text-[14px] text-[#FFFFFF]">
                    Version <span className="font-medium text-[#FFFFFF]">{version}</span>
                    <span className="mx-2 text-[#C5CAD6]">·</span>
                    Effective {formattedDate}
                </p>
                <p className="mt-9 max-w-[640px] text-[15px] text-[#FFFFFF] md:text-[18px]">
                PLEASE READ THESE TERMS OF USE CAREFULLY BEFORE USING THE SERVICES OR ACCESSING THE PLATFORM.
                </p>
                
            </div>
            </section>
        </div>


      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
    

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
                <ul className="space-y-3 border-l border-[#E8ECF2]">
                  {toc.map((item) => {
                    const isActive = activeId === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => scrollTo(item.id)}
                          className={`
                            block w-full border-l-2 py-1.5 pl-3 text-left text-[15px] leading-snug transition-colors
                            ${
                              isActive
                                ? "border-[#0066f5] font-semibold text-[#0066f5]"
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