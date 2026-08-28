// components/onboarding/CountrySelect.tsx
"use client";

import { useEffect, useState } from "react";
import { fetchCountries, type CountryOption } from "@/lib/countries";

interface CountrySelectProps {
  id?: string;
  value: string; // ISO 3166-1 alpha-2 code, e.g. "US"; "" when unselected
  onChange: (alpha2Code: string) => void;
  error?: string;
  required?: boolean;
}

// Native <select> styled to match the rest of the onboarding/register
// forms (rounded-xl, #E5E9F2 border, #2A5CE6 focus ring, #0B1E3F text) —
// a native select rather than a custom listbox since that's the pattern
// already used everywhere else in these forms, and it comes with working
// keyboard nav / mobile pickers for free. Options are populated from
// countries.dev; the selected country's flag renders as a small overlay
// image on the left (native <option> can't render images itself).
export default function CountrySelect({
  id = "country",
  value,
  onChange,
  error,
  required,
}: CountrySelectProps) {
  const [countries, setCountries] = useState<CountryOption[]>([]);
  // Start "true"/"false" as the initial state itself, rather than setting
  // them synchronously inside the effect below — the effect only ever
  // touches state from inside the fetch's .then/.catch/.finally callbacks,
  // which is the "subscribe to an external system, setState when it
  // resolves" pattern, not a synchronous setState-in-effect-body.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Bumped by the "Try again" button to re-run the effect below.
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCountries()
      .then((data) => {
        if (cancelled) return;
        setCountries(data);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  // Plain click handler, not an effect — synchronous setState here is
  // fine, and bumping retryToken re-runs the fetch effect above.
  function retry() {
    setLoading(true);
    setLoadError(false);
    setRetryToken((t) => t + 1);
  }

  const selected = countries.find((c) => c.alpha2Code === value);
  const disabled = loading || loadError;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-[#0B1E3F] mb-3">
        Country
      </label>

      <div className="relative mb-5">
        {selected && (
          // eslint-disable-next-line @next/next/no-img-element -- tiny
          <img
            src={selected.flagSvg}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-6 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(11,30,63,0.06)]"
          />
        )}

        <select
          id={id}
          value={value}
          required={required}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full appearance-none py-3 pr-10 rounded-xl border bg-white transition-all text-[#0B1E3F] text-sm md:text-base focus:border-[#2A5CE6] disabled:bg-[#F7F8FB] disabled:text-[#7C8CA6] ${
            selected ? "pl-11" : "pl-4"
          } ${error ? "border-red-300" : "border-[#E5E9F2]"}`}
        >
          <option value="" disabled>
            {loading
              ? "Loading countries…"
              : loadError
              ? "Couldn't load countries"
              : "Select your country"}
          </option>
          {countries.map((c) => (
            <option key={c.alpha2Code} value={c.alpha2Code}>
              {c.name}
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
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#7C8CA6]"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      {loadError && (
        <p className="mt-1.5 text-sm text-[#7C8CA6]">
          Couldn&apos;t load the country list.{" "}
          <button type="button" onClick={retry} className="text-[#2A5CE6] underline">
            Try again
          </button>
        </p>
      )}
      {error && !loadError && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}