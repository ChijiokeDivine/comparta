// app/(app)/settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import SettingsSubNav from "./_components/SettingsSubNav";
import { KybPill } from "../_components/Kyb";
import { formatDate } from "@/app/invoices/_components/format";

interface OrgProfile {
  id: string;
  legalName: string;
  username: string | null;
  kybStatus: "PENDING" | "APPROVED" | "REJECTED";
  kybApprovedAt: string | null;
  createdAt: string;
}

export default function OrganizationSettingsPage() {
  const { data: session } = useSession();
  const canEdit = session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [legalName, setLegalName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [usernameInput, setUsernameInput] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    fetch("/api/org")
      .then((res) => res.json())
      .then((data) => {
        setOrg(data.organization);
        setLegalName(data.organization.legalName);
      })
      .catch(() => setNameError("Failed to load organization"))
      .finally(() => setLoading(false));
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setSavingName(true);
    try {
      const res = await fetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalName: legalName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNameError(data.error ?? "Could not save changes");
        return;
      }
      load();
    } catch {
      setNameError("Could not save changes");
    } finally {
      setSavingName(false);
    }
  }

  async function handleClaimUsername(e: React.FormEvent) {
    e.preventDefault();
    setUsernameError(null);
    if (!usernameInput.trim()) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/username/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUsernameError(data.error ?? "Could not claim username");
        return;
      }
      setUsernameInput("");
      load();
    } catch {
      setUsernameError("Could not claim username");
    } finally {
      setClaiming(false);
    }
  }

  if (loading) return <div className="text-sm text-[#7C8CA6]">Loading…</div>;
  if (!org) return <div className="text-sm text-[#7C8CA6]">Failed to load organization.</div>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Settings</h1>
      <SettingsSubNav active="organization" />

      {session?.user?.role === "OWNER" && (
        <Link href="/settings/webhooks" className="text-sm font-medium text-[#2A5CE6] hover:underline">
          View webhook events →
        </Link>
      )}

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#0B1E3F]">KYB status</p>
          <KybPill status={org.kybStatus} />
        </div>
        {org.kybApprovedAt && (
          <p className="text-xs text-[#7C8CA6]">Approved {formatDate(org.kybApprovedAt)}</p>
        )}
      </div>

      <form onSubmit={handleSaveName} className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-4">
        <div>
          <label htmlFor="legalName" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Legal business name
          </label>
          <input
            id="legalName"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            disabled={!canEdit}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
          />
        </div>
        {nameError && <p className="text-sm text-red-600">{nameError}</p>}
        {canEdit && (
          <button
            type="submit"
            disabled={savingName || legalName.trim() === org.legalName}
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
            {savingName ? "Saving…" : "Save"}
          </button>
        )}
      </form>

      <form onSubmit={handleClaimUsername} className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-[#0B1E3F]">Username</p>
        {org.username ? (
          <p className="text-sm text-[#0B1E3F] font-mono">@{org.username}</p>
        ) : (
          <>
            <p className="text-xs text-[#7C8CA6]">
              Claim a @username so people can send you money without knowing your wallet address.{" "}
              {org.kybStatus !== "APPROVED" && "Requires an approved KYB."}
            </p>
            <div className="flex gap-2">
              <input
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                disabled={org.kybStatus !== "APPROVED"}
                placeholder="yourbusiness"
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={claiming || org.kybStatus !== "APPROVED" || !usernameInput.trim()}
                className="btn-3d btn-3d--sm btn-3d--neutral shrink-0"
              >
                {claiming ? "Claiming…" : "Claim"}
              </button>
            </div>
            {usernameError && <p className="text-sm text-red-600">{usernameError}</p>}
          </>
        )}
      </form>
    </div>
  );
}