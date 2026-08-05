// app/(app)/contacts/[id]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function EditContactPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const contactId = params.id;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/contacts/${contactId}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setDisplayName(data.contact.displayName);
        setIdentifier(data.contact.identifier);
        setNotes(data.contact.notes ?? "");
      })
      .catch(() => setError("Failed to load contact"))
      .finally(() => setLoading(false));
  }, [contactId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          identifier: identifier.trim(),
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save changes");
        return;
      }
      router.push("/contacts");
      router.refresh();
    } catch {
      setError("Could not save changes");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not delete contact");
        return;
      }
      router.push("/contacts");
      router.refresh();
    } catch {
      setError("Could not delete contact");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return <div className="max-w-lg text-sm text-[#7C8CA6]">Loading…</div>;
  }
  if (notFound) {
    return <div className="max-w-lg text-sm text-[#7C8CA6]">Contact not found.</div>;
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Edit contact</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="displayName" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Name
          </label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base"
          />
        </div>

        <div>
          <label htmlFor="identifier" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            @username or 0x address
          </label>
          <input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base"
          />
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Notes <span className="font-normal text-[#7C8CA6]">(optional)</span>
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn-3d w-full"
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
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="pt-4 border-t border-[#F2F4F8]">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="text-sm font-medium text-red-600 hover:underline">
            Delete this contact
          </button>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm text-amber-800">This can&apos;t be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
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
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn-3d btn-3d--sm btn-3d--neutral">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}