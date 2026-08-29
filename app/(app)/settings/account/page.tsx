// app/(app)/settings/account/page.tsx
"use client";

import { useEffect, useState } from "react";
import SettingsSubNav from "../_components/SettingsSubNav";

interface CountryOption {
  code: string;
  name: string;
  currencyCode: string;
  currencyName: string;
  currencySymbol: string;
  flag: string;
  supported: boolean;
}

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

  const [countryCode, setCountryCode] = useState<string>("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsSaved, setPrefsSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me")
        .then((res) => res.json())
        .then((data) => {
          setName(data.user.name ?? "");
          setEmail(data.user.email);
        }),
      fetch("/api/countries")
        .then((res) => (res.ok ? res.json() : []))
        .then((data: CountryOption[]) => {
          setCountries(data);
        })
        .catch(() => {})
        .finally(() => setCountriesLoading(false)),
      fetch("/api/org")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.organization?.country) {
            setCountryCode(data.organization.country);
          }
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
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

  async function handleSavePreferences(e: React.FormEvent) {
    e.preventDefault();
    setPrefsError(null);
    setPrefsSaved(false);
    if (!countryCode) {
      setPrefsError("Please select a country");
      return;
    }
    const country = countries.find((c) => c.code === countryCode);
    if (!country) {
      setPrefsError("Invalid country selection");
      return;
    }
    setSavingPrefs(true);
    try {
      const res = await fetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: country.code,
          preferredCurrencyCode: country.currencyCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const issues: string[] = [];
        if (data.issues?.fieldErrors && typeof data.issues.fieldErrors === "object") {
          for (const [k, v] of Object.entries(data.issues.fieldErrors as Record<string, unknown>)) {
            if (Array.isArray(v)) issues.push(`${k}: ${v.join(", ")}`);
          }
        }
        if (data.issues?.formErrors && Array.isArray(data.issues.formErrors)) {
          for (const e of data.issues.formErrors as string[]) issues.push(e);
        }
        setPrefsError(issues.length ? issues.join(", ") : (data.error ?? "Could not save preferences"));
        return;
      }
      setPrefsSaved(true);
    } catch {
      setPrefsError("Could not save preferences");
    } finally {
      setSavingPrefs(false);
    }
  }

  const selectedCountry = countries.find((c) => c.code === countryCode);
  const sortedCountries = [...countries].sort((a, b) => a.name.localeCompare(b.name));

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

      <form
        onSubmit={handleSavePreferences}
        className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-4"
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold text-[#0B1E3F]">Display currency</p>
          <p className="text-xs text-[#7C8CA6]">
            Choose your country — your dashboard balance will show an approximate
            local-currency value in {selectedCountry?.currencySymbol ?? "your currency's symbol"}.
          </p>
        </div>

        <div className="relative">
          <label htmlFor="displayCountry" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
            Country
          </label>
          <div className="relative">
            {selectedCountry && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base leading-none"
              >
                {selectedCountry.flag}
              </span>
            )}
            <select
              id="displayCountry"
              value={countryCode}
              disabled={countriesLoading || savingPrefs}
              onChange={(e) => {
                setCountryCode(e.target.value);
                setPrefsSaved(false);
              }}
              className={`w-full appearance-none py-2.5 pr-10 rounded-xl border bg-white text-[#0B1E3F] text-sm focus:border-[#2A5CE6] disabled:bg-[#F7F8FB] disabled:text-[#7C8CA6] border-[#E5E9F2] ${
                selectedCountry ? "pl-10" : "pl-4"
              }`}
            >
              <option value="" disabled>
                {countriesLoading ? "Loading countries…" : "Select your country"}
              </option>
              {sortedCountries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} — {c.currencyCode} {c.currencySymbol}
                </option>
              ))}
            </select>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute right-3.5 top-[34px] -translate-y-1/2 text-[#7C8CA6]"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>

        {selectedCountry && (
          <div className="rounded-xl border border-[#E5E9F2] bg-[#F7F8FB] px-4 py-3 space-y-1">
            <p className="text-xs text-[#7C8CA6]">Currency</p>
            <p className="text-sm font-semibold text-[#0B1E3F]">
              <span className="mr-2 text-base">{selectedCountry.currencySymbol}</span>
              {selectedCountry.currencyName}
              <span className="ml-2 text-[#7C8CA6] font-normal">({selectedCountry.currencyCode})</span>
            </p>
            <p className="text-[11px] text-[#7C8CA6] mt-1">
              Example: <span className="font-medium text-[#0B1E3F]">1,000 USDC</span>
              {" ≈ "}
              <span className="font-medium text-[#0B1E3F]">
                {selectedCountry.currencySymbol}
                {/* placeholder rate preview — actual computed server-side */}
                1,340,250
              </span>
            </p>
          </div>
        )}

        {prefsError && <p className="text-sm text-red-600">{prefsError}</p>}
        {prefsSaved && <p className="text-sm text-emerald-600">Preferences saved.</p>}
        <button
          type="submit"
          disabled={savingPrefs || !countryCode}
          className="btn-3d btn-3d--sm btn-3d--neutral"
        >
          {savingPrefs ? "Saving…" : "Save preferences"}
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
