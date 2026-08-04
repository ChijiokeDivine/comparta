// app/(app)/buckets/[id]/BucketActions.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BucketActions({
  bucketId,
  currentName,
  balance,
}: {
  bucketId: string;
  currentName: string;
  balance: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === currentName || !name.trim()) return;
    setError(null);
    setRenaming(true);
    try {
      const res = await fetch(`/api/buckets/${bucketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Rename failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Rename failed");
    } finally {
      setRenaming(false);
    }
  }

  async function handleArchive() {
    setError(null);
    setArchiving(true);
    try {
      const res = await fetch(`/api/buckets/${bucketId}/archive`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "This bucket can't be archived right now.");
        return;
      }
      router.refresh();
    } catch {
      setError("Archive failed");
    } finally {
      setArchiving(false);
      setConfirmArchive(false);
    }
  }

  return (
    <div className="pt-4 border-t border-[#F2F4F8] space-y-4">
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleRename} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="bucket-name" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
            Rename
          </label>
          <input
            id="bucket-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="w-full px-3 py-2 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
          />
        </div>
        <button
          type="submit"
          disabled={renaming || name.trim() === currentName || !name.trim()}
          className="btn-3d btn-3d--sm btn-3d--neutral shrink-0"
        >
          {renaming ? "Saving…" : "Save"}
        </button>
      </form>

      <div>
        {!confirmArchive ? (
          <button
            onClick={() => setConfirmArchive(true)}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            Archive this bucket
          </button>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm text-amber-800">
              {Number(balance) > 0
                ? "This bucket still holds a balance — archiving will be blocked until it's moved out."
                : "Archiving hides this bucket from new transfers. This can't be undone from here."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="btn-3d btn-3d--sm"
                style={
                  {
                    "--btn-bg": "#DC2626",
                    "--btn-bg-hover": "#c81e1e",
                    "--btn-edge": "#991b1b",
                    "--btn-edge-hover": "#7f1d1d",
                    color: "#ffffff",
                  } as React.CSSProperties
                }
              >
                {archiving ? "Archiving…" : "Confirm archive"}
              </button>
              <button
                onClick={() => setConfirmArchive(false)}
                className="btn-3d btn-3d--sm btn-3d--neutral"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}