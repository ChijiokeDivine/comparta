// lib/fx/seed.ts
//
// One-shot seeding utilities for the Currency + Country catalogs.
//
// Sources:
//   • Currency names  ← currencies.json in repo root (from OER provider)
//   • Currency symbols ← curated map (REST Countries "symbol" field is
//     inconsistent — many entries return "None", empty strings, or the
//     ISO code itself rather than a glyph).
//   • Country metadata ← https://countries.dev/countries
//
// Exclusions (spec §15):
//   • Crypto:  BTC
//   • Metals:  XAU, XAG, XPD, XPT
//   • IMF SDR: XDR
//   • Funds/units-of-account: CLF, XCG
//   • Obsolete: CUC, HRK, SLL, STD, VEF, ZWL, MRO, LTL, LVL, EEK, SKK, CYP, MTL, TMM, ROL, TRY? keep TRY (Turkiye), ZMK, GHC, MZM, SDD
//
// Callable:
//   • await seedCountryCatalog(prisma)   — run from a migration / deploy
//   • the `seed-fx-catalog` script entry (see package.json — add manually)

import "dotenv/config";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

// ─── currency exclusions ───────────────────────────────────────────────────

const EXCLUDED_CURRENCY_CODES = new Set([
  // crypto / metals / imf / non-fiat units
  "BTC",
  "XAU",
  "XAG",
  "XPD",
  "XPT",
  "XDR",
  "CLF",
  "XCG",
  // obsolete
  "CUC",
  "HRK",
  "SLL",
  "STD",
  "VEF",
  "ZWL",
  "MRO",
  "LTL",
  "LVL",
  "EEK",
  "SKK",
  "CYP",
  "MTL",
  "TMM",
  "ROL",
  "ZMK",
  "GHC",
  "MZM",
  "SDD",
  "UYI",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XTS",
  "XXX",
]);

// ─── currency symbol map ───────────────────────────────────────────────────
//
// A deliberately small, hand-curated set covering the currencies most
// likely to be actually used by a real user. Anything we don't have a
// glyph for falls back to the ISO code (which is what the user sees in
// the dropdown anyway). Symbols are as per ISO 4217 conventional usage,
// not the "native" unicode glyph when that would be confusing (e.g. the
// generic "₨" vs "Rs" vs "৳" for Bangladesh — we follow the country's
// own convention where known).

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  INR: "₹",
  NGN: "₦",
  GHS: "₵",
  KES: "KSh",
  ZAR: "R",
  CAD: "CA$",
  AUD: "A$",
  SGD: "S$",
  HKD: "HK$",
  NZD: "NZ$",
  CHF: "Fr",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  CZK: "Kč",
  HUF: "Ft",
  RON: "lei",
  BGN: "лв",
  HRK: "kn",
  TRY: "₺",
  RUB: "₽",
  UAH: "₴",
  KZT: "₸",
  UZS: "soʻm",
  AZN: "₼",
  GEL: "₾",
  AMD: "֏",
  BYN: "Br",
  MDL: "L",
  BRL: "R$",
  ARS: "$",
  CLP: "$",
  COP: "$",
  MXN: "$",
  PEN: "S/",
  PYG: "₲",
  UYU: "$U",
  VES: "Bs.",
  DOP: "RD$",
  GTQ: "Q",
  HNL: "L",
  NIO: "C$",
  PAB: "B/.",
  CRC: "₡",
  SVC: "₡",
  CUP: "$MN",
  BSD: "$",
  BBD: "$",
  BMD: "$",
  KYD: "CI$",
  XCD: "EC$",
  ANG: "ƒ",
  AWG: "Afl.",
  SRD: "$",
  TTD: "TT$",
  FKP: "£",
  SHP: "£",
  GIP: "£",
  IMP: "£",
  GGP: "£",
  JEP: "£",
  EGP: "E£",
  MAD: "DH",
  TND: "DT",
  DZD: "DA",
  LYD: "LD",
  SDG: "LS",
  SSP: "£",
  ETB: "Br",
  SOS: "Sh",
  KMF: "CF",
  XAF: "FCFA",
  XOF: "CFA",
  XPF: "CFP",
  WST: "T",
  VUV: "VT",
  TOP: "T$",
  FJD: "FJ$",
  PGK: "K",
  SBD: "SI$",
  AED: "د.إ",
  SAR: "ر.س",
  QAR: "ر.ق",
  BHD: ".د.ب",
  KWD: "د.ك",
  OMR: "ر.ع.",
  JOD: "د.ا",
  ILS: "₪",
  LBP: "ل.ل",
  SYP: "ل.س",
  YER: "﷼",
  IRR: "﷼",
  IQD: "ع.د",
  PKR: "₨",
  LKR: "රු",
  NPR: "रू",
  MVR: "Rf",
  THB: "฿",
  VND: "₫",
  IDR: "Rp",
  MYR: "RM",
  SLL: "Le",
  SLE: "Le",
  GNF: "FG",
  RWF: "RF",
  BIF: "FBu",
  DJF: "Fdj",
  ERN: "Nfk",
  MGA: "Ar",
  MWK: "MK",
  MUR: "₨",
  MZN: "MT",
  NAD: "N$",
  SCR: "₨",
  STD: "Db",
  STN: "Db",
  TZS: "TSh",
  UGX: "USh",
  ZMW: "K",
  ZWG: "ZiG",
  BTN: "Nu.",
  BWP: "P",
  LSL: "M",
  SZL: "E",
  BDT: "৳",
  KHR: "៛",
  LAK: "₭",
  MMK: "K",
  KRW: "₩",
  KPW: "₩",
  MOP: "P",
  PHP: "₱",
  TWD: "NT$",
  CNH: "¥",
  TJS: "ЅМ",
  TMT: "m",
  AFN: "؋",
  ALL: "L",
  AOA: "Kz",
  BAM: "КМ",
  BND: "B$",
  BOB: "Bs.",
  CDN: "",
  CDF: "FC",
  CVE: "$",
  GMD: "D",
  GYD: "GY$",
  HTG: "G",
  JMD: "J$",
  KGS: "с",
  LRD: "L$",
  MKD: "ден",
  MNT: "₮",
  MRU: "UM",
  RSD: "дин",
};

// ─── countries.dev types ───────────────────────────────────────────────────

interface CountriesDevCurrency {
  code: string;
  name: string;
  symbol?: string;
}

interface CountriesDevCountry {
  name: string;
  alpha2Code: string;
  alpha3Code?: string;
  currencies?: CountriesDevCurrency[];
  /** Often the emoji (e.g. "🇺🇸"); sometimes a URL */
  flag?: string;
  flags?: { svg?: string; png?: string };
}

// ─── main seeding entry ────────────────────────────────────────────────────

export interface SeedResult {
  currenciesCreated: number;
  currenciesUpdated: number;
  currenciesSkipped: number;
  countriesCreated: number;
  countriesUpdated: number;
  countriesSkipped: number;
}

export async function seedCountryCatalog(
  prisma: PrismaClient
): Promise<SeedResult> {
  const root = process.cwd();
  const currenciesPath = path.join(root, "currencies.json");
  const raw = await readFile(currenciesPath, "utf-8");
  const currencyNames = JSON.parse(raw) as Record<string, string>;

  // 1. Currency catalog — only codes that exist in currencies.json AND
  //    are not in the exclusion set.
  let currenciesCreated = 0;
  let currenciesUpdated = 0;
  let currenciesSkipped = 0;

  for (const [code, name] of Object.entries(currencyNames)) {
    if (EXCLUDED_CURRENCY_CODES.has(code)) {
      currenciesSkipped++;
      continue;
    }
    const symbol = CURRENCY_SYMBOLS[code] ?? code;
    try {
      const existing = await prisma.currency.findUnique({ where: { code } });
      if (!existing) {
        await prisma.currency.create({
          data: { code, name, symbol, isSupported: true },
        });
        currenciesCreated++;
      } else if (existing.name !== name || existing.symbol !== symbol) {
        await prisma.currency.update({
          where: { code },
          data: { name, symbol },
        });
        currenciesUpdated++;
      }
    } catch (err) {
      console.warn(`[seed] currency ${code} upsert failed`, err);
      currenciesSkipped++;
    }
  }

  // 2. Country catalog — pull from countries.dev
  let countriesCreated = 0;
  let countriesUpdated = 0;
  let countriesSkipped = 0;

  let countries: CountriesDevCountry[] = [];
  try {
    const res = await fetch(
      "https://countries.dev/countries?fields=name,alpha2Code,currencies,flag"
    );
    if (!res.ok) {
      throw new Error(`countries.dev HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("countries.dev returned a non-array payload");
    }
    countries = data as CountriesDevCountry[];
  } catch (err) {
    console.error(
      "[seed] failed to fetch countries.dev — skipping country upsert",
      err
    );
    return {
      currenciesCreated,
      currenciesUpdated,
      currenciesSkipped,
      countriesCreated: 0,
      countriesUpdated: 0,
      countriesSkipped: 0,
    };
  }

  const sorted = [...countries]
    .filter((c) => c.alpha2Code && c.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const c of sorted) {
    try {
      const list = c.currencies ?? [];
      if (list.length === 0) {
        countriesSkipped++;
        continue;
      }

      // Prefer the first non-excluded currency
      const primary =
        list.find((cur) => cur.code && !EXCLUDED_CURRENCY_CODES.has(cur.code)) ??
        null;
      if (!primary?.code) {
        countriesSkipped++;
        continue;
      }

      const curCode = primary.code;
      const currencyName = primary.name ?? currencyNames[curCode] ?? curCode;
      const currencySymbol =
        CURRENCY_SYMBOLS[curCode] ?? primary.symbol ?? curCode;

      // Prefer emoji; fall back to regional-indicator generator
      const flagEmoji =
        typeof c.flag === "string" && !c.flag.startsWith("http")
          ? c.flag
          : emojiForCca2(c.alpha2Code);

      const existing = await prisma.country.findUnique({
        where: { code: c.alpha2Code },
      });

      const data = {
        code: c.alpha2Code,
        name: c.name,
        currencyCode: curCode,
        currencyName,
        currencySymbol,
        flag: flagEmoji,
      };

      if (!existing) {
        await prisma.country.create({ data });
        countriesCreated++;
      } else {
        const changed =
          existing.name !== data.name ||
          existing.currencyCode !== data.currencyCode ||
          existing.currencyName !== data.currencyName ||
          existing.currencySymbol !== data.currencySymbol ||
          existing.flag !== data.flag;
        if (changed) {
          await prisma.country.update({
            where: { code: c.alpha2Code },
            data,
          });
          countriesUpdated++;
        }
      }
    } catch (err) {
      console.warn(`[seed] country ${c.alpha2Code} upsert failed`, err);
      countriesSkipped++;
    }
  }

  return {
    currenciesCreated,
    currenciesUpdated,
    currenciesSkipped,
    countriesCreated,
    countriesUpdated,
    countriesSkipped,
  };
}

// Fallback emoji generator — regional indicator symbols A-Z.
function emojiForCca2(cca2: string): string {
  const base = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(
    base + cca2.charCodeAt(0),
    base + cca2.charCodeAt(1)
  );
}

// ─── CLI entry (runs if this file is executed directly) ───────────────────

function isMainModule(): boolean {
  // Works for both CJS (require.main) and when run via tsx/ts-node
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return typeof require !== "undefined" && require.main === module;
  } catch {
    return false;
  }
}

if (isMainModule() || process.argv[1]?.includes("seed")) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[seed/fx-catalog] DATABASE_URL is not set");
    process.exitCode = 1;
  } else {
    const adapter = new PrismaPg({ connectionString });
    const prisma = new PrismaClient({ adapter });

    seedCountryCatalog(prisma)
      .then((r) => {
        console.log("[seed/fx-catalog] done", JSON.stringify(r, null, 2));
      })
      .catch((err) => {
        console.error("[seed/fx-catalog] failed", err);
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  }
}