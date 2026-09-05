// app/pay/[slug]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatUSDC } from "@/app/invoices/_components/format";
import Image from "next/image";

type UnavailableReason = "NOT_FOUND" | "PAUSED" | "EXPIRED" | "USED_UP";

interface PublicPaymentLink {
  id: string;
  slug: string;
  orgLegalName: string;
  description: string | null;
  type: "FIXED_AMOUNT" | "OPEN_AMOUNT";
  amount: string | null;
  payable: boolean;
  unavailableReason: UnavailableReason | null;
  lastSession: {
    status: "PENDING" | "CONFIRMED" | "FAILED" | "WRONG_AMOUNT_REFUNDED" | "SWEEPING" | null;
    amountPaid: string | null;
    amountExpected: string | null;
    failureReason: string | null;
    confirmedAt: string | null;
  } | null;
}

interface Session {
  id: string;
  method: "WALLET" | "CARD";
  status: "PENDING" | "SWEEPING" | "CONFIRMED" | "FAILED" | "WRONG_AMOUNT_REFUNDED";
  amountExpected: string;
  amountPaid: string | null;
  failureReason: string | null;
}

const UNAVAILABLE_MESSAGE: Record<UnavailableReason, string> = {
  NOT_FOUND: "This payment link doesn't exist.",
  PAUSED: "This payment link isn't accepting payments right now.",
  EXPIRED: "This payment link has expired.",
  USED_UP: "This payment link has already been used.",
};

const POLL_INTERVAL_MS = 4000;
const TERMINAL = new Set(["CONFIRMED", "FAILED", "WRONG_AMOUNT_REFUNDED"]);

export default function PayLinkPage() {
  const params = useParams<{ slug: string }>();
  const [link, setLink] = useState<PublicPaymentLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openAmount, setOpenAmount] = useState("");
  const [starting, setStarting] = useState<"wallet" | "card" | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [walletSession, setWalletSession] = useState<{ payToAddress: string; chain: string; amountExpected: string } | null>(
    null
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingMethod, setPendingMethod] = useState<"wallet" | "card" | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch(`/api/pay/${params.slug}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.paymentLink) {
          setLink(data.paymentLink);
        } else {
          setLoadError(data.error ?? "Failed to load payment link");
        }
      })
      .catch(() => setLoadError("Failed to load payment link"))
      .finally(() => setLoading(false));
  }, [params.slug]);

  // Card path: poll session status
  useEffect(() => {
    if (!sessionId || pendingMethod !== "card") return;

    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch(`/api/pay/${params.slug}/session/${sessionId}`);
        if (!res.ok || stopped) return;
        const data = await res.json();
        setSession(data.session);
        if (TERMINAL.has(data.session.status)) {
          stopped = true;
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // keep polling
      }
    }

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [sessionId, pendingMethod, params.slug]);

  // Wallet path: SSE + polling fallback
  useEffect(() => {
    if (!sessionId || pendingMethod !== "wallet") return;

    let stopped = false;
    const es = new EventSource(`/api/pay/${params.slug}/session/${sessionId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setSession((prev) => ({ ...(prev ?? {}), ...data }) as Session);
      if (TERMINAL.has(data.status)) {
        stopped = true;
        es.close();
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects on transient drops
    };

    const pollId = setInterval(async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/pay/${params.slug}/session/${sessionId}`);
        if (!res.ok || stopped) return;
        const data = await res.json();
        setSession(data.session);
        if (TERMINAL.has(data.session.status)) {
          stopped = true;
          clearInterval(pollId);
          es.close();
        }
      } catch {
        // ignore
      }
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(pollId);
      es.close();
      esRef.current = null;
    };
  }, [sessionId, pendingMethod, params.slug]);

  function resolveAmount(): string | undefined {
    if (!link) return undefined;
    return link.type === "FIXED_AMOUNT" ? undefined : openAmount.trim();
  }

  async function handlePayWithWallet() {
    setStartError(null);
    if (link?.type === "OPEN_AMOUNT" && !openAmount.trim()) {
      setStartError("Enter an amount to pay.");
      return;
    }
    setStarting("wallet");
    try {
      const res = await fetch(`/api/pay/${params.slug}/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: resolveAmount() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStartError(data.error ?? "Could not start checkout");
        return;
      }
      setWalletSession(data.session);
      setSessionId(data.session.paymentLinkPaymentId);
      setPendingMethod("wallet");
    } catch {
      setStartError("Could not start checkout");
    } finally {
      setStarting(null);
    }
  }

  async function handlePayWithCard() {
    setStartError(null);
    if (link?.type === "OPEN_AMOUNT" && !openAmount.trim()) {
      setStartError("Enter an amount to pay.");
      return;
    }
    setStarting("card");
    try {
      const res = await fetch(`/api/pay/${params.slug}/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: resolveAmount() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStartError(data.error ?? "Could not start checkout");
        return;
      }
      // No return-URL hook exists on Circle's hosted checkout session
      // today, so this tab can't be auto-notified when that flow
      // finishes — opening it in a new tab and polling this session's
      // status here is the closest we can get to a closed loop without
      // guessing at an unsupported param.
      window.open(data.session.hostedCheckoutUrl, "_blank", "noopener,noreferrer");
      setSessionId(data.session.paymentLinkPaymentId);
      setPendingMethod("card");
    } catch {
      setStartError("Could not start checkout");
    } finally {
      setStarting(null);
    }
  }

  async function handleCopy() {
    if (!walletSession) return;
    try {
      await navigator.clipboard.writeText(walletSession.payToAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — non-critical, no-op
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F8FB] flex items-start sm:items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-6">
          <Image src="/logo.png" alt="Comparta" height={28} width={100} />
        </div>

        {loading ? (
          <p className="text-center text-sm text-[#7C8CA6]">Loading…</p>
        ) : loadError || !link ? (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-8 text-center">
            <p className="text-sm text-[#7C8CA6]">{loadError ?? "Failed to load payment link"}</p>
          </div>
        ) : !link.payable && link.unavailableReason === "USED_UP" && link.lastSession?.status === "CONFIRMED" ? (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 sm:p-8 space-y-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-emerald-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#0B1E3F]">{link.orgLegalName || "Payment link"}</p>
              <h2 className="text-xl font-semibold text-emerald-700">Payment received. Thank you!</h2>
              {link.description && (
                <p className="text-sm text-[#3E4A6B]">{link.description}</p>
              )}
            </div>
            <div className="rounded-xl bg-[#F7F8FB] p-4 text-left space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-[#7C8CA6]">Amount paid</span>
                <span className="font-semibold text-[#0B1E3F] tabular-nums">
                  {formatUSDC(link.lastSession.amountPaid ?? link.amount ?? "0")}
                </span>
              </div>
              {link.lastSession.confirmedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#7C8CA6]">Confirmed</span>
                  <span className="text-[#0B1E3F]">
                    {new Date(link.lastSession.confirmedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : !link.payable && link.unavailableReason === "EXPIRED" && link.lastSession?.status === "CONFIRMED" ? (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 sm:p-8 space-y-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-emerald-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#0B1E3F]">{link.orgLegalName || "Payment link"}</p>
              <h2 className="text-xl font-semibold text-emerald-700">Payment received. Thank you!</h2>
              {link.description && (
                <p className="text-sm text-[#3E4A6B]">{link.description}</p>
              )}
            </div>
            <div className="rounded-xl bg-[#F7F8FB] p-4 text-left space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-[#7C8CA6]">Amount paid</span>
                <span className="font-semibold text-[#0B1E3F] tabular-nums">
                  {formatUSDC(link.lastSession.amountPaid ?? link.amount ?? "0")}
                </span>
              </div>
              {link.lastSession.confirmedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#7C8CA6]">Confirmed</span>
                  <span className="text-[#0B1E3F]">
                    {new Date(link.lastSession.confirmedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : !link.payable ? (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-[#0B1E3F]">{link.orgLegalName || "Payment link"}</p>
            <p className="text-sm text-[#7C8CA6]">{UNAVAILABLE_MESSAGE[link.unavailableReason ?? "NOT_FOUND"]}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 sm:p-8 space-y-6">
            <div>
              <p className="text-xs font-medium text-[#7C8CA6] mb-1">Pay {link.orgLegalName}</p>
              {link.description && <p className="text-sm text-[#3E4A6B] mb-2">{link.description}</p>}
              {link.type === "FIXED_AMOUNT" ? (
                <p className="text-3xl font-semibold text-[#0B1E3F] tabular-nums">
                  {formatUSDC(link.amount ?? "0")}
                </p>
              ) : (
                <div>
                  <label htmlFor="amount" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
                    Amount (USDC)
                  </label>
                  <input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    value={openAmount}
                    onChange={(e) => setOpenAmount(e.target.value)}
                    disabled={!!sessionId}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-lg text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50"
                  />
                </div>
              )}
            </div>

            {startError && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {startError}
              </div>
            )}

            {session?.status === "CONFIRMED" && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 text-center">
                Payment received. Thank you!
              </div>
            )}
            {session?.status === "SWEEPING" && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 text-center">
                Payment detected - confirming…
              </div>
            )}
            {session?.status === "FAILED" && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 text-center">
                {session.failureReason ?? "This payment failed. Please try again."}
              </div>
            )}
            {session?.status === "WRONG_AMOUNT_REFUNDED" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 text-center">
                The amount received didn&apos;t match what was expected and has been refunded.
              </div>
            )}

            {!sessionId && !session && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handlePayWithWallet}
                  disabled={starting !== null}
                  className="btn-3d"
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
                  {starting === "wallet" ? "Starting…" : "Pay from a wallet"}
                </button>
                <button
                  onClick={handlePayWithCard}
                  disabled={starting !== null}
                  className="btn-3d btn-3d--neutral"
                >
                  {starting === "card" ? "Starting…" : "Pay with card or bank"}
                </button>
              </div>
            )}

            {walletSession && pendingMethod === "wallet" && (session === null || session.status === "PENDING") && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[#0B1E3F]">Send USDC to complete payment</p>
                <div className="flex items-center gap-2 rounded-xl border border-[#E5E9F2] bg-[#F7F8FB] px-4 py-3">
                  <span className="text-sm font-mono text-[#0B1E3F] truncate flex-1">
                    {walletSession.payToAddress}
                  </span>
                  <button onClick={handleCopy} className="btn-3d btn-3d--sm btn-3d--neutral shrink-0">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-[#7C8CA6]">
                  Send exactly {formatUSDC(walletSession.amountExpected)} on {walletSession.chain.replace(/_/g, " ")}.
                  This page updates automatically once payment is received.
                </p>
              </div>
            )}

            {pendingMethod === "card" && (session === null || session.status === "PENDING") && (
              <p className="text-sm text-[#7C8CA6] text-center">
                Complete your payment in the tab that just opened. This page will update automatically once it&apos;s
                confirmed.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}