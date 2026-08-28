// lib/countries.ts
//
// Thin client for the countries.dev API (https://countries.dev/docs) — a
// free, keyless, CORS-open country data API. Used to populate the country
// picker on the onboarding + registration forms.
//
// Base URL is just https://countries.dev — no auth, no rate-limit tiers.
// We only need name + ISO alpha-2 code + flag for the select, so the list
// call asks for a lean field set via `fields=` instead of the full record.
// Both the list and single-country responses are cached at module scope
// for the lifetime of the tab, since country data doesn't change and this
// same module gets called from more than one form.

const COUNTRIES_BASE_URL = "https://countries.dev";

export interface CountryOption {
  name: string;
  alpha2Code: string;
  flagSvg: string;
  flagPng: string;
}

interface RawCountriesDevCountry {
  name: string;
  alpha2Code: string;
  flags?: { svg?: string; png?: string };
}

function toOption(c: RawCountriesDevCountry): CountryOption {
  const code = c.alpha2Code.toLowerCase();
  return {
    name: c.name,
    alpha2Code: c.alpha2Code,
    // countries.dev already returns flags.svg/png, but fall back to
    // flagcdn directly (same CDN it sources from) if a record is ever
    // missing them, rather than rendering a broken image.
    flagSvg: c.flags?.svg ?? `https://flagcdn.com/${code}.svg`,
    flagPng: c.flags?.png ?? `https://flagcdn.com/w80/${code}.png`,
  };
}

let cachedCountries: CountryOption[] | null = null;
let inFlight: Promise<CountryOption[]> | null = null;

// Fetches the full country list, sorted by name, for populating a select.
// Cached after the first successful call; concurrent callers (e.g. two
// forms mounting at once) share the same in-flight request instead of
// firing duplicate calls.
export async function fetchCountries(): Promise<CountryOption[]> {
  if (cachedCountries) return cachedCountries;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch(
      `${COUNTRIES_BASE_URL}/countries?fields=name,alpha2Code,flags&sort=name`
    );
    if (!res.ok) {
      throw new Error(`countries.dev returned ${res.status}`);
    }
    const data: RawCountriesDevCountry[] = await res.json();
    const options = data.filter((c) => c.alpha2Code && c.name).map(toOption);
    cachedCountries = options;
    return options;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

// Looks up a single country by ISO alpha-2 code, e.g. for a read-only
// profile view that only has the stored code and needs the name/flag.
export async function fetchCountryByAlpha2(
  alpha2Code: string
): Promise<CountryOption | null> {
  if (!alpha2Code) return null;
  const cached = cachedCountries?.find((c) => c.alpha2Code === alpha2Code);
  if (cached) return cached;

  const res = await fetch(`${COUNTRIES_BASE_URL}/alpha/${alpha2Code}`);
  if (!res.ok) return null;
  const c: RawCountriesDevCountry = await res.json();
  if (!c?.alpha2Code) return null;
  return toOption(c);
}