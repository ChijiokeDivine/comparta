import type { Metadata } from "next";
import {getActiveLegalDocument} from "@/lib/legal/documents";
import {
  DEFAULT_TERMS_HTML,
  DEFAULT_TERMS_SECTIONS,
  DEFAULT_TERMS_TITLE,
  DEFAULT_TERMS_VERSION,
} from "@/lib/legal/default-terms";
import { TermsClient} from "./TermsClient";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for Comparta — the financial operating system for modern teams.",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const doc = await getActiveLegalDocument("TERMS_OF_SERVICE");

  const title = doc?.title ?? DEFAULT_TERMS_TITLE;
  const version = doc?.versionString ?? DEFAULT_TERMS_VERSION;
  const publishedAt = (doc?.publishedAt ?? new Date()).toISOString();
  const htmlContent = doc?.content ?? DEFAULT_TERMS_HTML;

  // Prefer TOC derived from the HTML if you store section markers;
  // otherwise fall back to the canonical section list.
  const toc = DEFAULT_TERMS_SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
  }));

  return (
    <TermsClient
      title={title}
      version={version}
      publishedAt={publishedAt}
      htmlContent={htmlContent}
      toc={toc}
    />
  );
}