"use client";

// app/components/onramp/OnrampPanel.tsx
//
// The card & bank ("buy USDC with fiat") half of the deposit flow.
//
// It owns the whole Onramp lifecycle for one wallet:
//   1. POST /api/onramp/sessions to mint a short-lived session (the server
//      verifies the signed-in user and that the destination address belongs
//      to their organization).
//   2. Mount the hosted widget as an inline iframe.
//   3. Surface lifecycle events as small inline notices and ask the parent
//      to refresh balances once a deposit settles.
//   4. Close the widget on unmount / retry, and re-mint automatically when
//      a session expires.
//
// The widget is deliberately Arc + USDC only, matching the rest of the app.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, RotateCcw } from "lucide-react";
import { AppKit, KitError } from "@circle-fin/app-kit";
import {
  ONRAMP_CHAIN_ID,
  ONRAMP_DESTINATION_CHAIN,
  ONRAMP_WIDGET_BASE_URL,
} from "@/lib/config/clientChains";

type Phase = "preparing" | "ready" | "error";
type Notice = { tone: "info" | "success" | "error"; message: string } | null;

interface OnrampPanelProps {
  appUserId: string;
  destinationAddress: string;
  onDepositSubmitted?: () => void;
  onDepositSettled?: () => void;
  className?: string;
}

// One AppKit instance per browser tab. The SDK is cheap to reuse and keeps
// its own postMessage listeners scoped to the widgets it created.
let clientKit: AppKit | null = null;

function getClientKit(): AppKit {
  if (!clientKit) {
    clientKit = new AppKit({
      onramp: { widgetBaseUrl: ONRAMP_WIDGET_BASE_URL },
    });
  }
  return clientKit;
}

function errorMessage(error: unknown): string {
  if (error instanceof KitError) {
    if (error.type === "RATE_LIMIT") {
      return "Too many attempts. Please wait a moment and try again.";
    }
    if (error.type === "NETWORK" || error.type === "SERVICE" || error.type === "RPC") {
      return "The payment provider is temporarily unavailable. Please try again.";
    }
    if (error.type === "INPUT") {
      return "We couldn't start the checkout. Please try again.";
    }
  }
  return "We couldn't start the card or bank checkout. Please try again.";
}

function notCompletedMessage(code: string): Notice {
  switch (code) {
    case "CANCELED_BY_CUSTOMER":
      return null;
    case "SESSION_TIMEOUT":
      return { tone: "error", message: "Your checkout session expired. Start a new one below." };
    case "NO_PAYMENT_OPTIONS":
      return {
        tone: "error",
        message: "No card or bank options are available for your region right now.",
      };
    case "CUSTOMER_PENDING_REVIEW":
      return {
        tone: "info",
        message: "Your identity review is still pending. You'll be able to finish the purchase once it's approved.",
      };
    case "CUSTOMER_REJECTED":
      return {
        tone: "error",
        message: "The identity check could not be completed, so this purchase can't go ahead.",
      };
    case "PAYMENT_PROVIDER_ERROR":
      return {
        tone: "error",
        message: "The payment provider ran into a problem. No charge was made — please try again.",
      };
    default:
      return {
        tone: "error",
        message: "The deposit wasn't completed. You can try again below.",
      };
  }
}

export default function OnrampPanel({
  appUserId,
  destinationAddress,
  onDepositSubmitted,
  onDepositSettled,
  className = "",
}: OnrampPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const submittedRef = useRef(onDepositSubmitted);
  const settledRef = useRef(onDepositSettled);

  const [phase, setPhase] = useState<Phase>("preparing");
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    submittedRef.current = onDepositSubmitted;
  }, [onDepositSubmitted]);

  useEffect(() => {
    settledRef.current = onDepositSettled;
  }, [onDepositSettled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !appUserId || !destinationAddress) return;

    const kit = getClientKit();
    let cancelled = false;
    let widget: { close: () => void } | null = null;

    function mintSession() {
      return kit.onramp.fetchSession({
        url: "/api/onramp/sessions",
        body: {
          appUserId,
          destinationAddress,
          destinationChain: ONRAMP_DESTINATION_CHAIN,
          assets: { pairs: [{ token: "USDC", chain: ONRAMP_CHAIN_ID }] },
        },
      });
    }

    function mount(session: Awaited<ReturnType<typeof mintSession>>) {
      if (cancelled || !container) return;

      // Replace any previous widget in the same slot.
      widget?.close();

      widget = kit.onramp.mountIframe({
        session,
        container,
        title: "Comparta card and bank checkout",
        onInitializationSuccess: () => {
          if (!cancelled) setPhase("ready");
        },
        onInitializationError: ({ code }) => {
          if (cancelled) return;
          setPhase("error");
          setNotice({
            tone: "error",
            message:
              code === "INVALID_SESSION_TOKEN"
                ? "Your checkout session expired. Please retry."
                : "The checkout didn't load. Check your connection or content blockers, then retry.",
          });
        },
        onDepositSubmitted: () => {
          setNotice({
            tone: "info",
            message:
              "Payment submitted. USDC will appear in your wallet once the provider settles it.",
          });
          submittedRef.current?.();
        },
        onDepositSettled: () => {
          setNotice({
            tone: "success",
            message: "Deposit settled. Your balance will refresh in a moment.",
          });
          settledRef.current?.();
        },
        onDepositNotCompleted: ({ code }) => {
          // A cancelled checkout is a normal outcome; don't shout about it.
          const next = notCompletedMessage(code);
          if (next) setNotice(next);
        },
        onSessionExpired: async () => {
          try {
            const fresh = await mintSession();
            if (!cancelled) {
              setNotice(null);
              setPhase("preparing");
              mount(fresh);
            }
          } catch (error) {
            if (!cancelled) {
              setPhase("error");
              setNotice({ tone: "error", message: errorMessage(error) });
            }
          }
        },
        onHandlerError: (error) => {
          console.error("[onramp] widget handler failed", error);
        },
      });
    }

    void (async () => {
      setPhase("preparing");
      setNotice(null);
      try {
        const session = await mintSession();
        if (!cancelled) mount(session);
      } catch (error) {
        if (cancelled) return;
        setPhase("error");
        setNotice({ tone: "error", message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
      widget?.close();
      widget = null;
    };
  }, [appUserId, destinationAddress, attempt]);

  const isLoading = phase === "preparing";
  const hasError = phase === "error";

  return (
    <div className={className}>
      {notice && (
        <div
          className={`mb-3 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-xs leading-relaxed ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : notice.tone === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-[#E5EEFF] bg-[#F7F9FF] text-[#3E4A6B]"
          }`}
          role="status"
        >
          {notice.tone === "success" ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : notice.tone === "error" ? (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={15} className="mt-0.5 shrink-0" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      <div
        className="relative w-full overflow-hidden rounded-xl border border-[#E5E9F2] bg-white"
        // Cross-origin iframes cannot size themselves; the container must
        // have an explicit, non-zero height or the widget collapses to 0px.
        style={{ height: "min(680px, calc(100vh - 230px))" }}
      >
        <div ref={containerRef} className="h-full w-full" />

        {isLoading && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/90">
            <Loader2 size={22} className="animate-spin text-[#2A5CE6]" />
            <p className="text-sm font-medium text-[#0B1E3F]">
              Preparing secure checkout…
            </p>
            <p className="text-xs text-[#7C8CA6]">
              Card, Apple Pay, Google Pay and bank transfer
            </p>
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/95 px-6 text-center">
            <AlertCircle size={22} className="text-red-500" />
            <p className="text-sm font-medium text-[#0B1E3F]">
              Checkout couldn&apos;t start
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-[#7C8CA6]">
              This can happen if the provider is briefly unavailable or the page
              lost its connection.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#2A5CE6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2450d1] transition-colors"
            >
              <RotateCcw size={13} /> Try again
            </button>
          </div>
        )}
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-[#7C8CA6] hidden">
        Purchases are processed by Circle&apos;s Onramp. Identity verification,
        payment method and fees are handled in the secure checkout. USDC is
        delivered to your Comparta wallet on Arc.
      </p>
    </div>
  );
}
