// app/(app)/savings/[ledgerAccountId]/SavingsBucketOverview.tsx
"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface YieldPositionSummary {
  id: string;
  usycAmount: string;
  usdcEquivalentAtDeploy: string;
  currentUsdcValue: string;
  accruedYield: string;
  status: string;
  deployedAt: string;
}

interface PendingRedemption {
  id: string;
  usycAmountRequested: string;
  status: string;
  createdAt: string;
}

interface SavingsBucketData {
  ledgerAccountId: string;
  isYieldEnabled: boolean;
  yieldAllocationPct: number | null;
  minimumBalanceFloor: string;
  liquidBalance: string;
  deployedBalance: string;
  totalBalance: string;
  accruedYieldToDate: string;
  currentApyBps: number;
  currentApyAsOf: string;
  projectedMonthlyYield: string;
  activePositions: YieldPositionSummary[];
  pendingRedemptions: PendingRedemption[];
}

export default function SavingsBucketOverview({
  ledgerAccountId,
  canManage,
  kybApproved,
}: {
  ledgerAccountId: string;
  canManage: boolean;
  kybApproved: boolean;
}) {
  const [data, setData] = useState<SavingsBucketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [isYieldEnabled, setIsYieldEnabled] = useState(false);
  const [yieldAllocationPct, setYieldAllocationPct] = useState("80");
  const [minimumBalanceFloor, setMinimumBalanceFloor] = useState("0");
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerAccountId]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/savings/${ledgerAccountId}`);
      const body = await res.json();
      if (!res.ok) {
        setLoadError(
          body.error === "Request failed"
            ? "Live yield data is temporarily unavailable. This bucket's liquid balance is unaffected."
            : body.error ?? "Failed to load this bucket's savings overview"
        );
        return;
      }
      setData(body.savingsBucket);
      setIsYieldEnabled(body.savingsBucket.isYieldEnabled);
      setYieldAllocationPct(String(body.savingsBucket.yieldAllocationPct ?? 80));
      setMinimumBalanceFloor(body.savingsBucket.minimumBalanceFloor ?? "0");
    } catch {
      setLoadError("Failed to load this bucket's savings overview");
    } finally {
      setLoading(false);
    }
  }

  async function handleRedeem(all: boolean) {
    setActionError(null);
    setRedeeming(true);
    try {
      const res = await fetch(`/api/savings/${ledgerAccountId}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? {} : { usycAmount: redeemAmount.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "Redemption failed");
        return;
      }
      setRedeemAmount("");
      await load();
    } catch {
      setActionError("Redemption failed");
    } finally {
      setRedeeming(false);
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/savings/${ledgerAccountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isYieldEnabled,
          ...(isYieldEnabled ? { yieldAllocationPct: yieldAllocationPct.trim() } : {}),
          minimumBalanceFloor: minimumBalanceFloor.trim() || "0",
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "Could not save yield settings");
        return;
      }
      setConfigOpen(false);
      await load();
    } catch {
      setActionError("Could not save yield settings");
    } finally {
      setSavingConfig(false);
    }
  }

  if (loading) return <div className="text-sm text-[#7C8CA6]">Loading…</div>;

  if (loadError) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        {loadError}
      </div>
    );
  }
  if (!data) return null;

  const apyPercent = (data.currentApyBps / 100).toFixed(2);

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {actionError}
        </div>
      )}

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium text-[#7C8CA6] mb-1">Total balance</p>
            <p className="text-3xl font-semibold text-[#0B1E3F] tabular-nums">{formatMoney(data.totalBalance)}</p>
            <p className="text-sm text-[#7C8CA6] mt-1">
              {formatMoney(data.liquidBalance)} liquid · {formatMoney(data.deployedBalance)} deployed
            </p>
          </div>
          {data.isYieldEnabled ? (
            <StatusPill value="ACTIVE" label={`Yield on · ${data.yieldAllocationPct}%`} />
          ) : (
            <span className="text-xs text-[#7C8CA6]">Yield off</span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-[#7C8CA6] mb-1">Accrued yield</p>
            <p className="text-[#0B1E3F] font-semibold tabular-nums">{formatMoney(data.accruedYieldToDate)}</p>
          </div>
          <div>
            <p className="text-[#7C8CA6] mb-1">Current APY</p>
            <p className="text-[#0B1E3F] font-semibold">{apyPercent}%</p>
          </div>
          <div>
            <p className="text-[#7C8CA6] mb-1">Projected / mo</p>
            <p className="text-[#0B1E3F] font-semibold tabular-nums">{formatMoney(data.projectedMonthlyYield)}</p>
          </div>
        </div>

        {canManage && (
          <div className="pt-4 border-t border-[#F2F4F8]">
            {!configOpen ? (
              <button onClick={() => setConfigOpen(true)} className="text-sm font-medium text-[#2A5CE6] hover:underline">
                Configure yield settings
              </button>
            ) : (
              <form onSubmit={handleSaveConfig} className="space-y-4">
                <label className="flex items-center gap-2 text-sm text-[#0B1E3F]">
                  <input
                    type="checkbox"
                    checked={isYieldEnabled}
                    onChange={(e) => setIsYieldEnabled(e.target.checked)}
                    disabled={!kybApproved}
                    className="w-4 h-4"
                  />
                  Enable yield on this bucket
                </label>

                {isYieldEnabled && (
                  <div>
                    <label htmlFor="alloc" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
                      Allocation % of every sweep deployed to USYC
                    </label>
                    <input
                      id="alloc"
                      type="number"
                      min={0}
                      max={100}
                      value={yieldAllocationPct}
                      onChange={(e) => setYieldAllocationPct(e.target.value)}
                      disabled={!kybApproved}
                      className="w-28 px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="floor" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
                    Minimum balance floor (USDC, never swept below this)
                  </label>
                  <input
                    id="floor"
                    type="text"
                    inputMode="decimal"
                    value={minimumBalanceFloor}
                    onChange={(e) => setMinimumBalanceFloor(e.target.value)}
                    disabled={!kybApproved}
                    className="w-40 px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!kybApproved || savingConfig}
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
                    {savingConfig ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setConfigOpen(false)} className="btn-3d btn-3d--sm btn-3d--neutral">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {canManage && Number(data.deployedBalance) > 0 && (
          <div className="pt-4 border-t border-[#F2F4F8] space-y-3">
            <p className="text-xs font-semibold text-[#7C8CA6]">Redeem to liquid</p>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                inputMode="decimal"
                value={redeemAmount}
                onChange={(e) => setRedeemAmount(e.target.value)}
                placeholder="USYC amount"
                disabled={!kybApproved}
                className="w-40 px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
              />
              <button
                onClick={() => handleRedeem(false)}
                disabled={!kybApproved || redeeming || !redeemAmount.trim()}
                className="btn-3d btn-3d--sm btn-3d--neutral"
              >
                {redeeming ? "Requesting…" : "Redeem amount"}
              </button>
              <button
                onClick={() => handleRedeem(true)}
                disabled={!kybApproved || redeeming}
                className="btn-3d btn-3d--sm btn-3d--neutral"
              >
                Redeem all
              </button>
            </div>
          </div>
        )}
      </div>

      {data.pendingRedemptions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[#0B1E3F] mb-3">Pending redemptions</h2>
          <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
            {data.pendingRedemptions.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-[#0B1E3F]">{r.usycAmountRequested} USYC</p>
                  <p className="text-xs text-[#7C8CA6]">Requested {formatDate(r.createdAt)}</p>
                </div>
                <StatusPill value={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {data.activePositions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[#0B1E3F] mb-3">Active positions</h2>
          <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
            {data.activePositions.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-[#0B1E3F]">{p.usycAmount} USYC</p>
                  <p className="text-xs text-[#7C8CA6]">Deployed {formatDate(p.deployedAt)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                    {formatMoney(p.currentUsdcValue)}
                  </p>
                  <p className="text-xs text-emerald-600 tabular-nums">+{formatMoney(p.accruedYield)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}