// app/(app)/wallet/_components/CreateWalletButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateWalletButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/wallet", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create wallet");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not create wallet");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleCreate}
        disabled={loading}
        className="btn-3d btn-3d--sm"
        style={
          {
            "--btn-bg": "#2A5CE6",
            "--btn-bg-hover": "#2450d1",
            "--btn-edge": "#1A3FA8",
            "--btn-edge-hover": "#17358f",
            color: "#ffffff",
          } as React.CSSProperties
        }
      >
        {loading ? "Creating wallet…" : "Create wallet"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
