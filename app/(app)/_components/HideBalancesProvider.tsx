"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "comparta.hideBalances";

type Ctx = {
  hideBalances: boolean;
  toggleHideBalances: () => void;
  setHideBalances: (v: boolean) => void;
};

const HideBalancesContext = createContext<Ctx | null>(null);

function readHideBalances(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return false;
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function subscribe(onStoreChange: () => void) {
  // Same-tab updates via our setters dispatch this event
  const handler = () => onStoreChange();
  window.addEventListener("comparta-hide-balances", handler);
  // Cross-tab updates
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("comparta-hide-balances", handler);
    window.removeEventListener("storage", handler);
  };
}

function getServerSnapshot() {
  // SSR + first client render must match
  return false;
}

export function HideBalancesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const hideBalances = useSyncExternalStore(
    subscribe,
    readHideBalances,
    getServerSnapshot
  );

  const setHideBalances = useCallback((v: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // no-op
    }
    window.dispatchEvent(new Event("comparta-hide-balances"));
  }, []);

  const toggleHideBalances = useCallback(() => {
    const next = !readHideBalances();
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // no-op
    }
    window.dispatchEvent(new Event("comparta-hide-balances"));
  }, []);

  const value = useMemo<Ctx>(
    () => ({ hideBalances, toggleHideBalances, setHideBalances }),
    [hideBalances, toggleHideBalances, setHideBalances]
  );

  return (
    <HideBalancesContext.Provider value={value}>
      {children}
    </HideBalancesContext.Provider>
  );
}

export function useHideBalances(): Ctx {
  const ctx = useContext(HideBalancesContext);
  if (!ctx) {
    return {
      hideBalances: false,
      toggleHideBalances: () => {},
      setHideBalances: () => {},
    };
  }
  return ctx;
}

export function maskBalance(
  formatted: string,
  hide: boolean,
  keepCurrency = true
): string {
  if (!hide) return formatted;

  const masked = "•••••";
  const value = formatted.trimStart();

  // Common currency symbols.
  // This covers most currencies you are likely to display.
  const currencySymbolRegex =
    /^([$€£¥₹₦₵₺₽₩₫₴₱₲₡₭₮₸₼₾₿₽₺₣₤₥₦₧₨₩₪₫₯₰₱₲₳₴₵₸₺₻₼₽₾₿]|R\$|HK\$|CA\$|A\$|C\$|NZ\$|S\$|CN¥|US\$|JP¥|KR₩|د\.إ|ر\.س|﷼|৳|₭|₮|₸|₼|₾|₿)/;

  const match = value.match(currencySymbolRegex);

  if (match && keepCurrency) {
    return `${match[0]}${masked}`;
  }

  // Also support currency codes such as:
  // USD 1,000.00
  // NGN 1,000.00
  // EUR 1,000.00
  // GBP 1,000.00
  const currencyCodeRegex =
    /^([A-Z]{3})(?:\s+|(?=[0-9]))/;

  const codeMatch = value.match(currencyCodeRegex);

  if (codeMatch && keepCurrency) {
    return `${codeMatch[1]} ${masked}`;
  }

  return masked;
}