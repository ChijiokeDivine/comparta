// app/(app)/contacts/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/app/components/StatusPill";

interface Contact {
  id: string;
  displayName: string;
  identifier: string;
  identifierType: "USERNAME" | "ADDRESS";
  notes: string | null;
  lastPaidAt: string | null;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => setContacts(data.contacts ?? []))
      .catch(() => setError("Failed to load contacts"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Contacts</h1>
        <Link
          href="/contacts/new"
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
          New contact
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && contacts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No contacts yet.{" "}
          <Link href="/contacts/new" className="text-[#2A5CE6] font-medium hover:underline">
            Add one
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {contacts.map((c) => (
            <Link
              key={c.id}
              href={`/contacts/${c.id}/edit`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0B1E3F] truncate">{c.displayName}</p>
                <p className="text-xs text-[#7C8CA6] font-mono truncate">{c.identifier}</p>
              </div>
              <StatusPill value={c.identifierType} label={c.identifierType === "USERNAME" ? "Username" : "Address"} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}