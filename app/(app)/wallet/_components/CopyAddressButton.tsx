// app/(app)/wallet/_components/CopyAddressButton.tsx
"use client";

import { useState } from "react";

export default function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable - silently no-op, nothing financial at stake
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="btn-3d btn-3d--sm btn-3d--neutral"
      aria-label="Copy wallet address"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}