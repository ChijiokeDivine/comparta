"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "comparta.hideBalances";

type Ctx = {
  hideBalances: boolean;
  toggleHideBalances: () => void;
  setHideBalances: (v: boolean) => void;
};

const HideBalancesContext = createContext<Ctx | null>(null);

export function HideBalancesProvider({ children }: { children: React.ReactNode }) {
  const [hideBalances, setHideBalancesState] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        setHideBalancesState(raw === "1" || raw === "true");
      }
    } catch {
      // ignore storage access errors
    } finally {
      setMounted(true);
    }
  }, []);

  const setHideBalances = useCallback((v: boolean) => {
    setHideBalancesState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // no-op
    }
  }, []);

  const toggleHideBalances = useCallback(() => {
    setHideBalancesState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // no-op
      }
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({ hideBalances, toggleHideBalances, setHideBalances }),
    [hideBalances, toggleHideBalances, setHideBalances]
  );

  return (
    <HideBalancesContext.Provider value={value}>
      {mounted ? children : children}
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
  keepCurrency = false
): string {
  if (!hide) return formatted;
  const hasDollar = formatted.startsWith("$");
  const masked = "•••••";
  if (hasDollar && keepCurrency) return `$${masked}`;
  if (hasDollar) return `$${masked}`;
  return masked;
}
