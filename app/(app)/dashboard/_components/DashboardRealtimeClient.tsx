"use client";
// app/(app)/dashboard/_components/DashboardRealtimeClient.tsx
//
// Client-side wrapper for the dashboard that:
//   1. Opens an SSE connection to /api/realtime/stream
//   2. On `payment_received` events, re-fetches dashboard data and
//      re-renders balance / KPI / bucket / activity children
//   3. Plays /sounds/tone.mp3 at 50% volume on each inbound payment
//
// Data flow:
//   Server render -> this component receives initial `summary` prop
//                    -> EventSource subscribes to SSE
//                    -> payment_received arrives
//                    -> fetch /api/dashboard/summary
//                    -> setState to re-render + play tone

import { useEffect, useRef, useState, useCallback } from "react";
import type { DashboardSummary, DashboardFiat } from "@/lib/insights/dashboard/getDashboardSummary";
import KpiCards from "./KpiCards";
import BucketCards from "./BucketCards";
import ActivityFeed from "./ActivityFeed";
import MaskedTotalBalance from "./MaskedTotalBalance";
import QuickActions from "./QuickActions";
import { KybBanner } from "../../_components/Kyb";
import Link from "next/link";
import type { KybStatus } from "@/app/generated/prisma/client";
import { useHideBalances, maskBalance } from "../../_components/HideBalancesProvider";


type Wallet = { arcAddress: string; chain: string | null } | null;

type Props = {
  initialSummary: DashboardSummary;
  kybStatus: KybStatus;
  financialActionsDisabled: boolean;
  wallet: Wallet;
};

function formatBalanceHero(decimalString: string): string {
  const [rawWhole, rawFrac = ""] = decimalString.split(".");
  const whole = rawWhole || "0";

  const trimmedFrac = rawFrac.replace(/0+$/, "");
  if (!trimmedFrac) return `${whole}.00`;

  const MIN_FRAC = 2;
  const displayFrac =
    trimmedFrac.length < MIN_FRAC
      ? trimmedFrac.padEnd(MIN_FRAC, "0")
      : trimmedFrac;

  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${wholeGrouped}.${displayFrac}`;
}

function formatFiatHero(decimalString: string, symbol: string | null): string {
  const [rawWhole, rawFrac = ""] = decimalString.split(".");
  const whole = rawWhole || "0";
  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = rawFrac ? `.${rawFrac}` : ".00";
  const sym = symbol ?? "";
  return `${sym}${wholeGrouped}${frac}`;
}

// function FiatHeroPrimary({ fiat }: { fiat: DashboardFiat }) {
//   const { hideBalances } = useHideBalances();
//   if (!fiat.supported || !fiat.amount || !fiat.rate) {
//     return null;
//   }
//   const formatted = formatFiatHero(fiat.amount, fiat.symbol);
//   const display = maskBalance(formatted, hideBalances, true);
//   return (
//     <div className="flex items-center gap-3">
//       <MaskedTotalBalance formatted={display} />
//     </div>
//   );
// }

function UsdcHeroSubLine({ usdc, fiat }: { usdc: string; fiat: DashboardFiat }) {
  const { hideBalances } = useHideBalances();
  if (fiat.supported && fiat.amount && fiat.rate) {
    const statusHint =
      fiat.rateStatus === "stale" ? (
        <span className="ml-2 text-[9px] uppercase tracking-wider text-[#B08800] bg-[#FFF7D9] px-1.5 py-0.5 rounded">
          rate stale
        </span>
      ) : null;
    const masked = maskBalance(
      `${formatBalanceHero(usdc)} USDC`,
      hideBalances,
      true
    );
    return (
      <p className="text-sm text-[#7C8CA6] mt-1.5">
        {/* <span className="mr-1">≈</span>
        <span className="font-medium text-[#0B1E3F]">{masked}</span>
        {statusHint} */}
      </p>
    );
  }
  return null;
}

export default function DashboardRealtimeClient({
  initialSummary,
  kybStatus,
  financialActionsDisabled,
  wallet,
}: Props) {
  const [summary, setSummary] = useState<DashboardSummary>(initialSummary);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/dashboard/summary", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.ok) {
        const fresh = (await res.json()) as DashboardSummary;
        setSummary(fresh);
      }
    } catch (err) {
      console.error("[dashboard] failed to refresh summary", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const playTone = useCallback(() => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio("/sounds/tone.mp3");
        audioRef.current.volume = 0.5;
      } else {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      void audioRef.current.play().catch((err) => {
        console.warn("[dashboard] tone play blocked (user gesture needed?):", err);
      });
    } catch (err) {
      console.warn("[dashboard] failed to initialize tone audio:", err);
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      es = new EventSource("/api/realtime/stream", { withCredentials: true });

      es.addEventListener("payment_received", (ev) => {
        let data: unknown;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        console.log("[dashboard] payment_received event", data);
        void refreshData();
        playTone();
      });

      es.addEventListener("error", () => {
        console.warn("[dashboard] SSE error - will auto-reconnect");
      });
    }

    connect();

    return () => {
      closed = true;
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [refreshData, playTone]);

  const fiatSupported =
    summary.fiat.supported && !!summary.fiat.amount && !!summary.fiat.rate;
  const heroPrimary = fiatSupported
    ? summary.fiat.amount!
    : summary.kpis.totalBalance;
  const heroSymbol = fiatSupported ? summary.fiat.symbol : "$";
  const heroFormatted = fiatSupported
    ? formatFiatHero(heroPrimary, heroSymbol)
    : formatBalanceHero(heroPrimary);

  return (
    <div className="space-y-6">
      <KybBanner status={kybStatus} />

      <div className="md:mt-5 relative">
        <p className="md:text-sm text-xs font-medium text-[#7C8CA6] mb-2">Total balance</p>
        <div className="flex items-center gap-3">
          <MaskedTotalBalance formatted={heroFormatted} />
          {isRefreshing && (
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-[#7C8CA6] border-t-transparent" />
          )}
        </div>
        {fiatSupported ? (
          <UsdcHeroSubLine usdc={summary.kpis.totalBalance} fiat={summary.fiat} />
        ) : null}
      </div>

      <QuickActions disabled={financialActionsDisabled} wallet={wallet} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <KpiCards kpis={summary.kpis} />
        <BucketCards buckets={summary.buckets} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#0B1E3F]">Recent activity</h2>
          <Link href="/wallet/transfers" className="text-sm font-medium text-[#2A5CE6] hover:underline">
            See all
          </Link>
        </div>
        <ActivityFeed items={summary.activity} />
      </div>
    </div>
  );
}
