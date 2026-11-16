"use client";

// app/components/DepositModal.tsx
//
// One "Add funds" surface: a crypto transfer (address + QR). Card/bank
// Onramp has been removed, so crypto is the only deposit method.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  X,
  Copy,
  Check,
  Network,
  Clock3,
} from "lucide-react";
import QRCodeStyling from "qr-code-styling";
import {
  DEPOSIT_CHAINS,
  SETTLEMENT_CHAIN,
} from "@/lib/config/clientChains";

// The wallet's address is the same across every one of these chains (see
// lib/circle/unifiedBalance.ts's module docstring) - only the label
// changes. The settlement chain (Arc on mainnet, Arc Testnet locally) stays
// first/default since it's the only one that settles instantly with no
// extra step; the others are detected and folded into the spendable
// balance automatically within a few minutes (see lib/circle/autoDeposit.ts).
// The list itself is network-aware — see lib/config/clientChains.ts.

// Hydration-safe "are we on the client yet?" flag. React renders the portal
// as null on the server, then this flips to true after hydration.
const emptySubscribe = () => () => {};

// Chain artwork lives in public/chain-logos/. Keys are matched by prefix so
// the same logo covers both mainnet and testnet enum values (BASE /
// BASE_SEPOLIA, ETH_MAINNET / ETH_SEPOLIA, …).
const CHAIN_LOGOS: ReadonlyArray<{
  prefix: string;
  src: string;
  alt: string;
}> = [
  { prefix: "ARC_", src: "/chain-logos/arc.svg", alt: "Arc" },
  { prefix: "ETH_", src: "/chain-logos/ethereum.png", alt: "Ethereum" },
  { prefix: "BASE", src: "/chain-logos/base.png", alt: "Base" },
  { prefix: "ARBITRUM", src: "/chain-logos/arbitrum.png", alt: "Arbitrum" },
];

function chainLogo(chain: string) {
  return CHAIN_LOGOS.find(({ prefix }) => chain.startsWith(prefix)) ?? null;
}

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
  address: string;
  chain?: string;
}

export default function DepositModal({
  open,
  onClose,
  address,
  chain = SETTLEMENT_CHAIN,
}: DepositModalProps) {
  const qrRef = useRef<HTMLDivElement | null>(null);
  const qrInstance = useRef<QRCodeStyling | null>(null);
  const [copied, setCopied] = useState(false);
  const [pickedChain, setPickedChain] = useState<string | null>(null);

  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const selectedChain = pickedChain ?? chain;

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !mounted || !qrRef.current || !address) {
      return;
    }

    if (!qrInstance.current) {
      qrInstance.current = new QRCodeStyling({
        width: 260,
        height: 260,
        data: address,
        margin: 0,
        qrOptions: {
          typeNumber: 0,
          mode: "Byte",
          errorCorrectionLevel: "Q",
        },
        imageOptions: {
          hideBackgroundDots: true,
          imageSize: 0.28,
          margin: 8,
          crossOrigin: "anonymous",
        },
        dotsOptions: {
          color: "#0B1E3F",
          type: "rounded",
        },
        backgroundOptions: {
          color: "#FFFFFF",
        },
        cornersSquareOptions: {
          color: "#0B1E3F",
          type: "extra-rounded",
        },
        cornersDotOptions: {
          color: "#2A5CE6",
          type: "dot",
        },
        image: "/small-logo.webp",
      });
    } else {
      qrInstance.current.update({ data: address });
    }

    qrRef.current.innerHTML = "";
    qrInstance.current.append(qrRef.current);
  }, [open, mounted, address]);

  if (!open || !mounted) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // no-op
    }
  }

  const displayChain =
    DEPOSIT_CHAINS.find((c) => c.value === selectedChain)?.label ??
    selectedChain;
  const isArc = selectedChain === SETTLEMENT_CHAIN;
  const selectedChainLogo = chainLogo(selectedChain);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-title"
     >
      <button
        aria-label="Close deposit modal"
        onClick={onClose}
        className="absolute inset-0 bg-[#0B1E3F]/50 backdrop-blur-[2px] animate-[fadeIn_.15s_ease]"
        tabIndex={-1}
      />

      <div className="relative w-full max-w-[760px] max-h-[92vh] rounded-2xl bg-white shadow-[0_24px_80px_-20px_rgba(11,30,63,0.35)] animate-[popIn_.18s_ease] overflow-y-auto">
        <div className="flex items-start justify-between px-6 pt-6 pb-2">
          <div>
            <h2
              id="deposit-title"
              className="text-xl font-semibold text-[#0B1E3F]"
            >
              Add funds
            </h2>
            <p className="mt-1 text-xs text-[#7C8CA6]">
              Transfer USDC to your address onchain.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-[#7C8CA6] hover:bg-[#FAF9F6] hover:text-[#0B1E3F] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div className="flex flex-wrap gap-1.5 rounded-full bg-[#FAF9F6] p-1 w-fit">
                {DEPOSIT_CHAINS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setPickedChain(c.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selectedChain === c.value
                        ? "bg-[#2A5CE6] text-white"
                        : "text-[#3E4A6B] hover:bg-white"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 pt-2">
                <div className="flex justify-center shrink-0 mx-auto sm:mx-0">
                  <div className="relative p-4 rounded-xl border border-[#E5E9F2]">
                    <div ref={qrRef} className="w-[260px] h-[260px]" />
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label={copied ? "Address copied" : "Copy deposit address"}
                      title={copied ? "Copied" : "Copy deposit address"}
                      className={`absolute -top-3 -right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-all ${
                        copied
                          ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                          : "border-[#E5E9F2] bg-white text-[#3E4A6B] hover:border-[#0B1E3F] hover:text-[#0B1E3F] hover:bg-[#F7F8FB]"
                      }`}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-w-0 w-full space-y-4">
                  <div className="md:grid grid-cols-3 gap-2.5 hidden">
                    <div className="rounded-xl bg-[#FAF9F6] border border-[#FAF9F6] p-3 text-center">
                      <div className="mx-auto mb-1.5 w-8 h-8 rounded-full bg-white border border-[#E5E9F2] flex items-center justify-center text-[#2A5CE6]">
                        {selectedChainLogo ? (
                          <Image
                            src={selectedChainLogo.src}
                            alt={selectedChainLogo.alt}
                            width={18}
                            height={18}
                            unoptimized
                            className="h-[18px] w-[18px] object-contain"
                          />
                        ) : (
                          <Network size={14} />
                        )}
                      </div>
                      <p className="text-xs font-semibold text-[#0B1E3F] mt-0.5">
                        {displayChain}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#FAF9F6] border border-[#FAF9F6] p-3 text-center">
                      <div className="mx-auto mb-1.5 w-8 h-8 rounded-full bg-white border border-[#E5E9F2] flex items-center justify-center text-[#2A5CE6]">
                        <Clock3 size={14} />
                      </div>
                      <p className="text-xs font-semibold text-[#0B1E3F] mt-0.5">
                        ~1 min
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#FAF9F6] border border-[#FAF9F6] p-3 text-center">
                      <div className="mx-auto mb-1.5 w-8 h-8 rounded-full bg-white flex items-center justify-center">
                        <Image
                          src="/usdc.png"
                          alt="USDC"
                          width={18}
                          height={18}
                          className="rounded-full"
                        />
                      </div>
                      <p className="text-xs font-semibold text-[#0B1E3F] mt-0.5">
                        USDC
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-1 rounded-xl border border-[#E5EEFF] p-3.5 flex gap-3 md:block hidden">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[#0B1E3F]">
                    Send only USDC on the {displayChain} network
                  </p>
                  <p className="text-[11px] leading-relaxed text-[#3E4A6B]">
                    Deposits of other assets or on unsupported chains will be
                    irretrievable. Confirm the network in your sending wallet
                    before confirming.
                    {!isArc &&
                      " Balances on this network are picked up and added automatically, usually within a few minutes."}
                  </p>
                </div>
              </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn {
          from { opacity: 0; transform: translateY(6px) scale(.98) }
          to   { opacity: 1; transform: translateY(0)   scale(1) }
        }
      `}</style>
    </div>,
    document.body
  );
}
