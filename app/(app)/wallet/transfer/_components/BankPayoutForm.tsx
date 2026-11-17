// app/(app)/wallet/transfer/_components/BankPayoutForm.tsx
//
// USDC → naira payout. Pick a saved beneficiary (or verify a new one),
// choose a bucket and amount, review, then confirm. The server opens a Paj
// offramp order, sends USDC to the one-off funding address through the normal
// send path, and Paj pays the bank. Chain support comes from the server's
// availability response, so nothing here hardcodes Arc.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  Landmark,
  Loader2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { formatNaira, maskAccountNumber } from "@/lib/config/pajChains";

interface Bucket {
  id: string;
  name: string;
  balance: string;
}

interface Availability {
  available: boolean;
  reason: string | null;
  currency: string;
  chain: { id: string; label: string; tokenSymbol: string } | null;
}

interface BankAccount {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  evmAddress: string | null;
}

interface Bank {
  code: string;
  name: string;
  logo: string | null;
}

interface Order {
  id: string;
  status: "INIT" | "PROCESSING" | "COMPLETED" | "ERROR";
  tokenAmount: string | null;
  fiatAmount: string | null;
  rate: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  failureReason: string | null;
}

type Step = "form" | "review" | "success";

const QUICK_AMOUNTS = [10, 25, 50, 100];

function sanitizeAmount(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

export default function BankPayoutForm({
  buckets,
  disabled,
}: {
  buckets: Bucket[];
  disabled: boolean;
}) {
  const router = useRouter();

  const [availability, setAvailability] = useState<Availability | null>(null);
  const [offRampRate, setOffRampRate] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fromLedgerAccountId, setFromLedgerAccountId] = useState(
    buckets[0]?.id ?? ""
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);

  // New-beneficiary form state.
  const [addingAccount, setAddingAccount] = useState(false);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

  // One key per logical payout. A failed attempt is marked FAILED server-side
  // so retrying with the same key is safe; reset() mints a new key so a
  // second payout is never mistaken for a replay of the first.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );

  useEffect(() => {
    let cancelled = false;
    const read = (res: Response) =>
      res.json().then((data) => ({ ok: res.ok, data }));

    Promise.all([
      fetch("/api/paj/availability").then(read),
      fetch("/api/paj/rates").then(read),
      fetch("/api/paj/bank-accounts").then(read),
      fetch("/api/paj/banks").then(read),
    ])
      .then(([availabilityRes, ratesRes, accountsRes, banksRes]) => {
        if (cancelled) return;

        if (!availabilityRes.ok) {
          setLoadError(
            availabilityRes.data.error ?? "Bank payouts are unavailable."
          );
          return;
        }
        setAvailability(availabilityRes.data);

        if (!availabilityRes.data.available) {
          setLoadError(
            availabilityRes.data.reason ?? "Bank payouts are unavailable."
          );
          return;
        }

        if (ratesRes.ok) setOffRampRate(ratesRes.data.offRampRate);
        else setLoadError(ratesRes.data.error ?? "Couldn't load today's rate.");

        if (accountsRes.ok) {
          const list: BankAccount[] = accountsRes.data.bankAccounts ?? [];
          setAccounts(list);
          setSelectedAccountId((current) => current ?? list[0]?.id ?? null);
          if (list.length === 0) setAddingAccount(true);
        }

        if (banksRes.ok) setBanks(banksRes.data.banks ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load bank payouts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const amountNumber = Number(amount);
  const validAmount = Number.isFinite(amountNumber) && amountNumber > 0;
  const fiatEstimate =
    validAmount && offRampRate ? amountNumber * offRampRate : null;
  const fromBucket = buckets.find((b) => b.id === fromLedgerAccountId) ?? null;
  const balanceNumber = Number(fromBucket?.balance ?? "0");
  const insufficient =
    validAmount && Number.isFinite(balanceNumber) && amountNumber > balanceNumber;

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    if (!bankCode) {
      setVerifyError("Choose a bank.");
      return;
    }
    if (!/^\d{10}$/.test(accountNumber)) {
      setVerifyError("Enter a 10-digit account number.");
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch("/api/paj/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCode, accountNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data.error ?? "Couldn't verify that account.");
        return;
      }
      const created: BankAccount = data.bankAccount;
      setAccounts((prev) => [
        created,
        ...prev.filter((a) => a.id !== created.id),
      ]);
      setSelectedAccountId(created.id);
      setAddingAccount(false);
      setBankCode("");
      setAccountNumber("");
    } catch {
      setVerifyError("Couldn't verify that account.");
    } finally {
      setVerifying(false);
    }
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fromLedgerAccountId) {
      setError("Choose a bucket to pay from.");
      return;
    }
    if (!selectedAccountId) {
      setError("Choose or add a bank account.");
      return;
    }
    if (!validAmount) {
      setError("Enter a valid USDC amount.");
      return;
    }
    if (insufficient) {
      setError("That's more than this bucket holds.");
      return;
    }
    setStep("review");
  }

  async function handleConfirm() {
    if (!selectedAccount) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/paj/offramp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          fromLedgerAccountId,
          bankAccountId: selectedAccount.id,
          amount: amount.trim(),
          memo: memo.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start the payout.");
        setStep("form");
        return;
      }
      setOrder(data.order);
      setStep("success");
      router.refresh();
    } catch {
      setError("Couldn't start the payout. Please try again.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setOrder(null);
    setAmount("");
    setMemo("");
    setStep("form");
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#7C8CA6]">
        <Loader2 size={16} className="animate-spin" /> Loading bank payouts…
      </div>
    );
  }

  if (loadError || !availability?.available) {
    return (
      <div className="rounded-xl border border-[#E5E9F2] bg-[#FAF9F6] px-4 py-5 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#7C8CA6]">
          <Landmark size={18} />
        </div>
        <p className="text-sm font-medium text-[#0B1E3F]">
          {loadError ?? availability?.reason ?? "Bank payouts are unavailable."}
        </p>
      </div>
    );
  }

  if (step === "success" && order) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-5 text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-600">
            <CheckCircle2 size={22} />
          </div>
          <p className="text-sm font-semibold text-emerald-800">
            Payout started
          </p>
          <p className="mt-1 text-[11px] text-emerald-700">
            {order.tokenAmount ?? amount} USDC is on its way.{" "}
            {formatNaira(order.fiatAmount ?? fiatEstimate ?? 0)} will land in
            your bank shortly.
          </p>
        </div>

        <div className="rounded-xl border border-[#E5E9F2] p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#7C8CA6]">To</span>
            <span className="text-right font-semibold text-[#0B1E3F]">
              {order.accountName ?? selectedAccount?.accountName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#7C8CA6]">Bank</span>
            <span className="font-semibold text-[#0B1E3F]">
              {order.bankName ?? selectedAccount?.bankName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#7C8CA6]">Account</span>
            <span className="font-mono text-[#0B1E3F]">
              {order.accountNumber ?? selectedAccount?.accountNumber}
            </span>
          </div>
        </div>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm font-semibold text-[#0B1E3F] hover:bg-[#F7F8FB] transition-colors"
          >
            Send another
          </button>
          <Link
            href="/wallet/ramp"
            className="btn-3d flex-1 text-center"
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
            View payouts
          </Link>
        </div>
      </div>
    );
  }

  if (step === "review" && selectedAccount) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setStep("form")}
          disabled={submitting}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C8CA6] hover:text-[#0B1E3F] transition-colors disabled:opacity-50"
        >
          <ChevronLeft size={14} /> Back
        </button>

        <div className="rounded-xl border border-[#E5E9F2] p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FAFBFD] text-[#2A5CE6]">
              <Landmark size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#0B1E3F]">
                {selectedAccount.accountName}
              </p>
              <p className="truncate text-[11px] text-[#7C8CA6]">
                {selectedAccount.bankName} ·{" "}
                {maskAccountNumber(selectedAccount.accountNumber)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#F2F4F8] pt-3">
            <span className="text-xs text-[#7C8CA6]">You send</span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B1E3F] tabular-nums">
              <Image
                src="/usdc.png"
                alt="USDC"
                width={14}
                height={14}
                className="rounded-full"
              />
              {amount} USDC
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#7C8CA6]">They receive</span>
            <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
              {formatNaira(fiatEstimate ?? 0)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#7C8CA6]">From</span>
            <span className="text-sm font-medium text-[#0B1E3F]">
              {buckets.find((b) => b.id === fromLedgerAccountId)?.name ??
                "Bucket"}
            </span>
          </div>
        </div>

        {memo.trim() && (
          <p className="rounded-xl border border-[#E5E9F2] px-4 py-3 text-xs text-[#3E4A6B]">
            <span className="font-semibold text-[#0B1E3F]">Note:</span>{" "}
            {memo.trim()}
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="btn-3d w-full disabled:opacity-60"
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
          {submitting ? "Sending…" : `Send ${amount || "0"} USDC`}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#7C8CA6]">
          <ShieldCheck size={12} /> Paid out to {selectedAccount.bankName}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleReview} className="space-y-5">
      {error && (
        <div
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[#0B1E3F]">
          Pay to
        </label>

        {accounts.length > 0 && (
          <div className="space-y-2">
            {accounts.map((account) => {
              const active = selectedAccountId === account.id;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setSelectedAccountId(account.id)}
                  disabled={disabled}
                  className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                    active
                      ? "border-[#2A5CE6] bg-[#F7FAFF]"
                      : "border-[#E5E9F2] bg-white hover:bg-[#F7F8FB]"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      active
                        ? "bg-[#2A5CE6] text-white"
                        : "bg-[#FAFBFD] text-[#2A5CE6]"
                    }`}
                  >
                    <Landmark size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[#0B1E3F]">
                      {account.accountName}
                    </span>
                    <span className="block truncate text-[11px] text-[#7C8CA6]">
                      {account.bankName} ·{" "}
                      {maskAccountNumber(account.accountNumber)}
                    </span>
                  </span>
                  {active && (
                    <Check
                      size={16}
                      strokeWidth={3}
                      className="shrink-0 text-[#2A5CE6]"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {addingAccount ? (
          <div className="rounded-xl border border-[#E5E9F2] p-4 space-y-3">
            <p className="text-xs font-semibold text-[#0B1E3F]">
              New bank account
            </p>
            <select
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
              disabled={disabled || verifying}
              className="w-full rounded-xl border border-[#E5E9F2] px-3 py-2.5 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
            >
              <option value="">Choose a bank</option>
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
            {banks.length === 0 && (
              <p className="text-xs text-amber-700">
                Could not load the bank list. Try again in a moment.
              </p>
            )}
            <input
              type="text"
              inputMode="numeric"
              value={accountNumber}
              onChange={(e) =>
                setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              disabled={disabled || verifying}
              placeholder="10-digit account number"
              className="w-full rounded-xl border border-[#E5E9F2] px-3 py-2.5 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
            />
            {verifyError && (
              <p className="text-xs font-medium text-red-600">{verifyError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddAccount}
                disabled={disabled || verifying}
                className="flex-1 rounded-xl bg-[#2A5CE6] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#2450d1] transition-colors disabled:opacity-50"
              >
                {verifying ? "Verifying…" : "Verify & save"}
              </button>
              {accounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAddingAccount(false);
                    setVerifyError(null);
                  }}
                  disabled={verifying}
                  className="rounded-xl border border-[#E5E9F2] px-3 py-2.5 text-sm font-semibold text-[#0B1E3F] hover:bg-[#F7F8FB] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingAccount(true)}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2A5CE6] hover:underline disabled:opacity-50"
          >
            <Plus size={13} /> Add a bank account
          </button>
        )}
      </div>

      <div>
        <label
          htmlFor="payout-amount"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          Amount (USDC)
        </label>
        <input
          id="payout-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
          disabled={disabled}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_AMOUNTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(String(value))}
              disabled={disabled}
              className="rounded-full border border-[#E5E9F2] bg-white px-3 py-1 text-[11px] font-semibold text-[#3E4A6B] hover:border-[#2A5CE6] hover:text-[#2A5CE6] transition-colors disabled:opacity-50"
            >
              {value} USDC
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-[#E5EEFF] bg-[#F7FAFF] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-[#3E4A6B]">They receive</span>
            <span className="text-base font-semibold text-[#0B1E3F] tabular-nums">
              {formatNaira(fiatEstimate ?? 0)}
            </span>
          </div>
          {offRampRate !== null && (
            <p className="mt-1 text-[11px] text-[#7C8CA6]">
              Rate: 1 USDC ≈ {formatNaira(offRampRate)}
            </p>
          )}
        </div>
        {insufficient && (
          <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            {fromBucket?.name ?? "This bucket"} holds {fromBucket?.balance ?? "0"}{" "}
            USDC. Lower the amount or pay from another bucket.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="payout-bucket"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          Pay from
        </label>
        <select
          id="payout-bucket"
          value={fromLedgerAccountId}
          onChange={(e) => setFromLedgerAccountId(e.target.value)}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {buckets.map((bucket) => (
            <option key={bucket.id} value={bucket.id}>
              {bucket.name} · {bucket.balance} USDC
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="payout-memo"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          Note <span className="font-normal text-[#7C8CA6]">(optional)</span>
        </label>
        <input
          id="payout-memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={disabled}
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={disabled || !selectedAccountId || !validAmount || insufficient}
        className="btn-3d w-full disabled:opacity-60"
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
        Continue <ArrowRight size={15} className="inline -mt-0.5 ml-1" />
      </button>
    </form>
  );
}
