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
  _keepCurrency = false
): string {
  if (!hide) return formatted;
  const hasDollar = formatted.trimStart().startsWith("$");
  const masked = "•••••";
  return hasDollar ? `$${masked}` : masked;
}