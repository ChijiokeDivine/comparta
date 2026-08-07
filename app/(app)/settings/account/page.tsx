// app/(app)/settings/account/page.tsx
"use client";

import { useEffect, useState } from "react";
import SettingsSubNav from "../_components/SettingsSubNav";

export default function AccountSettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        setName(data.user.name ?? "");
        setEmail(data.user.email);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    setSavingName(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNameError(data.error ?? "Could not save changes");
        return;
      }
      setNameSaved(true);
    } catch {
      setNameError("Could not save changes");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error ?? "Could not change password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch {
      setPasswordError("Could not change password");
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) return <div className="max-w-lg text-sm text-[#7C8CA6]">Loading…</div>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Settings</h1>
      <SettingsSubNav active="account" />

      <form onSubmit={handleSaveName} className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Email
          </label>
          <input
            id="email"
            value={email}
            disabled
            className="w-full px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#7C8CA6] bg-[#F7F8FB]"
          />
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameSaved(false);
            }}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
          />
        </div>
        {nameError && <p className="text-sm text-red-600">{nameError}</p>}
        {nameSaved && <p className="text-sm text-emerald-600">Saved.</p>}
        <button
          type="submit"
          disabled={savingName}
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
      </form>

      <form onSubmit={handleChangePassword} className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-4">
        <p className="text-sm font-semibold text-[#0B1E3F]">Change password</p>
        <div>
          <label htmlFor="currentPassword" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
            Current password
          </label>
          <input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
          />
        </div>
        <div>
          <label htmlFor="newPassword" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={10}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={10}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
          />
        </div>
        {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
        {passwordSaved && <p className="text-sm text-emerald-600">Password updated.</p>}
        <button
          type="submit"
          disabled={savingPassword || !currentPassword || !newPassword}
          className="btn-3d btn-3d--sm btn-3d--neutral"
        >
          {savingPassword ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}